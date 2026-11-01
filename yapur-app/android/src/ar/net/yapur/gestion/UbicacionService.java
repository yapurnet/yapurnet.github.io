package ar.net.yapur.gestion;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Comparte la posición del técnico con la oficina SOLO dentro del horario laboral (hora de Argentina), aunque la app esté cerrada.
 *
 * Es un servicio en primer plano que queda «residente»: una vez que el técnico abrió la app, aceptó el aviso y entró con su usuario,
 * el servicio sigue vivo todo el día y toda la noche, y vuelve solo (START_STICKY, alarma de control, aviso al reiniciar el celular
 * y al actualizar la app: ver UbicacionReceptor). Así la jornada empieza y termina en la oficina sin que nadie tenga que abrir la app.
 *   · DENTRO del horario: pide el GPS cada minuto y manda las posiciones (notificación «ubicación activa»).
 *   · FUERA del horario (o en la siesta): no le pide nada al GPS ni manda nada; solo queda «en espera» (notificación mínima) y
 *     mira cada tanto el horario del día por si cambió.
 * El horario de cada día (de corrido o cortado, con los días puntuales) se lo pide al servidor con la sesión del técnico, y si no hay
 * conexión usa el último que conoce. El servidor vuelve a controlar el horario con su propio reloj.
 *
 * Se detiene solo, y se borra la sesión guardada, si el servidor dice que la sesión ya no vale (401), que no es técnico (403) o que no
 * aceptó el aviso (409), y cuando el técnico cierra sesión (MainActivity.Bridge.stopLocation).
 *
 * Android 12+ no deja arrancar un servicio de ubicación desde segundo plano, salvo en situaciones puntuales (reinicio del celular,
 * actualización de la app, app sin restricción de batería) y, para que además pueda LEER la posición con la app cerrada, hace falta el
 * permiso de ubicación «todo el tiempo» (ACCESS_BACKGROUND_LOCATION). Si igual no se puede, se muestra una notificación
 * «Tocá para reactivar» que abre la app (tocar una notificación sí está permitido).
 *
 * Se compila contra Android 6 (API 23): lo que es de versiones nuevas se llama por reflexión y solo en esas versiones.
 */
public class UbicacionService extends Service implements LocationListener {
    static final String EXTRA_DESDE = "desde";
    static final String EXTRA_HASTA = "hasta";
    static final String EXTRA_TRAMOS = "tramos";   // «8-13,17-22»: horario conocido al arrancar (después lo manda el servidor)
    static final String ACCION_ALARMA = "ar.net.yapur.gestion.UBICACION_ALARMA";
    static final String PREFS = "yapur";
    static final String P_ACTIVO = "ub_activo";
    static final String P_TOKEN = "ub_token";
    static final String P_TRAMOS = "ub_tramos";
    private static final String CANAL_ACTIVA = "ubicacion";
    private static final String CANAL_ESPERA = "ubicacion_espera";
    private static final String CANAL_AVISO = "ubicacion_aviso";
    private static final int NOTIF_ID = 4107;
    private static final int NOTIF_AVISO_ID = 4108;
    private static final int FOREGROUND_SERVICE_TYPE_LOCATION = 8;   // Android 10+
    private static final long CADA_MS = 60000L;                      // una posición por minuto
    private static final long ENTRE_PUNTOS_MS = 45000L;              // el GPS y la red avisan los dos: alcanza con uno por minuto
    private static final long ESPERA_MAX_MS = 5L * 60000L;           // fuera de horario se mira el reloj cada 5 minutos como mucho
    private static final long PLAN_CADA_MS = 10L * 60000L;           // el horario del día se vuelve a pedir cada 10 minutos
    private static final long ALARMA_CADA_MS = 15L * 60000L;         // control para que el servicio vuelva si el sistema lo mató
    private static final int MAX_COLA = 60;
    private static final int POR_ENVIO = 30;
    private static final int SIN_PLAN = 0, DENTRO = 1, FUERA = 2, PROBLEMA = 3;

    static volatile String token = "";
    static volatile boolean running = false;

    private LocationManager lm;
    private Handler main;
    private ExecutorService net;
    private final ArrayList<String> cola = new ArrayList<String>();
    private long ultimo = 0;
    private int[] ini = {8}, fin = {20};   // horas de inicio y fin de cada tramo del día
    private String planFecha = "";         // día (AAAA-MM-DD, hora argentina) al que corresponde el horario de arriba
    private long planTs = 0;
    private boolean pidiendoPlan = false;
    private boolean pausado = true;        // sin posiciones pedidas al GPS (fuera de horario, en la siesta o sin permiso)
    private boolean enviando = false;
    private int mostrado = SIN_PLAN;       // qué notificación está a la vista
    private boolean sinGps = false;
    private int rechazos = 0;              // respuestas 403 seguidas (un 403 suelto, de la red o de Cloudflare, no debe apagar el servicio)

    private final Runnable ciclo = new Runnable() {
        @Override
        public void run() {
            main.removeCallbacks(this);
            if (!running) return;
            pedirPlanSiHaceFalta();
            boolean dentro = dentroDeHorario();
            if (dentro && pausado) {                       // empezó un tramo
                if (pedirPosiciones()) { pausado = false; sinGps = false; } else { sinGps = true; }
            } else if (!dentro && !pausado) {              // terminó un tramo (o empezó la siesta)
                quitarPosiciones();
                pausado = true;
                sinGps = false;
            } else if (!dentro) {
                sinGps = false;
            }
            mostrarEstado();
            if (!pausado) enviar();
            programarAlarma();
            main.postDelayed(this, dentro ? CADA_MS : esperaMs());
        }
    };

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent it, int flags, int startId) {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (token.length() == 0) token = sp.getString(P_TOKEN, "");
        if (!running) leerHorarioGuardado(sp, it);
        /* Android exige llamar a startForeground enseguida después de startForegroundService, aunque después no haya nada que hacer:
           por eso va primero, antes de cualquier salida (si no, en algunas versiones se cierra toda la aplicación). */
        boolean visible = enPrimerPlano(dentroDeHorario() ? DENTRO : FUERA);
        if (!visible) {
            /* el sistema no dejó arrancar el servicio de ubicación desde segundo plano: solo queda avisarle al técnico
               (si es hora de trabajar) y volver a intentar más tarde */
            if (cercaDelHorario(sp)) avisarReactivar(this);
            alarmaEn(this, ALARMA_CADA_MS);
            stopSelf();
            return START_NOT_STICKY;
        }
        quitarAviso(this);
        if (!sp.getBoolean(P_ACTIVO, false) || token.length() == 0) { desactivar(this); stopSelf(); return START_NOT_STICKY; }
        if (!running) {
            running = true;
            main = new Handler(Looper.getMainLooper());
            net = Executors.newSingleThreadExecutor();
            lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            pausado = true;
            mostrado = dentroDeHorario() ? DENTRO : FUERA;
        }
        main.post(ciclo);   // arranque, o aviso de la alarma: se mira el reloj ya mismo
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (lm != null) lm.removeUpdates(this); } catch (Throwable t) { /* ya estaba parado */ }
        if (main != null) main.removeCallbacks(ciclo);
        if (net != null) net.shutdown();
        try { stopForeground(true); } catch (Throwable t) { /* nada */ }
        super.onDestroy();
    }

    /* ---------- estado guardado: lo que permite volver solo después de un reinicio ---------- */

    /** Sin sesión guardada y sin servicio: el técnico cerró sesión, o el servidor dijo que ya no vale. */
    static void desactivar(Context c) {
        token = "";
        try { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(P_ACTIVO, false).remove(P_TOKEN).apply(); } catch (Throwable t) { /* nada */ }
        cancelarAlarma(c);
        quitarAviso(c);
    }

    private void leerHorarioGuardado(SharedPreferences sp, Intent it) {
        String tr = it != null ? it.getStringExtra(EXTRA_TRAMOS) : null;
        if (tr != null && leerTramos(tr)) return;
        if (it != null && it.hasExtra(EXTRA_DESDE) && it.hasExtra(EXTRA_HASTA)) {
            int a = it.getIntExtra(EXTRA_DESDE, 8), b = it.getIntExtra(EXTRA_HASTA, 20);
            if (a >= 0 && b <= 24 && a < b) { ini = new int[] { a }; fin = new int[] { b }; return; }
        }
        String g = sp.getString(P_TRAMOS, "");
        if (g.length() > 0) leerTramos(g);
    }

    /* ---------- horario: hora de Argentina (UTC-3, sin horario de verano) ---------- */

    private static double horaActual() {
        long ar = System.currentTimeMillis() - 3L * 3600000L;
        return ((ar / 60000L) % 1440L) / 60.0;
    }

    private static String fechaHoy() {
        long ar = System.currentTimeMillis() - 3L * 3600000L;
        long d = ar / 86400000L;   // días desde 1970-01-01 (la hora del celular nunca es anterior a 1970)
        /* civil_from_days (Howard Hinnant) */
        long z = d + 719468L;
        long era = z / 146097L;
        long doe = z - era * 146097L;
        long yoe = (doe - doe / 1460L + doe / 36524L - doe / 146096L) / 365L;
        long y = yoe + era * 400L;
        long doy = doe - (365L * yoe + yoe / 4L - yoe / 100L);
        long mp = (5L * doy + 2L) / 153L;
        long dd = doy - (153L * mp + 2L) / 5L + 1L;
        long mm = mp < 10 ? mp + 3 : mp - 9;
        if (mm <= 2) y++;
        return String.format(Locale.US, "%04d-%02d-%02d", y, mm, dd);
    }

    private boolean dentroDeHorario() {
        double h = horaActual();
        for (int i = 0; i < ini.length; i++) if (h >= ini[i] && h < fin[i]) return true;
        return false;
    }

    /** Milisegundos hasta el próximo comienzo de tramo de hoy, o -1 si ya no queda ninguno hoy. */
    private long hastaProximoInicioHoy() {
        double h = horaActual();
        for (int i = 0; i < ini.length; i++) if (h < ini[i]) return (long) ((ini[i] - h) * 3600000.0);
        return -1L;
    }

    /* cada cuánto mira el reloj fuera de horario: más seguido cuando falta poco para empezar */
    private long esperaMs() {
        long falta = hastaProximoInicioHoy();
        if (falta >= 0 && falta < ESPERA_MAX_MS) return Math.max(15000L, falta);
        return ESPERA_MAX_MS;
    }

    /* «8-13,17-22» -> tramos; devuelve false (y no cambia nada) si no es un horario válido */
    private boolean leerTramos(String s) {
        try {
            String[] p = s.split(",");
            if (p.length < 1 || p.length > 2) return false;
            int[] a = new int[p.length], b = new int[p.length];
            for (int i = 0; i < p.length; i++) {
                String[] x = p[i].split("-");
                if (x.length != 2) return false;
                a[i] = Integer.parseInt(x[0].trim());
                b[i] = Integer.parseInt(x[1].trim());
                if (a[i] < 0 || b[i] > 24 || a[i] >= b[i] || (i > 0 && a[i] < b[i - 1])) return false;
            }
            ini = a;
            fin = b;
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private String tramosTexto() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ini.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(ini[i]).append('-').append(fin[i]);
        }
        return sb.toString();
    }

    private String textoHorario() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ini.length; i++) {
            if (i > 0) sb.append(" y de ");
            sb.append(ini[i]).append(" a ").append(fin[i]);
        }
        return sb.toString();
    }

    /* ---------- el horario del día, que lo manda el servidor ---------- */

    private void pedirPlanSiHaceFalta() {
        long ahora = System.currentTimeMillis();
        String hoy = fechaHoy();
        if (pidiendoPlan || net == null || token.length() == 0) return;
        if (hoy.equals(planFecha) && ahora - planTs < PLAN_CADA_MS) return;
        if (!hoy.equals(planFecha) && ahora - planTs < 60000L) return;   // sin conexión: no insistir más de una vez por minuto
        pidiendoPlan = true;
        final String tk = token;
        net.execute(new Runnable() {
            @Override
            public void run() {
                int code = -1;
                String cuerpo = "";
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(Config.SERVER_URL + "/api/ubicacion/estado").openConnection();
                    c.setRequestMethod("GET");
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setRequestProperty("Authorization", "Bearer " + tk);
                    code = c.getResponseCode();
                    if (code == 200) {
                        InputStream in = c.getInputStream();
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[2048];
                        int n, total = 0;
                        while ((n = in.read(buf)) > 0 && total < 20000) { bo.write(buf, 0, n); total += n; }
                        in.close();
                        cuerpo = bo.toString("UTF-8");
                    }
                    c.disconnect();
                } catch (Throwable t) { code = -1; }
                final int rc = code;
                final String body = cuerpo;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        pidiendoPlan = false;
                        planTs = System.currentTimeMillis();
                        if (!running) return;
                        if (rechazado(rc)) return;
                        if (rc == 200) aplicarPlan(body);
                    }
                });
            }
        });
    }

    private void aplicarPlan(String body) {
        try {
            JSONObject j = new JSONObject(body);
            if (!j.optBoolean("aplica", true) || !j.optBoolean("acepto", true)) { terminarPorServidor(); return; }
            int[] a, b;
            JSONArray tr = j.optJSONArray("tramos");
            if (tr != null && tr.length() >= 1 && tr.length() <= 2) {
                a = new int[tr.length()];
                b = new int[tr.length()];
                for (int i = 0; i < tr.length(); i++) { JSONArray x = tr.getJSONArray(i); a[i] = x.getInt(0); b[i] = x.getInt(1); }
            } else {
                a = new int[] { j.getInt("desde") };
                b = new int[] { j.getInt("hasta") };
            }
            for (int i = 0; i < a.length; i++) if (a[i] < 0 || b[i] > 24 || a[i] >= b[i] || (i > 0 && a[i] < b[i - 1])) return;
            ini = a;
            fin = b;
            planFecha = fechaHoy();
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(P_TRAMOS, tramosTexto()).apply();
            main.removeCallbacks(ciclo);
            main.post(ciclo);   // el horario pudo cambiar: se vuelve a mirar ya
        } catch (Throwable t) { /* respuesta rara: queda el horario que había */ }
    }

    /* 401 (la sesión ya no vale) y 409 (no aceptó el aviso) cortan enseguida; 403 (no es técnico) recién cuando se repite 3 veces seguidas.
       Cualquier otra respuesta (200, sin conexión, errores del servidor) no corta nada. Devuelve true si se cortó. */
    private boolean rechazado(int rc) {
        if (rc == 401 || rc == 409) { terminarPorServidor(); return true; }
        if (rc == 403) { if (++rechazos >= 3) { terminarPorServidor(); return true; } return false; }
        if (rc == 200) rechazos = 0;
        return false;
    }

    private void terminarPorServidor() {
        desactivar(this);
        stopSelf();
    }

    /* ---------- posiciones ---------- */

    private void quitarPosiciones() {
        try { if (lm != null) lm.removeUpdates(this); } catch (Throwable t) { /* ya estaba parado */ }
    }

    private boolean pedirPosiciones() {
        boolean alguno = false;
        String[] provs = {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER};
        for (int i = 0; i < provs.length; i++) {
            try {
                lm.requestLocationUpdates(provs[i], CADA_MS, 0f, this, Looper.getMainLooper());
                alguno = true;
            } catch (Throwable t) { /* ese proveedor no está, o falta el permiso */ }
        }
        return alguno;
    }

    @Override
    public void onLocationChanged(Location l) {
        if (l == null || pausado) return;
        long ahora = System.currentTimeMillis();
        if (ahora - ultimo < ENTRE_PUNTOS_MS) return;
        ultimo = ahora;
        long t = l.getTime();
        if (t <= 0 || Math.abs(ahora - t) > 120000L) t = ahora;
        StringBuilder p = new StringBuilder();
        p.append(String.format(Locale.US, "{\"lat\":%.6f,\"lng\":%.6f", l.getLatitude(), l.getLongitude()));
        if (l.hasAccuracy()) p.append(String.format(Locale.US, ",\"acc\":%.0f", l.getAccuracy()));
        p.append(String.format(Locale.US, ",\"ts\":%d}", t));
        if (cola.size() >= MAX_COLA) cola.remove(0);
        cola.add(p.toString());
        enviar();
    }

    @Override public void onStatusChanged(String p, int s, Bundle e) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }

    /* ---------- envío al servidor (siempre HTTPS: Config.SERVER_URL lo exige el build) ---------- */

    private void enviar() {
        if (enviando || cola.isEmpty() || net == null) return;
        enviando = true;
        final int n = Math.min(cola.size(), POR_ENVIO);
        final StringBuilder body = new StringBuilder("{\"pts\":[");
        for (int i = 0; i < n; i++) { if (i > 0) body.append(','); body.append(cola.get(i)); }
        body.append("]}");
        final String tk = token;
        net.execute(new Runnable() {
            @Override
            public void run() {
                int code = -1;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(Config.SERVER_URL + "/api/ubicacion").openConnection();
                    c.setRequestMethod("POST");
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    c.setRequestProperty("Authorization", "Bearer " + tk);
                    OutputStream os = c.getOutputStream();
                    os.write(body.toString().getBytes(Charset.forName("UTF-8")));
                    os.close();
                    code = c.getResponseCode();
                    c.disconnect();
                } catch (Throwable t) { code = -1; }
                final int rc = code;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        enviando = false;
                        if (rc == 200) {
                            for (int i = 0; i < n && !cola.isEmpty(); i++) cola.remove(0);
                        } else {
                            rechazado(rc);   // la sesión ya no vale, no es técnico o no aceptó el aviso: no se insiste
                        }
                    }
                });
            }
        });
    }

    /* ---------- alarma de control: si el sistema mata el proceso, esto lo vuelve a levantar ---------- */

    private void programarAlarma() {
        long en = ALARMA_CADA_MS;
        long falta = hastaProximoInicioHoy();
        if (falta >= 0 && falta + 2000L < en) en = falta + 2000L;   // y justo cuando empieza el próximo tramo
        alarmaEn(this, en);
    }

    static void alarmaEn(Context c, long ms) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi = pendienteAlarma(c);
            long cuando = System.currentTimeMillis() + ms;
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
            else am.set(AlarmManager.RTC_WAKEUP, cuando, pi);
        } catch (Throwable t) { /* sin alarma: el servicio sigue andando igual, solo pierde este control */ }
    }

    /** ¿Es hora de trabajar (o falta menos de una hora para empezar), según el último horario guardado? Sirve para no avisar de noche. */
    static boolean cercaDelHorario(SharedPreferences sp) {
        try {
            String g = sp.getString(P_TRAMOS, "8-20");
            double h = horaActual();
            String[] p = g.split(",");
            for (int i = 0; i < p.length; i++) {
                String[] x = p[i].split("-");
                int a = Integer.parseInt(x[0].trim()), b = Integer.parseInt(x[1].trim());
                if ((h >= a && h < b) || (h < a && a - h <= 1.0)) return true;
            }
        } catch (Throwable t) { /* horario guardado ilegible: se avisa igual */ return true; }
        return false;
    }

    static PendingIntent pendienteAlarma(Context c) {
        Intent i = new Intent(c, UbicacionReceptor.class).setAction(ACCION_ALARMA);
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void cancelarAlarma(Context c) {
        try { ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE)).cancel(pendienteAlarma(c)); } catch (Throwable t) { /* nada */ }
    }

    /* ---------- notificaciones ---------- */

    private void mostrarEstado() {
        int ahora = sinGps ? PROBLEMA : (!pausado ? DENTRO : FUERA);
        if (ahora == mostrado) return;
        mostrado = ahora;
        try { ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_ID, notificacion(ahora)); } catch (Throwable t) { /* nada */ }
    }

    private boolean enPrimerPlano(int estado) {
        try {
            Notification n = notificacion(estado);
            if (Build.VERSION.SDK_INT >= 29) {
                Service.class.getMethod("startForeground", int.class, Notification.class, int.class)
                    .invoke(this, NOTIF_ID, n, FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID, n);
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private Notification notificacion(int estado) throws Exception {
        String titulo, texto, canal = estado == FUERA ? CANAL_ESPERA : CANAL_ACTIVA;
        if (estado == DENTRO) {
            titulo = "Gestión YAPUR: ubicación activa";
            texto = "Se comparte con la oficina de " + textoHorario() + " h";
        } else if (estado == PROBLEMA) {
            titulo = "Gestión YAPUR: no se puede tomar la ubicación";
            texto = "Revisá que el GPS esté prendido y que la app tenga permiso de ubicación.";
        } else {
            titulo = "Gestión YAPUR: en espera";
            texto = "Fuera de horario no se comparte nada. Horario: " + textoHorario() + " h";
        }
        Notification.Builder b = constructor(this, canal, estado == FUERA ? 1 : 2);   // 2 = IMPORTANCE_LOW (sin sonido), 1 = IMPORTANCE_MIN
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        b.setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setOngoing(true)
            .setContentIntent(pi);
        return b.build();
    }

    /** Constructor de notificaciones con su canal (los canales son de Android 8+: por reflexión, porque se compila contra Android 6). */
    static Notification.Builder constructor(Context c, String canal, int importancia) throws Exception {
        if (Build.VERSION.SDK_INT >= 26) {
            Class<?> chC = Class.forName("android.app.NotificationChannel");
            String nombre = CANAL_ACTIVA.equals(canal) ? "Ubicación en horario laboral" : CANAL_ESPERA.equals(canal) ? "Ubicación en espera" : "Avisos de ubicación";
            Object ch = chC.getConstructor(String.class, CharSequence.class, int.class).newInstance(canal, nombre, importancia);
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationManager.class.getMethod("createNotificationChannel", chC).invoke(nm, ch);
            return Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(c, canal);
        }
        return new Notification.Builder(c);
    }

    /** «Tocá para reactivar»: cuando Android no deja arrancar el servicio solo, tocar una notificación sí está permitido. */
    static void avisarReactivar(Context c) {
        try {
            Notification.Builder b = constructor(c, CANAL_AVISO, 2);   // 2 = IMPORTANCE_LOW: se ve en la barra, sin sonido (no despierta a nadie)
            Intent open = new Intent(c, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Gestión YAPUR: tocá para activar tu ubicación")
                .setContentText("El celular no dejó que la app arranque sola. Abrila para que la oficina registre tu jornada.")
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi);
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_AVISO_ID, b.build());
        } catch (Throwable t) { /* sin aviso: la oficina igual ve «Sin señal» en la pestaña Técnicos */ }
    }

    static void quitarAviso(Context c) {
        try { ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTIF_AVISO_ID); } catch (Throwable t) { /* nada */ }
    }
}

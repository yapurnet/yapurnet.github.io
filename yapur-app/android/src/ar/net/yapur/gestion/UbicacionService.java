package ar.net.yapur.gestion;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Comparte la posición del técnico con la oficina SOLO dentro del horario laboral (por defecto de 8 a 20 h, hora de Argentina).
 * Corre como servicio en primer plano, con la notificación «ubicación activa» a la vista, y por eso sigue con la pantalla apagada.
 * Se arranca únicamente desde la app abierta (MainActivity.Bridge.startLocation) y después de que el técnico aceptó el aviso.
 * Se detiene sola al terminar el horario, o si el servidor dice que la sesión ya no vale o que no aceptó el aviso.
 * El servidor vuelve a controlar el horario con su propio reloj, así que este control es solo para no gastar batería de más.
 *
 * Se compila contra Android 6 (API 23): lo que es de versiones nuevas se llama por reflexión y solo en esas versiones.
 */
public class UbicacionService extends Service implements LocationListener {
    static final String EXTRA_DESDE = "desde";
    static final String EXTRA_HASTA = "hasta";
    private static final String CHANNEL = "ubicacion";
    private static final int NOTIF_ID = 4107;
    private static final int FOREGROUND_SERVICE_TYPE_LOCATION = 8;   // Android 10+
    private static final long CADA_MS = 60000L;                      // una posición por minuto
    private static final long ENTRE_PUNTOS_MS = 45000L;              // el GPS y la red avisan los dos: alcanza con uno por minuto
    private static final int MAX_COLA = 60;
    private static final int POR_ENVIO = 30;

    /* La sesión vive solo en memoria: si el sistema mata la aplicación, el servicio no vuelve a arrancar solo
       (START_NOT_STICKY) y el técnico lo reactiva al abrir la app. */
    static volatile String token = "";
    static volatile boolean running = false;

    private LocationManager lm;
    private Handler main;
    private ExecutorService net;
    private final ArrayList<String> cola = new ArrayList<String>();
    private long ultimo = 0;
    private int desde = 8, hasta = 20;
    private boolean enviando = false;

    private final Runnable vigilar = new Runnable() {
        @Override
        public void run() {
            if (!dentroDeHorario()) { stopSelf(); return; }
            enviar();
            main.postDelayed(this, CADA_MS);
        }
    };

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent it, int flags, int startId) {
        if (it == null || token.length() == 0) { stopSelf(); return START_NOT_STICKY; }
        desde = it.getIntExtra(EXTRA_DESDE, 8);
        hasta = it.getIntExtra(EXTRA_HASTA, 20);
        /* Android exige mostrar la notificación enseguida después de startForegroundService */
        if (!enPrimerPlano()) { stopSelf(); return START_NOT_STICKY; }
        if (!dentroDeHorario()) { stopSelf(); return START_NOT_STICKY; }
        if (!running) {
            running = true;
            main = new Handler(Looper.getMainLooper());
            net = Executors.newSingleThreadExecutor();
            lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (!pedirPosiciones()) { stopSelf(); return START_NOT_STICKY; }
            main.postDelayed(vigilar, CADA_MS);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (lm != null) lm.removeUpdates(this); } catch (Throwable t) { /* ya estaba parado */ }
        if (main != null) main.removeCallbacks(vigilar);
        if (net != null) net.shutdown();
        try { stopForeground(true); } catch (Throwable t) { /* nada */ }
        super.onDestroy();
    }

    /* ---------- horario: hora de Argentina (UTC-3, sin horario de verano) ---------- */

    private boolean dentroDeHorario() {
        long ar = System.currentTimeMillis() - 3L * 3600000L;
        double h = ((ar / 60000L) % 1440L) / 60.0;
        return h >= desde && h < hasta;
    }

    /* ---------- posiciones ---------- */

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
        if (l == null) return;
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
                        } else if (rc == 401 || rc == 403 || rc == 409) {
                            stopSelf();   // la sesión ya no vale, no es técnico o no aceptó el aviso: no se insiste
                        }
                    }
                });
            }
        });
    }

    /* ---------- notificación a la vista ---------- */

    private boolean enPrimerPlano() {
        try {
            Notification n = notificacion();
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

    private Notification notificacion() throws Exception {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            Class<?> chC = Class.forName("android.app.NotificationChannel");
            Object ch = chC.getConstructor(String.class, CharSequence.class, int.class)
                .newInstance(CHANNEL, "Ubicación en horario laboral", 2);   // 2 = IMPORTANCE_LOW: sin sonido
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationManager.class.getMethod("createNotificationChannel", chC).invoke(nm, ch);
            b = Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        b.setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Gestión YAPUR: ubicación activa")
            .setContentText("Se comparte con la oficina de " + desde + " a " + hasta + " h")
            .setOngoing(true)
            .setContentIntent(pi);
        return b.build();
    }
}

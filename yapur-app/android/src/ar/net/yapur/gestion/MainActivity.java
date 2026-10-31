package ar.net.yapur.gestion;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Locale;

/**
 * Envoltura de Android de Gestión YAPUR.NET: una ventana de navegador (WebView) que abre el sistema desde su dirección en Cloudflare.
 * La app web (con el service worker) vive en el servidor, así que se actualiza sola; acá solo está lo que el navegador no puede hacer:
 * guardar archivos en Descargas, abrir WhatsApp / mapas / teléfono, elegir un archivo y el botón «atrás».
 * Sin lambdas ni librerías externas, para poder armarse con javac + dx + aapt (igual que la app de FAVL).
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_STORAGE = 2;
    private static final int REQ_LOC = 3;
    private static final int REQ_NOTIF = 4;
    private static final String OFFLINE = "file:///android_asset/offline.html";
    private static final String[] OPENABLE = {"http", "https", "tel", "mailto", "geo", "whatsapp", "waze", "sms", "smsto"};

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private String serverHost = "";
    private String pendName;
    private String pendMime;
    private byte[] pendData;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private boolean notifAsked;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        try { serverHost = Uri.parse(Config.SERVER_URL).getHost(); } catch (Exception e) { serverHost = ""; }
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setGeolocationEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " YapurApp/" + Config.VERSION);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "YapurApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (saved == null || web.restoreState(saved) == null) {
            web.loadUrl(Config.SERVER_URL + "/");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) { web.onResume(); web.resumeTimers(); }
    }

    @Override
    protected void onPause() {
        if (web != null) { web.onPause(); CookieManager.getInstance().flush(); }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ViewGroup p = (ViewGroup) web.getParent();
            if (p != null) p.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* «atrás»: primero lo atiende la app (cierra una hoja o vuelve a la primera pestaña); si no, se sale */
    @Override
    public void onBackPressed() {
        String cur = web == null ? null : web.getUrl();
        if (web == null || cur == null || cur.startsWith("file:")) { finish(); return; }
        web.evaluateJavascript("(function(){try{return window.yapurBack?window.yapurBack():false}catch(e){return false}})()", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (!"true".equals(v)) finish();
            }
        });
    }

    /* ---------- navegación ---------- */

    private boolean isOurs(Uri u) {
        String sc = u.getScheme();
        if (sc == null) return false;
        sc = sc.toLowerCase(Locale.US);
        if (sc.equals("file")) return u.toString().startsWith("file:///android_asset/");
        return (sc.equals("https") || sc.equals("http")) && serverHost != null && serverHost.length() > 0 && serverHost.equalsIgnoreCase(u.getHost());
    }

    /* devuelve true si el enlace ya se atendió afuera (no hay que cargarlo en la ventana) */
    private boolean handleUrl(String url) {
        Uri u;
        try { u = Uri.parse(url); } catch (Exception e) { return true; }
        if (isOurs(u)) return false;
        openOutside(u);
        return true;
    }

    private void openOutside(Uri u) {
        String sc = u.getScheme();
        if (sc == null) return;
        sc = sc.toLowerCase(Locale.US);
        boolean ok = false;
        for (int i = 0; i < OPENABLE.length; i++) if (OPENABLE[i].equals(sc)) ok = true;
        if (!ok) return;
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, u);
            it.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(it);
        } catch (ActivityNotFoundException e) {
            toast("No hay una aplicación para abrir este enlace.");
        } catch (Exception e) {
            toast("No se pudo abrir el enlace.");
        }
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show(); }
        });
    }

    private void showOffline() {
        if (web != null) web.loadUrl(OFFLINE);
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            return handleUrl(url);
        }

        /* Android 7+ llama a esta; se declara sin @Override para poder compilar contra Android 6 */
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            return handleUrl(r.getUrl().toString());
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) showOffline();
        }

        @Override
        public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse resp) {
            if (r.isForMainFrame() && resp.getStatusCode() >= 500) showOffline();
        }
    }

    private final class Chrome extends WebChromeClient {
        /* elegir un archivo (importar clientes, restaurar una copia) */
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) { fileCb.onReceiveValue(null); fileCb = null; }
            fileCb = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (Exception e) {
                fileCb = null;
                toast("No se pudo abrir el selector de archivos.");
                return false;
            }
            return true;
        }

        /* GPS: solo para nuestro servidor y solo cuando la página lo pide (botón «Usar mi ubicación actual») */
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            boolean mine = false;
            try { mine = isOurs(Uri.parse(origin)); } catch (Exception e) { mine = false; }
            if (!mine) { cb.invoke(origin, false, false); return; }
            if (hasLocationPermission()) { cb.invoke(origin, true, false); return; }
            if (geoCb != null) { geoCb.invoke(geoOrigin, false, false); }
            geoCb = cb;
            geoOrigin = origin;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
        }

        @Override
        public void onGeolocationPermissionsHidePrompt() {
            geoCb = null;
            geoOrigin = null;
        }
    }

    /* Android 13+: sin este permiso el servicio igual funciona, pero la notificación «ubicación activa» no se vería en la barra */
    private void pedirNotificaciones() {
        if (Build.VERSION.SDK_INT < 33 || notifAsked) return;
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) return;
        notifAsked = true;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF); } catch (Exception e) { /* nada */ }
            }
        });
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (fileCb != null) {
                Uri[] r = null;
                try { r = WebChromeClient.FileChooserParams.parseResult(res, data); } catch (Exception e) { r = null; }
                fileCb.onReceiveValue(r);
                fileCb = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    /* ---------- guardar en Descargas ---------- */

    private static String safeName(String name) {
        String n = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (n.length() > 80) n = n.substring(n.length() - 80);
        if (n.length() == 0) n = "archivo.txt";
        if (n.charAt(0) == '.') n = "_" + n;
        return n;
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    /* devuelve null si se guardó, o el texto del problema */
    private String writeDownload(String name, String mime, byte[] data) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContentResolver();
                ContentValues v = new ContentValues();
                v.put("_display_name", name);
                v.put("mime_type", mime);
                v.put("relative_path", Environment.DIRECTORY_DOWNLOADS);
                Uri uri = cr.insert(Uri.parse("content://media/external/downloads"), v);
                if (uri == null) return "No se pudo crear el archivo en Descargas.";
                OutputStream os = cr.openOutputStream(uri);
                if (os == null) return "No se pudo escribir el archivo en Descargas.";
                try { os.write(data); } finally { os.close(); }
                return null;
            }
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!dir.exists() && !dir.mkdirs()) return "No se pudo abrir la carpeta Descargas.";
            File f = uniqueFile(dir, name);
            FileOutputStream os = new FileOutputStream(f);
            try { os.write(data); } finally { os.close(); }
            MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
            return null;
        } catch (Exception e) {
            return "No se pudo guardar el archivo: " + e.getMessage();
        }
    }

    private String saveDownload(String name, String mime, String text) {
        String safe = safeName(name);
        String mt = "application/json".equals(mime) || "text/csv".equals(mime) ? mime : "application/octet-stream";
        byte[] data = (text == null ? "" : text).getBytes(Charset.forName("UTF-8"));
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendName = safe; pendMime = mt; pendData = data;
            runOnUiThread(new Runnable() {
                @Override
                public void run() { requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE); }
            });
            return "Aceptá el permiso de almacenamiento y se guarda el archivo.";
        }
        String err = writeDownload(safe, mt, data);
        return err == null ? "ok:Descargas" : err;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] grants) {
        if (req == REQ_LOC) {
            boolean ok = false;
            for (int i = 0; i < grants.length; i++) if (grants[i] == PackageManager.PERMISSION_GRANTED) ok = true;
            if (geoCb != null) {
                geoCb.invoke(geoOrigin, ok, false);
                geoCb = null;
                geoOrigin = null;
            }
            if (!ok) toast("Sin el permiso de ubicación no se puede usar el GPS.");
            return;
        }
        if (req == REQ_NOTIF) return;   // da igual lo que conteste: el servicio no depende de esto
        if (req == REQ_STORAGE) {
            byte[] d = pendData;
            String n = pendName, m = pendMime;
            pendData = null; pendName = null; pendMime = null;
            if (d != null && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) {
                String err = writeDownload(n, m, d);
                toast(err == null ? "Guardado en Descargas: " + n : err);
            } else {
                toast("Sin ese permiso no se puede guardar el archivo.");
            }
            return;
        }
        super.onRequestPermissionsResult(req, perms, grants);
    }

    /* ---------- lo que la página puede pedirle a Android (window.YapurApp) ---------- */

    private final class Bridge {
        @JavascriptInterface
        public String saveFile(String name, String mime, String text) {
            try { return saveDownload(name, mime, text); } catch (Throwable t) { return "No se pudo guardar el archivo."; }
        }

        @JavascriptInterface
        public boolean openUrl(final String url) {
            if (url == null) return false;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try { openOutside(Uri.parse(url)); } catch (Exception e) { /* enlace inválido */ }
                }
            });
            return true;
        }

        @JavascriptInterface
        public String serverUrl() { return Config.SERVER_URL; }

        @JavascriptInterface
        public String version() { return Config.VERSION; }

        /* Ubicación del técnico en horario laboral (la página ya mostró el aviso y el técnico lo aceptó).
           Devuelve «ok» cuando el servicio quedó andando; si no, la causa, y la página sigue con el GPS de la ventana. */
        @JavascriptInterface
        public String startLocation(String token, int desde, int hasta) {
            try {
                if (token == null || token.length() < 8 || token.length() > 1000) return "token";
                if (desde < 0 || hasta > 24 || desde >= hasta) return "horario";
                if (!hasLocationPermission()) return "permiso";   // el permiso lo pide la página con el GPS de la ventana; al minuto vuelve a intentar
                UbicacionService.token = token;
                Intent it = new Intent(MainActivity.this, UbicacionService.class);
                it.putExtra(UbicacionService.EXTRA_DESDE, desde);
                it.putExtra(UbicacionService.EXTRA_HASTA, hasta);
                if (Build.VERSION.SDK_INT >= 26) {
                    Context.class.getMethod("startForegroundService", Intent.class).invoke(MainActivity.this, it);
                } else {
                    startService(it);
                }
                pedirNotificaciones();
                return "ok";
            } catch (Throwable t) {
                return "error";
            }
        }

        @JavascriptInterface
        public void stopLocation() {
            UbicacionService.token = "";
            try { stopService(new Intent(MainActivity.this, UbicacionService.class)); } catch (Throwable t) { /* ya estaba parado */ }
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { if (web != null) web.loadUrl(Config.SERVER_URL + "/"); }
            });
        }
    }
}

package ar.com.banderavuela.favlapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

// Pantalla única de la app: una barra arriba («‹ FAVL Bandera Vuela», vuelve al menú) y debajo las páginas de
// assets/www en un WebView. La página usa window.AndroidBridge (guardar el PDF) y window.AndroidTTS (narrador).
public class MainActivity extends Activity {
    private static final String COLOR_BG = "#f4f7fb";
    private static final String COLOR_BRIGHT = "#0994dc";
    private static final String COLOR_DEEP = "#052f5c";
    private static final String HOME_URL = "file:///android_asset/www/index.html";
    private static final int FILE_CHOOSER_REQUEST_CODE = 5173;
    private static final int STORAGE_PERMISSION_REQUEST_CODE = 5174;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> filePathCallback;
    private Object backCallback;            // OnBackInvokedCallback (Android 13+); Object para no cargar la clase en Android viejos
    private boolean backCallbackRegistered = false;

    private float dp(float v) {
        return getResources().getDisplayMetrics().density * v;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(android.view.Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(Color.WHITE);
        int pad = (int) dp(6);
        header.setPadding(pad, 0, pad, 0);

        View divider = new View(this);
        divider.setBackgroundColor(Color.parseColor("#e3e9f2"));

        TextView back = new TextView(this);
        back.setText("‹");
        back.setTextSize(26);
        back.setTextColor(Color.parseColor(COLOR_BRIGHT));
        int bp = (int) dp(10);
        back.setPadding(bp, bp / 2, bp, bp / 2);
        back.setClickable(true);
        back.setFocusable(true);
        back.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                webView.loadUrl(HOME_URL);
            }
        });

        TextView title = new TextView(this);
        title.setText("FAVL Bandera Vuela");
        title.setTextColor(Color.parseColor(COLOR_DEEP));
        title.setTextSize(15);
        title.setPadding((int) dp(2), 0, 0, 0);
        header.addView(back, new LinearLayout.LayoutParams(-2, -2));
        header.addView(title, new LinearLayout.LayoutParams(-2, -2));

        FrameLayout content = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor(COLOR_BG));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setDatabaseEnabled(true);
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
        webView.addJavascriptInterface(new TtsBridge(this, webView), "AndroidTTS");

        progressBar = new ProgressBar(this);
        FrameLayout.LayoutParams plp = new FrameLayout.LayoutParams(-2, -2);
        plp.gravity = android.view.Gravity.CENTER;
        progressBar.setVisibility(View.GONE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                view.requestApplyInsets();
                updateBackCallback();
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                updateBackCallback();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.confirm();
                        }
                    }).setCancelable(false).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.confirm();
                        }
                    })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.cancel();
                        }
                    }).setCancelable(false).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.confirm(input.getText().toString());
                        }
                    })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.cancel();
                        }
                    }).setCancelable(false).show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Elegir imagen"), FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        content.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        content.addView(progressBar, plp);
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));
        root.addView(divider, new LinearLayout.LayoutParams(-1, (int) dp(1)));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1f));

        applyInsets(root, header);
        setContentView(root);
        requestStoragePermissionIfNeeded();
        webView.loadUrl(HOME_URL);
    }

    // Desde Android 15 (con targetSdk 35+) la app dibuja detrás de la barra de estado, de la de navegación y del teclado:
    // la barra de arriba se corre debajo de la barra de estado, y el contenido deja lugar abajo para la navegación y el
    // teclado (antes lo hacía solo «adjustResize»). En Android más viejos estos márgenes valen 0 y se ve igual que siempre.
    private void applyInsets(final View root, final View header) {
        if (Build.VERSION.SDK_INT >= 35) {
            // fondo blanco detrás de la barra de estado: los íconos tienen que ser oscuros
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(light, light);
            }
        }
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                int top, bottom, left, right;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
                    top = bars.top;
                    left = bars.left;
                    right = bars.right;
                    bottom = Math.max(bars.bottom, ime.bottom);
                } else {
                    top = in.getSystemWindowInsetTop();
                    left = in.getSystemWindowInsetLeft();
                    right = in.getSystemWindowInsetRight();
                    bottom = in.getSystemWindowInsetBottom();
                }
                v.setPadding(left, 0, right, 0);
                header.setPadding(header.getPaddingLeft(), top, header.getPaddingRight(), header.getPaddingBottom());
                webView.setPadding(0, 0, 0, bottom);
                return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : in.consumeSystemWindowInsets();
            }
        });
    }

    // Botón/gesto «atrás»: si la página puede volver, vuelve; si no, se deja actuar al sistema (sale de la app).
    // Desde Android 16 (targetSdk 36) el sistema ya no manda la tecla «atrás» a onKeyDown: hay que registrar un callback.
    private void updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33 || webView == null) return;
        boolean want = webView.canGoBack();
        if (want == backCallbackRegistered) return;
        if (backCallback == null) {
            backCallback = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    if (webView.canGoBack()) webView.goBack();
                    else unregisterBack();
                }
            };
        }
        if (want) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, (OnBackInvokedCallback) backCallback);
            backCallbackRegistered = true;
        } else {
            unregisterBack();
        }
    }

    private void unregisterBack() {
        if (Build.VERSION.SDK_INT < 33 || backCallback == null || !backCallbackRegistered) return;
        getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
        backCallbackRegistered = false;
    }

    private void requestStoragePermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE") != 0) {
            requestPermissions(new String[]{"android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.READ_EXTERNAL_STORAGE"}, STORAGE_PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue((resultCode != RESULT_OK || data == null || data.getData() == null) ? null : new Uri[]{data.getData()});
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // Android 12 o anterior
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    public class AndroidBridge {
        private final Context context;

        AndroidBridge(Context context) {
            this.context = context;
        }

        // Guarda el PDF del examen en Descargas y abre «Compartir»
        @JavascriptInterface
        public void savePdfBase64(final String fileName, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                final Uri uri = Build.VERSION.SDK_INT >= 29 ? saveToDownloadsScoped(fileName, bytes) : saveToDownloadsLegacy(fileName, bytes);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(context, "PDF guardado en Descargas: " + fileName, Toast.LENGTH_LONG).show();
                        try {
                            Intent share = new Intent(Intent.ACTION_SEND);
                            share.setType("application/pdf");
                            share.putExtra(Intent.EXTRA_STREAM, uri);
                            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            context.startActivity(Intent.createChooser(share, "Compartir examen"));
                        } catch (Exception e) {
                        }
                    }
                });
            } catch (final Exception e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(context, "Error al guardar el PDF: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
            }
        }

        private Uri saveToDownloadsScoped(String fileName, byte[] bytes) throws Exception {
            ContentValues cv = new ContentValues();
            cv.put("_display_name", fileName);
            cv.put("mime_type", "application/pdf");
            cv.put("relative_path", "Download/");
            cv.put("is_pending", 1);
            Uri uri = context.getContentResolver().insert(Uri.parse("content://media/external/downloads"), cv);
            if (uri == null) throw new IOException("No se pudo crear el archivo en Descargas");
            OutputStream out = context.getContentResolver().openOutputStream(uri);
            try {
                out.write(bytes);
            } finally {
                out.close();
            }
            cv.clear();
            cv.put("is_pending", 0);
            context.getContentResolver().update(uri, cv, null, null);
            return uri;
        }

        private Uri saveToDownloadsLegacy(String fileName, byte[] bytes) throws Exception {
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, fileName);
            FileOutputStream out = new FileOutputStream(file);
            try {
                out.write(bytes);
            } finally {
                out.close();
            }
            MediaScannerConnection.scanFile(context, new String[]{file.getAbsolutePath()}, null, null);
            return Uri.parse("content://ar.com.banderavuela.favlapp.fileprovider/" + Uri.encode(fileName));
        }
    }
}

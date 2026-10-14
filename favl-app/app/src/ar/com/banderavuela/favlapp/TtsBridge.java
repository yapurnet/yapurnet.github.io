package ar.com.banderavuela.favlapp;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// Narrador de voz del cuestionario: la página lo usa como window.AndroidTTS y recibe los avisos en
// window.__avlTtsReady(listo) y window.__avlTtsEvt(id, "start" | "done" | "error", motivo).
public class TtsBridge {
    private static final int MAX_CHUNK = 3500;   // el motor de voz no acepta textos muy largos: se cortan en partes

    private final Context ctx;
    private final WebView web;
    private final Object lock = new Object();
    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean failed = false;
    private Runnable pendingSpeak = null;

    public TtsBridge(Context context, WebView webView) {
        this.ctx = context;
        this.web = webView;
        try {
            this.tts = new TextToSpeech(context, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    onEngineInit(status);
                }
            });
        } catch (Throwable t) {
            this.failed = true;
        }
    }

    private void onEngineInit(int status) {
        Runnable pending;
        synchronized (lock) {
            if (status == TextToSpeech.SUCCESS && tts != null) {
                try {
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String id) {
                            emit(id, "start", "");
                        }

                        @Override
                        public void onDone(String id) {
                            emit(id, "done", "");
                        }

                        @Override
                        public void onError(String id) {
                            emit(id, "error", "synthesis-failed");
                        }

                        @Override
                        public void onError(String id, int errorCode) {
                            emit(id, "error", "synthesis-failed");
                        }
                    });
                    ready = true;
                } catch (Throwable t) {
                    failed = true;
                }
            } else {
                failed = true;
            }
            pending = pendingSpeak;
            pendingSpeak = null;
        }
        callJs("window.__avlTtsReady&&window.__avlTtsReady(" + (ready ? "true" : "false") + ")");
        if (pending != null) pending.run();
    }

    // Las partes intermedias de un texto largo llevan el id "id~n": solo se avisa el principio/fin del texto completo
    // (la última parte usa el id original), salvo los errores.
    private void emit(String id, String type, String detail) {
        if (id == null) return;
        int tilde = id.indexOf('~');
        if (tilde >= 0) {
            if (!"error".equals(type)) return;
            id = id.substring(0, tilde);
        }
        callJs("window.__avlTtsEvt&&window.__avlTtsEvt(" + quote(id) + "," + quote(type) + "," + quote(detail) + ")");
    }

    private void callJs(final String js) {
        if (web == null) return;
        web.post(new Runnable() {
            @Override
            public void run() {
                try {
                    web.evaluateJavascript(js, null);
                } catch (Throwable t) {
                }
            }
        });
    }

    private static String quote(String s) {
        if (s == null) return "\"\"";
        return "\"" + jsonEsc(s) + "\"";
    }

    private static String jsonEsc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < ' ') sb.append(' ');
            else sb.append(c);
        }
        return sb.toString();
    }

    @JavascriptInterface
    public boolean isReady() {
        return ready;
    }

    @JavascriptInterface
    public boolean isFailed() {
        return failed;
    }

    @JavascriptInterface
    public String getVoicesJson() {
        StringBuilder sb = new StringBuilder("[");
        try {
            Set<Voice> voices;
            if (ready && tts != null && (voices = tts.getVoices()) != null) {
                boolean first = true;
                for (Voice v : voices) {
                    if (v == null || v.getLocale() == null) continue;
                    try {
                        if (v.getFeatures() != null && v.getFeatures().contains("notInstalled")) continue;
                    } catch (Throwable t) {
                    }
                    String name = v.getName();
                    Locale loc = v.getLocale();
                    int x = name.indexOf("-x-");
                    String label = loc.getDisplayName(new Locale("es")) + " [" + (x >= 0 ? name.substring(x + 3) : name) + "]";
                    if (!first) sb.append(',');
                    sb.append("{\"id\":\"").append(jsonEsc(name))
                      .append("\",\"name\":\"").append(jsonEsc(label))
                      .append("\",\"lang\":\"").append(jsonEsc(loc.toLanguageTag())).append("\"}");
                    first = false;
                }
            }
        } catch (Throwable t) {
        }
        return sb.append(']').toString();
    }

    @JavascriptInterface
    public void speak(final String id, final String text, final String voiceName, final String lang, final double rate, final double pitch) {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                doSpeak(id, text, voiceName, lang, rate, pitch);
            }
        };
        synchronized (lock) {
            if (failed) emit(id, "error", "synthesis-unavailable");
            else if (!ready) pendingSpeak = r;     // el motor todavía arranca: se habla apenas esté listo
            else r.run();
        }
    }

    @JavascriptInterface
    public void stop() {
        synchronized (lock) {
            pendingSpeak = null;
        }
        try {
            if (tts != null) tts.stop();
        } catch (Throwable t) {
        }
    }

    // Primero la voz elegida por nombre; si no, el idioma pedido y después las variantes de español.
    private boolean chooseVoice(String voiceName, String lang) {
        try {
            Set<Voice> voices;
            if (voiceName != null && voiceName.length() > 0 && (voices = tts.getVoices()) != null) {
                for (Voice v : voices) {
                    if (v != null && voiceName.equals(v.getName()) && tts.setVoice(v) == TextToSpeech.SUCCESS) return true;
                }
            }
        } catch (Throwable t) {
        }
        List<Locale> candidates = new ArrayList<>();
        if (lang != null && lang.length() > 0) candidates.add(Locale.forLanguageTag(lang.replace('_', '-')));
        candidates.add(new Locale("es", "AR"));
        candidates.add(new Locale("es", "US"));
        candidates.add(new Locale("es", "MX"));
        candidates.add(new Locale("es", "ES"));
        candidates.add(new Locale("es"));
        for (Locale loc : candidates) {
            try {
                if (tts.isLanguageAvailable(loc) >= TextToSpeech.LANG_AVAILABLE && tts.setLanguage(loc) >= TextToSpeech.LANG_AVAILABLE) return true;
            } catch (Throwable t) {
            }
        }
        return false;
    }

    private void doSpeak(String id, String text, String voiceName, String lang, double rate, double pitch) {
        try {
            if (text == null || text.trim().length() == 0) {
                emit(id, "done", "");
                return;
            }
            if (!chooseVoice(voiceName, lang)) {
                emit(id, "error", "language-unavailable");
                return;
            }
            float r = (float) rate, p = (float) pitch;
            if (r < 0.1f || r > 4.0f) r = 1.0f;
            if (p < 0.1f || p > 2.0f) p = 1.0f;
            tts.setSpeechRate(r);
            tts.setPitch(p);

            // Corta en partes de hasta MAX_CHUNK caracteres: al final de una oración si se puede, si no en un espacio
            List<String> parts = new ArrayList<>();
            while (text.length() > MAX_CHUNK) {
                int cut = -1;
                for (int i = MAX_CHUNK; i > MAX_CHUNK / 2; i--) {
                    char c = text.charAt(i - 1);
                    if (c == '.' || c == '?' || c == '!' || c == ';' || c == '\n') {
                        cut = i;
                        break;
                    }
                }
                if (cut < 0) {
                    cut = text.lastIndexOf(' ', MAX_CHUNK);
                    if (cut < MAX_CHUNK / 2) cut = MAX_CHUNK;
                }
                parts.add(text.substring(0, cut));
                text = text.substring(cut);
            }
            parts.add(text);

            for (int i = 0; i < parts.size(); i++) {
                String uid = (i == parts.size() - 1) ? id : id + "~" + i;
                int mode = (i == 0) ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
                if (tts.speak(parts.get(i), mode, new Bundle(), uid) != TextToSpeech.SUCCESS) {
                    emit(id, "error", "synthesis-failed");
                    return;
                }
            }
        } catch (Throwable t) {
            emit(id, "error", "synthesis-failed");
        }
    }
}

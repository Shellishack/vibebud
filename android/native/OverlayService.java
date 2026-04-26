package dev.vibemoji.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Region;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;

/**
 * Foreground service that renders the vibemoji /buddy route as a transparent
 * system overlay floating on top of every other app. The Android counterpart
 * to desktop/main.js's transparent always-on-top BrowserWindow.
 *
 * Touch passthrough mirrors the desktop click-through behavior: the overlay
 * starts with FLAG_NOT_TOUCHABLE so taps fall through to apps underneath; the
 * web layer toggles it off via the `vibemojiNative.setInteractive(true)` JS
 * bridge whenever the cursor is over an interactive buddy element.
 */
public class OverlayService extends Service {

    public static final String ACTION_START = "dev.vibemoji.android.action.START_OVERLAY";
    public static final String ACTION_STOP = "dev.vibemoji.android.action.STOP_OVERLAY";
    public static final String EXTRA_URL = "dev.vibemoji.android.extra.URL";

    private static final int NOTIFICATION_ID = 4242;
    private static final String CHANNEL_ID = "vibemoji-overlay";

    public static volatile boolean RUNNING = false;

    private WindowManager windowManager;
    private WebView webView;
    private WindowManager.LayoutParams params;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Rect> touchableRects = new ArrayList<>();

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopOverlay();
            return START_NOT_STICKY;
        }

        startInForeground();
        String url = intent != null ? intent.getStringExtra(EXTRA_URL) : null;
        if (url == null || url.isEmpty()) {
            url = "https://localhost/buddy/index.html";
        }
        showOverlay(url);
        return START_STICKY;
    }

    private void startInForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "vibemoji overlay",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps the floating buddy alive while you use other apps.");
            nm.createNotificationChannel(channel);
        }

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("vibemoji is floating")
                .setContentText("Tap the buddy to chat. Stop from inside the app.")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ requires the foregroundServiceType to be declared at start time.
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void showOverlay(String url) {
        if (RUNNING) return;
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) {
            stopSelf();
            return;
        }

        DisplayMetrics dm = getResources().getDisplayMetrics();

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        // Note: FLAG_NOT_TOUCHABLE is intentionally absent. On touchscreen
        // devices there is no hover, so we cannot toggle "interactive" on
        // mousemove the way the desktop shell does. Instead the web layer
        // reports the bounding boxes of every [data-buddy-interactive] element
        // via setTouchableRegion(), and an OnComputeInternalInsetsListener
        // (registered below) tells Android to deliver touches inside those
        // rects to this window and pass everything else through to whatever
        // app is underneath.
        params = new WindowManager.LayoutParams(
                dm.widthPixels,
                dm.heightPixels,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.START | Gravity.TOP;
        params.x = 0;
        params.y = 0;

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        // Map https://localhost/<path> → assets/public/<path>, mirroring the
        // path handler Capacitor's BridgeActivity installs on its own WebView.
        // Without this, https://localhost/buddy/index.html returns ERR_FAILED.
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("localhost")
                .addPathHandler("/", new PublicAssetsHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.addJavascriptInterface(new NativeBridge(), "vibemojiNative");
        webView.loadUrl(url);

        windowManager.addView(webView, params);

        // Touch-region routing. The system asks us each layout pass which
        // sub-rectangle of the window should consume touches; outside that
        // region, touches fall through to the app underneath. The relevant
        // APIs (ViewTreeObserver$OnComputeInternalInsetsListener,
        // ViewTreeObserver$InternalInsetsInfo) are @hide in the SDK stubs but
        // present at runtime on every Android version, so we wire them up via
        // reflection. This is the same approach used by Facebook's chat heads
        // and similar floating-overlay apps.
        installTouchableRegionListener();

        RUNNING = true;
    }

    private void installTouchableRegionListener() {
        try {
            final Class<?> infoClass =
                    Class.forName("android.view.ViewTreeObserver$InternalInsetsInfo");
            final Class<?> listenerClass =
                    Class.forName("android.view.ViewTreeObserver$OnComputeInternalInsetsListener");
            final int TOUCHABLE_INSETS_REGION =
                    infoClass.getField("TOUCHABLE_INSETS_REGION").getInt(null);
            final Method setTouchableInsets =
                    infoClass.getMethod("setTouchableInsets", int.class);
            final Field touchableRegionField = infoClass.getField("touchableRegion");

            InvocationHandler handler = new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                    if ("onComputeInternalInsets".equals(method.getName()) && args != null && args.length == 1) {
                        Object info = args[0];
                        setTouchableInsets.invoke(info, TOUCHABLE_INSETS_REGION);
                        Region region = (Region) touchableRegionField.get(info);
                        if (region != null) {
                            region.setEmpty();
                            synchronized (touchableRects) {
                                for (Rect r : touchableRects) region.union(r);
                            }
                        }
                    }
                    return null;
                }
            };
            Object listener = Proxy.newProxyInstance(
                    listenerClass.getClassLoader(),
                    new Class<?>[]{listenerClass},
                    handler);
            ViewTreeObserver vto = webView.getViewTreeObserver();
            vto.getClass()
                    .getMethod("addOnComputeInternalInsetsListener", listenerClass)
                    .invoke(vto, listener);
        } catch (Throwable t) {
            // If reflection fails (e.g. some hardened OEM ROM), the overlay
            // simply behaves like a fully-touchable window. The buddy still
            // works; tapping empty space won't fall through. Better than no
            // overlay at all.
            android.util.Log.w("vibemoji", "touchable region listener unavailable", t);
        }
    }

    private void stopOverlay() {
        if (webView != null && windowManager != null) {
            try {
                windowManager.removeView(webView);
            } catch (IllegalArgumentException ignored) {
                // already detached
            }
            webView.destroy();
        }
        webView = null;
        windowManager = null;
        params = null;
        RUNNING = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopOverlay();
    }

    /**
     * JS-accessible bridge installed on the overlay WebView. The web layer's
     * existing mousemove handler in core/app/components/Buddy.tsx publishes
     * interactivity intent through window.vibemoji.setInteractive(...); the
     * Capacitor plugin re-emits that as a call to setInteractive() here, which
     * toggles FLAG_NOT_TOUCHABLE on the overlay's LayoutParams. While the flag
     * is set the overlay is purely visual and touches fall through to whatever
     * app is underneath.
     */
    /**
     * Resolves https://localhost/<path> → assets/public/<path>. Trailing
     * slashes get index.html appended (matches Next.js's static-export layout
     * where /buddy/ is served from /buddy/index.html).
     */
    private static class PublicAssetsHandler implements WebViewAssetLoader.PathHandler {
        private final android.content.Context ctx;
        PublicAssetsHandler(android.content.Context ctx) { this.ctx = ctx; }

        @Nullable
        @Override
        public WebResourceResponse handle(@androidx.annotation.NonNull String path) {
            String assetPath = "public/" + path;
            if (assetPath.endsWith("/")) assetPath += "index.html";
            try {
                InputStream is = ctx.getAssets().open(assetPath);
                return new WebResourceResponse(guessMime(assetPath), null, is);
            } catch (IOException e) {
                return null;
            }
        }

        private static String guessMime(String p) {
            if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".json")) return "application/json";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
            if (p.endsWith(".webp")) return "image/webp";
            if (p.endsWith(".ico")) return "image/x-icon";
            if (p.endsWith(".woff2")) return "font/woff2";
            if (p.endsWith(".woff")) return "font/woff";
            if (p.endsWith(".ttf")) return "font/ttf";
            if (p.endsWith(".txt")) return "text/plain";
            return "application/octet-stream";
        }
    }

    public class NativeBridge {
        /**
         * The web layer publishes the bounding rects of every
         * [data-buddy-interactive] element (in device pixels). We replace the
         * touchable region with their union; everything outside falls through
         * to the underlying app.
         */
        @JavascriptInterface
        public void setTouchableRegion(String json) {
            try {
                JSONArray arr = new JSONArray(json == null ? "[]" : json);
                List<Rect> next = new ArrayList<>(arr.length());
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    int x = (int) Math.floor(o.getDouble("x"));
                    int y = (int) Math.floor(o.getDouble("y"));
                    int w = (int) Math.ceil(o.getDouble("w"));
                    int h = (int) Math.ceil(o.getDouble("h"));
                    if (w <= 0 || h <= 0) continue;
                    next.add(new Rect(x, y, x + w, y + h));
                }
                synchronized (touchableRects) {
                    touchableRects.clear();
                    touchableRects.addAll(next);
                }
                // Force a layout pass so onComputeInternalInsets fires with
                // the new region. requestLayout alone is unreliable for this.
                main.post(() -> {
                    if (windowManager == null || webView == null || params == null) return;
                    try {
                        windowManager.updateViewLayout(webView, params);
                    } catch (IllegalArgumentException ignored) { /* detached */ }
                });
            } catch (Exception ignored) { /* malformed JSON */ }
        }

        @JavascriptInterface
        public void setInteractive(final boolean interactive) {
            main.post(() -> {
                if (params == null || windowManager == null || webView == null) return;
                int flags = params.flags;
                if (interactive) {
                    flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                } else {
                    flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                }
                if (flags != params.flags) {
                    params.flags = flags;
                    try {
                        windowManager.updateViewLayout(webView, params);
                    } catch (IllegalArgumentException ignored) {
                        // view detached
                    }
                }
            });
        }
    }
}

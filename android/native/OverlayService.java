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
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
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

import java.io.IOException;
import java.io.InputStream;

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

        params = new WindowManager.LayoutParams(
                dm.widthPixels,
                dm.heightPixels,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
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
        RUNNING = true;
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

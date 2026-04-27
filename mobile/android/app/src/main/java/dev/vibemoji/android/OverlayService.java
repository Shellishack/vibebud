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
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
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
    private static final String PING_CHANNEL_ID = "vibemoji-pings";
    private static final java.util.concurrent.atomic.AtomicInteger PING_ID =
            new java.util.concurrent.atomic.AtomicInteger(5000);

    public static volatile boolean RUNNING = false;

    private WindowManager windowManager;
    private WebView webView;
    private WindowManager.LayoutParams params;
    private final java.util.Map<String, View> tapZones = new java.util.HashMap<>();
    private final java.util.Map<String, WindowManager.LayoutParams> tapZoneParams = new java.util.HashMap<>();
    private boolean tapZonesInteractive = true;
    // Group hull tap-zones: parallel structures, one transparent window per
    // visible group hull. Z-order is below avatar zones so taps on member
    // avatars hit the avatar tap-zone, while taps on empty hull area hit the
    // group tap-zone (drag the whole group).
    private final java.util.Map<String, View> groupZones = new java.util.HashMap<>();
    private final java.util.Map<String, WindowManager.LayoutParams> groupZoneParams = new java.util.HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Rect> touchableRects = new ArrayList<>();
    private volatile boolean nativeDragActive = false;
    private int screenWidth = 0;
    private int screenHeight = 0;

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
        screenWidth = dm.widthPixels;
        screenHeight = dm.heightPixels;

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        // Two-window architecture (single-window touchable-region routing
        // turned out to require a hidden API — OnComputeInternalInsetsListener
        // — which is access-restricted on modern Android and silently fails on
        // many devices, leaving the overlay capturing every touch on screen):
        //
        //   1. Main WebView window: full-screen, FLAG_NOT_TOUCHABLE by default
        //      so it never blocks taps to the apps below. The flag is toggled
        //      off only while the chat popup is open (NativeBridge#setInteractive
        //      from JS), making the popup interactive and at the same time
        //      letting tap-outside-to-dismiss work via a normal click handler.
        //
        //   2. Avatar tap-zone window: a tiny transparent native View sized
        //      to fit just the avatar, with no FLAG_NOT_TOUCHABLE. It captures
        //      taps over the avatar's visual area and dispatches a JS event
        //      to open the chat popup. Anywhere outside both windows falls
        //      through to whatever app is underneath.
        //
        // Trade-off: dragging the avatar is disabled in this revision —
        // re-enabling it requires moving the tap-zone with the gesture and
        // syncing position back to JS, which we can add later.
        // Window is created focusable (no FLAG_NOT_FOCUSABLE) so the soft
        // keyboard can route into chat inputs while the popup is open.
        // Passthrough to background apps is handled entirely by FLAG_NOT_TOUCHABLE
        // (toggled off only while the popup is open). When NOT_TOUCHABLE is set,
        // taps reach the underlying app and that app's window naturally takes
        // focus, so this overlay doesn't permanently steal input from below.
        params = new WindowManager.LayoutParams(
                screenWidth,
                screenHeight,
                type,
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        // Idle overlay must not steal key/focus events — otherwise
                        // the system BACK gesture is captured here and never
                        // reaches the underlying app. Focus is granted only
                        // transiently in setInteractive(true) so chat IME works.
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 0;
        params.y = 0;
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;

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

        // While focus is granted to the overlay (popup open), the BACK gesture
        // would otherwise be consumed by the WebView and never reach the host
        // app. Forward it to JS as a 'vibemoji:back' event (so the popup can
        // close itself and call setInteractive(false), restoring NOT_FOCUSABLE
        // — subsequent BACKs then fall through to the underlying app).
        webView.setOnKeyListener((view, keyCode, event) -> {
            if (keyCode != KeyEvent.KEYCODE_BACK) return false;
            if (params == null
                    || (params.flags & WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) != 0) {
                return false;
            }
            if (event.getAction() == KeyEvent.ACTION_UP) {
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('vibemoji:back'))",
                        null);
            }
            return true;
        });

        webView.loadUrl(url);

        windowManager.addView(webView, params);

        RUNNING = true;
    }

    /**
     * Creates a transparent tap-zone window for one avatar. The OnTouchListener
     * tracks the gesture and forwards bridged events to JS keyed by the buddy's
     * id:
     *   - `vibemoji:avatarTap`        — UP without exceeding the drag threshold
     *   - `vibemoji:avatarDragStart`  — first MOVE past the threshold
     *   - `vibemoji:avatarDragMove`   — subsequent MOVEs (dx, dy in CSS px)
     *   - `vibemoji:avatarDragEnd`    — UP / CANCEL after a drag
     *
     * Once Android delivers ACTION_DOWN to a window, the rest of the gesture
     * (MOVE/UP) keeps coming to that same window even when the finger leaves
     * its bounds, so we don't need to resize the tap-zone mid-drag — JS just
     * suspends position publishing while the drag is in flight.
     */
    private View createTapZoneView(final String id) {
        final float density = getResources().getDisplayMetrics().density;
        final float thresholdPx = 8 * density; // 8dp
        final float[] startRaw = new float[2];
        final boolean[] dragging = new boolean[1];

        View v = new View(this);
        v.setBackgroundColor(Color.TRANSPARENT);
        v.setOnTouchListener((view, ev) -> {
            int a = ev.getActionMasked();
            if (a == MotionEvent.ACTION_DOWN) {
                startRaw[0] = ev.getRawX();
                startRaw[1] = ev.getRawY();
                dragging[0] = false;
                return true;
            } else if (a == MotionEvent.ACTION_MOVE) {
                float dxPx = ev.getRawX() - startRaw[0];
                float dyPx = ev.getRawY() - startRaw[1];
                if (!dragging[0] && (float) Math.hypot(dxPx, dyPx) >= thresholdPx) {
                    dragging[0] = true;
                    dispatchAvatarEvent("vibemoji:avatarDragStart", id, 0f, 0f);
                }
                if (dragging[0]) {
                    dispatchAvatarEvent("vibemoji:avatarDragMove", id, dxPx / density, dyPx / density);
                }
                return true;
            } else if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) {
                if (dragging[0]) {
                    dispatchAvatarEvent("vibemoji:avatarDragEnd", id, 0f, 0f);
                } else if (a == MotionEvent.ACTION_UP) {
                    dispatchAvatarEvent("vibemoji:avatarTap", id, 0f, 0f);
                }
                dragging[0] = false;
                return true;
            }
            return false;
        });
        return v;
    }

    private void dispatchAvatarEvent(String name, String id, float dx, float dy) {
        if (webView == null) return;
        String safe = id.replace("\\", "\\\\").replace("'", "\\'");
        String js = "window.dispatchEvent(new CustomEvent('" + name +
                "',{detail:{id:'" + safe + "',dx:" + dx + ",dy:" + dy + "}}))";
        webView.evaluateJavascript(js, null);
    }

    /**
     * Group hull tap-zone view: same gesture model as the per-avatar zones
     * (8dp drag threshold, tap-vs-drag distinction) but dispatches
     * `vibemoji:groupTap`/`groupDragStart`/`groupDragMove`/`groupDragEnd`
     * keyed by the group id, so the JS BuddyGroup component can move the
     * whole group on touch.
     */
    private View createGroupZoneView(final String gid) {
        final float density = getResources().getDisplayMetrics().density;
        final float thresholdPx = 8 * density;
        final float[] startRaw = new float[2];
        final boolean[] dragging = new boolean[1];

        View v = new View(this);
        v.setBackgroundColor(Color.TRANSPARENT);
        v.setOnTouchListener((view, ev) -> {
            int a = ev.getActionMasked();
            if (a == MotionEvent.ACTION_DOWN) {
                startRaw[0] = ev.getRawX();
                startRaw[1] = ev.getRawY();
                dragging[0] = false;
                return true;
            } else if (a == MotionEvent.ACTION_MOVE) {
                float dxPx = ev.getRawX() - startRaw[0];
                float dyPx = ev.getRawY() - startRaw[1];
                if (!dragging[0] && (float) Math.hypot(dxPx, dyPx) >= thresholdPx) {
                    dragging[0] = true;
                    dispatchGroupEvent("vibemoji:groupDragStart", gid, 0f, 0f);
                }
                if (dragging[0]) {
                    dispatchGroupEvent("vibemoji:groupDragMove", gid, dxPx / density, dyPx / density);
                }
                return true;
            } else if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) {
                if (dragging[0]) {
                    dispatchGroupEvent("vibemoji:groupDragEnd", gid, 0f, 0f);
                } else if (a == MotionEvent.ACTION_UP) {
                    dispatchGroupEvent("vibemoji:groupTap", gid, 0f, 0f);
                }
                dragging[0] = false;
                return true;
            }
            return false;
        });
        return v;
    }

    private void dispatchGroupEvent(String name, String gid, float dx, float dy) {
        if (webView == null) return;
        // The JS layer publishes mode-tagged ids ("group-1:cluster",
        // "group-1:strip") so a transition between handle-strip and cluster
        // tap-zones turns into a clean remove+create at the WindowManager level
        // instead of an updateViewLayout on a window whose touch-dispatch state
        // can get stuck on the previous bounds. Strip the suffix here so
        // listeners on the JS side just see the original gid.
        int colon = gid.indexOf(':');
        String pureGid = colon >= 0 ? gid.substring(0, colon) : gid;
        String safe = pureGid.replace("\\", "\\\\").replace("'", "\\'");
        String js = "window.dispatchEvent(new CustomEvent('" + name +
                "',{detail:{id:'" + safe + "',dx:" + dx + ",dy:" + dy + "}}))";
        webView.evaluateJavascript(js, null);
    }

    private WindowManager.LayoutParams newTapZoneParams(int x, int y, int w, int h) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        if (!tapZonesInteractive) flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(w, h, type, flags, PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.START;
        p.x = x;
        p.y = y;
        return p;
    }

    private void stopOverlay() {
        if (windowManager != null) {
            for (View v : tapZones.values()) {
                try { windowManager.removeView(v); }
                catch (IllegalArgumentException ignored) { /* detached */ }
            }
            for (View v : groupZones.values()) {
                try { windowManager.removeView(v); }
                catch (IllegalArgumentException ignored) { /* detached */ }
            }
            if (webView != null) {
                try {
                    windowManager.removeView(webView);
                } catch (IllegalArgumentException ignored) {
                    // already detached
                }
                webView.destroy();
            }
        }
        tapZones.clear();
        tapZoneParams.clear();
        groupZones.clear();
        groupZoneParams.clear();
        webView = null;
        windowManager = null;
        params = null;
        nativeDragActive = false;
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

    /**
     * Posts a one-shot system notification on the "vibemoji-pings" channel.
     * Called from the JS bridge when the user has chosen "native" as their
     * notification method (vs the default in-overlay toast). Channel is
     * created lazily on first call.
     */
    public static void showSystemNotification(Context ctx, String title, String body) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    PING_CHANNEL_ID,
                    "vibemoji pings",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            ch.setDescription("Agent activity, PR updates, and other buddy pings.");
            nm.createNotificationChannel(ch);
        }
        Notification n = new NotificationCompat.Builder(ctx, PING_CHANNEL_ID)
                .setContentTitle(title == null ? "vibemoji" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build();
        try {
            nm.notify(PING_ID.incrementAndGet(), n);
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted on Android 13+; caller should
            // have requested permission first.
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
                // Force a measurement pass so onComputeInternalInsets fires
                // with the new region. requestLayout is much lighter than
                // WindowManager.updateViewLayout — the latter sometimes
                // perturbs in-flight gesture routing and was causing taps to
                // "die" after a drag in earlier iterations.
                main.post(() -> {
                    if (webView != null) webView.requestLayout();
                });
            } catch (Exception ignored) { /* malformed JSON */ }
        }

        // The window is full-screen at all times now, so JS-driven expansion is
        // a no-op. Kept as a binding so older bundled JS that still calls this
        // doesn't throw across the bridge.
        @JavascriptInterface
        public void setExpanded(final boolean expanded) { /* no-op */ }

        /**
         * Synchronizes the per-buddy tap-zone windows with a JSON array of
         * `{id, x, y, w, h}` (device pixels, screen-origin top-left). Adds new
         * ids, repositions existing ones, removes ids that are no longer in
         * the list. Each tap-zone forwards its id when tapped so only that
         * buddy's popup opens.
         */
        @JavascriptInterface
        public void setAvatarRects(final String json) {
            main.post(() -> {
                if (windowManager == null) return;
                JSONArray arr;
                try { arr = new JSONArray(json == null ? "[]" : json); }
                catch (Exception e) { return; }

                java.util.Set<String> seen = new java.util.HashSet<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    String id = o.optString("id", null);
                    if (id == null) continue;
                    int x = (int) Math.floor(o.optDouble("x", 0));
                    int y = (int) Math.floor(o.optDouble("y", 0));
                    int w = (int) Math.ceil(o.optDouble("w", 0));
                    int h = (int) Math.ceil(o.optDouble("h", 0));
                    if (w <= 0 || h <= 0) continue;
                    seen.add(id);

                    View v = tapZones.get(id);
                    WindowManager.LayoutParams p = tapZoneParams.get(id);
                    if (v == null) {
                        v = createTapZoneView(id);
                        p = newTapZoneParams(x, y, w, h);
                        try {
                            windowManager.addView(v, p);
                            tapZones.put(id, v);
                            tapZoneParams.put(id, p);
                        } catch (Throwable t) {
                            android.util.Log.w("vibemoji", "tap-zone add failed for " + id, t);
                        }
                    } else if (p != null) {
                        if (p.x != x || p.y != y || p.width != w || p.height != h) {
                            p.x = x; p.y = y; p.width = w; p.height = h;
                            try { windowManager.updateViewLayout(v, p); }
                            catch (IllegalArgumentException ignored) { /* detached */ }
                        }
                    }
                }

                // Remove tap-zones whose ids dropped out.
                java.util.Iterator<java.util.Map.Entry<String, View>> it = tapZones.entrySet().iterator();
                while (it.hasNext()) {
                    java.util.Map.Entry<String, View> entry = it.next();
                    if (seen.contains(entry.getKey())) continue;
                    try { windowManager.removeView(entry.getValue()); }
                    catch (IllegalArgumentException ignored) { /* detached */ }
                    tapZoneParams.remove(entry.getKey());
                    it.remove();
                }
            });
        }

        /**
         * Same shape as {@link #setAvatarRects} but for group hull windows.
         * After any new hull is added, we re-stack all avatar tap-zones on
         * top (Android keeps later-added windows above earlier ones, so a
         * fresh hull would otherwise shadow existing avatars and steal their
         * taps).
         */
        @JavascriptInterface
        public void setGroupRects(final String json) {
            main.post(() -> {
                if (windowManager == null) return;
                JSONArray arr;
                try { arr = new JSONArray(json == null ? "[]" : json); }
                catch (Exception e) { return; }

                java.util.Set<String> seen = new java.util.HashSet<>();
                boolean addedNew = false;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    String gid = o.optString("id", null);
                    if (gid == null) continue;
                    int x = (int) Math.floor(o.optDouble("x", 0));
                    int y = (int) Math.floor(o.optDouble("y", 0));
                    int w = (int) Math.ceil(o.optDouble("w", 0));
                    int h = (int) Math.ceil(o.optDouble("h", 0));
                    if (w <= 0 || h <= 0) continue;
                    seen.add(gid);

                    View v = groupZones.get(gid);
                    WindowManager.LayoutParams p = groupZoneParams.get(gid);
                    if (v == null) {
                        v = createGroupZoneView(gid);
                        p = newTapZoneParams(x, y, w, h);
                        try {
                            windowManager.addView(v, p);
                            groupZones.put(gid, v);
                            groupZoneParams.put(gid, p);
                            addedNew = true;
                        } catch (Throwable t) {
                            android.util.Log.w("vibemoji", "group-zone add failed for " + gid, t);
                        }
                    } else if (p != null) {
                        if (p.x != x || p.y != y || p.width != w || p.height != h) {
                            p.x = x; p.y = y; p.width = w; p.height = h;
                            try { windowManager.updateViewLayout(v, p); }
                            catch (IllegalArgumentException ignored) { /* detached */ }
                        }
                    }
                }

                // Remove group-zones whose ids dropped out.
                java.util.Iterator<java.util.Map.Entry<String, View>> it = groupZones.entrySet().iterator();
                while (it.hasNext()) {
                    java.util.Map.Entry<String, View> entry = it.next();
                    if (seen.contains(entry.getKey())) continue;
                    try { windowManager.removeView(entry.getValue()); }
                    catch (IllegalArgumentException ignored) { /* detached */ }
                    groupZoneParams.remove(entry.getKey());
                    it.remove();
                }

                // Keep avatar zones above group zones: newly-added hulls
                // would otherwise sit on top of existing avatars and shadow
                // their taps. Re-add (raise) all current avatar windows.
                if (addedNew && !tapZones.isEmpty()) {
                    for (java.util.Map.Entry<String, View> entry : tapZones.entrySet()) {
                        WindowManager.LayoutParams ap = tapZoneParams.get(entry.getKey());
                        if (ap == null) continue;
                        try { windowManager.removeView(entry.getValue()); }
                        catch (IllegalArgumentException ignored) { /* detached */ }
                        try { windowManager.addView(entry.getValue(), ap); }
                        catch (Throwable t) {
                            android.util.Log.w("vibemoji", "avatar-zone re-stack failed for " + entry.getKey(), t);
                        }
                    }
                }
            });
        }

        /**
         * Failsafe: lets the overlay's own UI tear itself down. Critical if the
         * touch-region publishing has a bug — without this, a misconfigured
         * overlay can swallow every touch on screen and the user has no way to
         * switch apps to kill it. Wired to a "Close overlay" button in the
         * chat panel.
         */
        @JavascriptInterface
        public void stopOverlay() {
            main.post(() -> {
                Intent svc = new Intent(OverlayService.this, OverlayService.class);
                svc.setAction(ACTION_STOP);
                startService(svc);
            });
        }

        /**
         * Toggles the main WebView window between passthrough (default) and
         * fully-interactive modes, and inversely toggles the avatar tap-zone
         * window so the two never both fight for the same touch:
         *
         *   setInteractive(true)  — popup mode: main window receives touches
         *                           everywhere (so popup UI works); tap-zone
         *                           is disabled (otherwise it'd shadow popup
         *                           hits over the avatar's visual area).
         *
         *   setInteractive(false) — idle mode: main window is FLAG_NOT_TOUCHABLE
         *                           so taps fall through to background apps;
         *                           tap-zone is the only thing capturing
         *                           taps, used to open the popup.
         */
        @JavascriptInterface
        public void setInteractive(final boolean interactive) {
            main.post(() -> {
                if (params == null || windowManager == null || webView == null) return;
                int mainFlags = params.flags;
                if (interactive) {
                    mainFlags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                    // Grant focus so the chat IME works AND so the overlay
                    // receives the BACK key (intercepted by webView's key
                    // listener to close the popup instead of the host app).
                    mainFlags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                } else {
                    mainFlags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                    // Drop focus immediately when popup closes so BACK falls
                    // through to whatever app is underneath.
                    mainFlags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                }
                if (mainFlags != params.flags) {
                    params.flags = mainFlags;
                    try {
                        windowManager.updateViewLayout(webView, params);
                    } catch (IllegalArgumentException ignored) { /* view detached */ }
                }
                tapZonesInteractive = !interactive;
                for (java.util.Map.Entry<String, View> entry : tapZones.entrySet()) {
                    WindowManager.LayoutParams tzp = tapZoneParams.get(entry.getKey());
                    if (tzp == null) continue;
                    int tzFlags = tzp.flags;
                    if (interactive) {
                        tzFlags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                    } else {
                        tzFlags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                    }
                    if (tzFlags != tzp.flags) {
                        tzp.flags = tzFlags;
                        try { windowManager.updateViewLayout(entry.getValue(), tzp); }
                        catch (IllegalArgumentException ignored) { /* detached */ }
                    }
                }
            });
        }

        /**
         * Like {@link #setInteractive} but ONLY toggles the main WebView's
         * touchable flag — does NOT disable avatar/group tap-zones. Used when
         * a group is expanded/peeked: we want outside-tap-dismiss to work
         * (which requires the WebView to receive empty-area touches), but we
         * also need per-avatar tap-zones to keep capturing member taps and
         * drags. Tap-zones sit above the WebView in z-order, so they still
         * win over the WebView for touches inside their bounds.
         */
        @JavascriptInterface
        public void showNotification(final String json) {
            try {
                JSONObject o = new JSONObject(json == null ? "{}" : json);
                final String title = o.optString("title", "vibemoji");
                final String body = o.optString("body", "");
                main.post(() -> showSystemNotification(OverlayService.this, title, body));
            } catch (Exception ignored) { /* malformed JSON */ }
        }

        @JavascriptInterface
        public String hasNotificationPermission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
            int r = androidx.core.content.ContextCompat.checkSelfPermission(
                    OverlayService.this, android.Manifest.permission.POST_NOTIFICATIONS);
            return r == android.content.pm.PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            // The overlay service doesn't have an Activity context to drive
            // the runtime permission dialog. Best we can do is open the app's
            // notification settings page so the user can flip the toggle.
            main.post(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Throwable ignored) { /* fall through */ }
            });
        }

        @JavascriptInterface
        public void setSpilledOut(final boolean spilled) {
            main.post(() -> {
                if (params == null || windowManager == null || webView == null) return;
                int mainFlags = params.flags;
                if (spilled) {
                    mainFlags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                } else {
                    mainFlags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                }
                if (mainFlags != params.flags) {
                    params.flags = mainFlags;
                    try { windowManager.updateViewLayout(webView, params); }
                    catch (IllegalArgumentException ignored) { /* detached */ }
                }
            });
        }
    }
}

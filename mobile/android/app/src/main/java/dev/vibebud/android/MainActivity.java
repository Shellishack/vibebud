package dev.vibebud.android;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    public static final String EXTRA_SCAN_PAIR = "dev.vibebud.android.extra.SCAN_PAIR";
    // `return=close` tells /scan to call closeScanActivity() after success,
    // dropping MainActivity off the back stack so the user lands on the
    // overlay (which is still on top below us).
    private static final String SCAN_URL = "https://localhost/scan/?return=close";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OverlayPlugin.class);
        super.onCreate(savedInstanceState);
        // Expose a host bridge so the /scan route can dismiss this activity
        // once it's done. Mirrors the vibebudNative pattern used by the
        // overlay's WebView. Capacitor's plugin bridge isn't a fit here
        // because we just need a one-shot finish() — not a plugin lifecycle.
        WebView wv = bridge != null ? bridge.getWebView() : null;
        if (wv != null) wv.addJavascriptInterface(new HostBridge(), "vibebudHost");
        handlePairingIntent(getIntent());
        maybeRouteToScan(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePairingIntent(intent);
        maybeRouteToScan(intent);
    }

    /** Switches the WebView to the dedicated scanner route when launched
     *  with EXTRA_SCAN_PAIR. The scanner route uses the Capacitor MLKit
     *  plugin (which lives in this BridgeActivity's WebView only) to drive
     *  Google's hosted scanner UI. */
    private void maybeRouteToScan(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(EXTRA_SCAN_PAIR, false)) return;
        // Clear the flag so a later getIntent() during normal use doesn't
        // re-route on configuration changes.
        intent.removeExtra(EXTRA_SCAN_PAIR);
        WebView wv = bridge != null ? bridge.getWebView() : null;
        if (wv == null) {
            Toast.makeText(this, "Scan: WebView not ready", Toast.LENGTH_LONG).show();
            return;
        }
        wv.post(() -> wv.loadUrl(SCAN_URL));
    }

    /**
     * Handles a vibebud://pair?url=...&token=... deep link. The desktop tray
     * "Pair phone…" command shows a QR encoding this URI; scanning it with the
     * phone's camera fires VIEW with our intent filter, landing here. We write
     * the pair into the WebView's localStorage so RemoteClaudeBridge picks it
     * up, then ask OverlayService to reload so any running overlay refreshes
     * its config too.
     */
    private void handlePairingIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!"vibebud".equals(data.getScheme()) || !"pair".equals(data.getHost())) return;

        String url = data.getQueryParameter("url");
        String token = data.getQueryParameter("token");
        if (url == null || token == null || url.isEmpty() || token.isEmpty()) {
            Toast.makeText(this, "Pairing link is missing url or token", Toast.LENGTH_LONG).show();
            return;
        }

        String json;
        try {
            json = new JSONObject().put("url", url).put("token", token).toString();
        } catch (Exception e) {
            Toast.makeText(this, "Pairing failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }

        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            String js = "try { localStorage.setItem('vibebud.claudeRemote.v1', "
                    + JSONObject.quote(json)
                    + "); window.dispatchEvent(new CustomEvent('vibebud:paired')); } catch(e) {}";
            webView.evaluateJavascript(js, null);
        }

        if (OverlayService.RUNNING) {
            Intent reload = new Intent(this, OverlayService.class);
            reload.setAction(OverlayService.ACTION_RELOAD);
            startService(reload);
        }

        Toast.makeText(this, "Paired with desktop ✓", Toast.LENGTH_SHORT).show();
    }

    public class HostBridge {
        /** Called from the /scan route when the user is done (success, cancel,
         *  or fatal error). Drops MainActivity from the back stack so the
         *  user lands back on whatever was underneath (typically the overlay
         *  on top of their previous app). */
        @JavascriptInterface
        public void closeScanActivity() {
            new Handler(Looper.getMainLooper()).post(MainActivity.this::finish);
        }
    }
}

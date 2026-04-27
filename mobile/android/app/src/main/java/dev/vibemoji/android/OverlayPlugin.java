package dev.vibemoji.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor bridge for the floating-overlay service. The renderer calls these
 * from core/ via Capacitor.Plugins.Overlay.{requestPermission,start,stop,setInteractive}.
 *
 * Counterpart to desktop/preload.js's window.vibemoji.* IPC surface.
 */
@CapacitorPlugin(name = "Overlay")
public class OverlayPlugin extends Plugin {

    @PluginMethod
    public void hasPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(getContext());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(getContext())) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        // We can't synchronously wait for the user; the renderer should poll
        // hasPermission() after returning to the app.
        JSObject ret = new JSObject();
        ret.put("granted", false);
        ret.put("opened", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && !Settings.canDrawOverlays(getContext())) {
            call.reject("Overlay permission not granted");
            return;
        }
        String url = call.getString("url");
        Intent svc = new Intent(getContext(), OverlayService.class);
        svc.setAction(OverlayService.ACTION_START);
        if (url != null && !url.isEmpty()) {
            svc.putExtra(OverlayService.EXTRA_URL, url);
        }
        ContextCompat.startForegroundService(getContext(), svc);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent svc = new Intent(getContext(), OverlayService.class);
        svc.setAction(OverlayService.ACTION_STOP);
        getContext().startService(svc);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", OverlayService.RUNNING);
        call.resolve(ret);
    }

    /**
     * Bridge from the host activity's WebView (the regular Capacitor one). The
     * overlay service has its own NativeBridge; this method exists so that the
     * in-app UI (not the overlay itself) can also toggle interactivity if it
     * ever needs to. In practice the overlay's own JS calls vibemojiNative
     * directly.
     */
    @PluginMethod
    public void setInteractive(PluginCall call) {
        // No-op from the host activity — the overlay's own WebView owns the
        // flag toggle via its NativeBridge. Kept for API symmetry.
        call.resolve();
    }

    @PluginMethod
    public void showNotification(PluginCall call) {
        String title = call.getString("title", "vibemoji");
        String body = call.getString("body", "");
        OverlayService.showSystemNotification(getContext(), title, body);
        call.resolve();
    }

    @PluginMethod
    public void hasNotificationPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        ActivityCompat.requestPermissions(
                activity,
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                4243
        );
        JSObject ret = new JSObject();
        ret.put("granted", false);
        ret.put("requested", true);
        call.resolve(ret);
    }
}

package dev.vibemoji.android;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Tiny transparent activity dedicated to the POST_NOTIFICATIONS runtime
 * permission flow. Lives outside Capacitor's BridgeActivity so the system
 * dialog appears immediately without the whole web stack booting first.
 *
 * Triggered by {@link OverlayService#requestNotificationPermission()}.
 */
public class PermissionRequestActivity extends Activity {
    private static final String TAG = "VibemojiPerm";
    private static final int REQ_POST_NOTIFICATIONS = 0xB001;
    private static final String PREFS = "vibemoji.perms";
    private static final String KEY_ASKED_NOTIF = "askedPostNotifications";

    private boolean dialogAttempted = false;
    private boolean dialogShown = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(TAG, "PermissionRequestActivity onCreate, SDK=" + Build.VERSION.SDK_INT);
        toast("Permission flow started (SDK " + Build.VERSION.SDK_INT + ")");

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // No runtime permission to ask for on pre-13. Fall back to app
            // notification settings so the user can flip "Allow notifications".
            openAppNotificationSettings();
            finish();
            return;
        }

        String perm = android.Manifest.permission.POST_NOTIFICATIONS;
        int cur = ContextCompat.checkSelfPermission(this, perm);
        if (cur == PackageManager.PERMISSION_GRANTED) {
            toast("Permission already granted");
            finish();
            return;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean haveAsked = prefs.getBoolean(KEY_ASKED_NOTIF, false);
        boolean canShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(this, perm);
        Log.i(TAG, "haveAsked=" + haveAsked + " canShowRationale=" + canShowRationale);

        if (haveAsked && !canShowRationale) {
            toast("Previously denied — opening App Settings");
            openAppDetailsSettings();
            finish();
            return;
        }

        prefs.edit().putBoolean(KEY_ASKED_NOTIF, true).apply();
        dialogAttempted = true;
        ActivityCompat.requestPermissions(this, new String[]{ perm }, REQ_POST_NOTIFICATIONS);

        // Belt-and-braces: if the dialog never actually surfaces (some OEMs
        // silently no-op a second-attempt request even when rationale claims
        // it would show), give it a beat then fall back to settings.
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!isFinishing() && !dialogShown) {
                toast("Dialog didn't appear — opening App Settings");
                openAppDetailsSettings();
                finish();
            }
        }, 1200);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Losing window focus shortly after we requested permissions means
        // the system dialog has appeared on top of us — that's our signal.
        if (dialogAttempted && !hasFocus) dialogShown = true;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_POST_NOTIFICATIONS) {
            finish();
            return;
        }
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        Log.i(TAG, "onRequestPermissionsResult granted=" + granted);
        if (granted) {
            toast("Notifications enabled ✓");
            finish();
            return;
        }
        // User denied. If shouldShowRationale is now false, we're in the
        // "permanently denied" state — guide them to settings.
        String perm = android.Manifest.permission.POST_NOTIFICATIONS;
        boolean canShowRationale = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ActivityCompat.shouldShowRequestPermissionRationale(this, perm);
        if (!canShowRationale) {
            toast("Denied — opening Permissions in App Settings");
            openAppDetailsSettings();
        } else {
            toast("Permission denied");
        }
        finish();
    }

    private void openAppNotificationSettings() {
        try {
            Intent s = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            s.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(s);
        } catch (Throwable t) {
            toast("Couldn't open notification settings: " + t.getMessage());
        }
    }

    private void openAppDetailsSettings() {
        try {
            Intent s = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(s);
        } catch (Throwable t) {
            toast("Couldn't open app settings: " + t.getMessage());
        }
    }

    private void toast(String msg) {
        Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_SHORT).show();
    }
}

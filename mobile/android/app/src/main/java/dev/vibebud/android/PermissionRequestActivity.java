package dev.vibebud.android;

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
 * Tiny transparent activity that runs runtime permission requests outside
 * Capacitor's BridgeActivity, so the dialog appears immediately without the
 * web stack booting first. Triggered by {@link OverlayService}.
 *
 * Pass EXTRA_PERMISSION (e.g. android.Manifest.permission.CAMERA) to ask for
 * a specific permission. Defaults to POST_NOTIFICATIONS for back-compat with
 * existing callers.
 */
public class PermissionRequestActivity extends Activity {
    private static final String TAG = "VibebudPerm";
    public static final String EXTRA_PERMISSION = "dev.vibebud.android.extra.PERMISSION";
    private static final int REQ_CODE = 0xB001;
    private static final String PREFS = "vibebud.perms";

    private boolean dialogAttempted = false;
    private boolean dialogShown = false;
    private String requestedPerm = android.Manifest.permission.POST_NOTIFICATIONS;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        if (in != null && in.hasExtra(EXTRA_PERMISSION)) {
            String p = in.getStringExtra(EXTRA_PERMISSION);
            if (p != null && !p.isEmpty()) requestedPerm = p;
        }
        Log.i(TAG, "onCreate perm=" + requestedPerm + " SDK=" + Build.VERSION.SDK_INT);

        // POST_NOTIFICATIONS is only a runtime permission on Android 13+.
        // Other permissions (CAMERA) are runtime on all versions we target.
        boolean isPostNotifications =
                android.Manifest.permission.POST_NOTIFICATIONS.equals(requestedPerm);
        if (isPostNotifications && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            openAppNotificationSettings();
            finish();
            return;
        }

        int cur = ContextCompat.checkSelfPermission(this, requestedPerm);
        if (cur == PackageManager.PERMISSION_GRANTED) {
            finish();
            return;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String askedKey = "asked:" + requestedPerm;
        boolean haveAsked = prefs.getBoolean(askedKey, false);
        boolean canShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(this, requestedPerm);
        Log.i(TAG, "haveAsked=" + haveAsked + " canShowRationale=" + canShowRationale);

        if (haveAsked && !canShowRationale) {
            toast("Previously denied — opening App Settings");
            openAppDetailsSettings();
            finish();
            return;
        }

        prefs.edit().putBoolean(askedKey, true).apply();
        dialogAttempted = true;
        ActivityCompat.requestPermissions(this, new String[]{ requestedPerm }, REQ_CODE);

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
        if (dialogAttempted && !hasFocus) dialogShown = true;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_CODE) {
            finish();
            return;
        }
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        Log.i(TAG, "onRequestPermissionsResult perm=" + requestedPerm + " granted=" + granted);
        if (!granted) {
            boolean canShowRationale =
                    ActivityCompat.shouldShowRequestPermissionRationale(this, requestedPerm);
            if (!canShowRationale) {
                toast("Denied — opening Permissions in App Settings");
                openAppDetailsSettings();
            } else {
                toast("Permission denied");
            }
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

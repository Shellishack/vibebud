# vibebud-android

Capacitor shell that renders `core/`'s `/buddy` route as a **system overlay** floating on top of every other app. Counterpart to `desktop/`'s Electron transparent always-on-top window.

## How it works

Capacitor's default WebView lives inside an Activity, so it disappears the moment the user leaves the app. To stay floating across the home screen and other apps, vibebud adds a small native module:

- **`OverlayService`** — a foreground `Service` that owns its own transparent `WebView` and adds it to `WindowManager` with `TYPE_APPLICATION_OVERLAY` (API 26+, falls back to `TYPE_PHONE`). The WebView loads `/buddy/index.html` from the bundled assets (or a dev URL).
- **`OverlayPlugin`** — Capacitor plugin exposed to the renderer as `Capacitor.Plugins.Overlay`:
  - `hasPermission()` → `{ granted }`
  - `requestPermission()` → opens system overlay-permission settings if needed
  - `start({ url? })` / `stop()` — control the foreground service
  - `isRunning()` → `{ running }`
- **JS bridge** — the overlay's WebView gets a `window.vibebudNative` object with `setInteractive(boolean)`, called from the existing `core/` interactivity detector. While `false`, the overlay sets `FLAG_NOT_TOUCHABLE` and taps fall through to whatever app is underneath. While `true` (cursor over a `data-buddy-interactive` element), the buddy and chat bubble accept touches.

## One-time setup

```bash
# from vibebud/
npm run install-all          # installs core/, desktop/, android/

cd android
npx cap add android          # generates android/android/ (Gradle project)
node install-overlay.js      # drops native sources in + patches manifest + MainActivity
```

You'll need:

- Android Studio (or at least the Android SDK + platform-tools on `PATH`).
- **JDK 21** (Capacitor 8 requirement).
- Android Gradle Plugin 8.7.2+ / Gradle 8.11+ — set up automatically by `cap add android`.
- `minSdk` 24, `targetSdk` 35 (Capacitor 8 defaults).
- An emulator (API 26+ recommended) or a device with USB debugging enabled.

## Dev loop

```bash
# terminal A
npm run web-dev              # core dev server on http://localhost:3060

# terminal B
npm run android-dev          # builds debug APK, installs, points at 10.0.2.2:3060
```

Inside the running app:

1. Tap **"Float on top of my apps"** → Android Settings opens.
2. Toggle "Allow display over other apps" for vibebud, return.
3. Tap again → the foreground service starts and the buddy appears as an overlay.
4. Press home, open another app — the buddy stays on top.

## Building an APK

**Quickest — debug APK via the Gradle wrapper.** No signing setup needed; Gradle uses the Android SDK's auto-generated debug keystore.

```bash
# from vibebud/android/android/
./gradlew.bat assembleDebug         # Windows
./gradlew assembleDebug             # macOS / Linux
# → app/build/outputs/apk/debug/app-debug.apk
```

**Capacitor CLI build.** Does `sync` + plugin update + Gradle in one step, but Capacitor 8's `cap build` always requires keystore credentials (`--no-signing` is not a flag). For dev builds, generate a throwaway debug keystore once:

```powershell
# from vibebud/android/
keytool -genkeypair -v -keystore debug.keystore `
  -storepass android -alias androiddebugkey -keypass android `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -dname "CN=Android Debug,O=Android,C=US"

npx cap build android --androidreleasetype=APK `
  --keystorepath debug.keystore --keystorepass android `
  --keystorealias androiddebugkey --keystorealiaspass android
# → android/app/build/outputs/apk/release/app-release-signed.apk
```

For distribution, replace the throwaway keystore with your own and keep its password out of source control.

## Permission notes

- **`SYSTEM_ALERT_WINDOW`** — required for any overlay above other apps. Must be granted manually by the user via Settings; there is no runtime dialog.
- **`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE`** — required on Android 14+ to keep the service alive. The manifest declares `android:foregroundServiceType="specialUse"` with the subtype `floating_overlay_buddy`.
- **`POST_NOTIFICATIONS`** — Android 13+ requires the user to allow the persistent foreground-service notification. The Capacitor app should call `Notification.requestPermission()`-style flows on first launch (not yet wired up — TODO).

## Troubleshooting

- **Overlay doesn't appear after granting permission** → some OEMs (Xiaomi, Huawei) require an extra app-specific toggle in their custom Settings. Check the device's "Other permissions" or "Display popup window" page.
- **WebView shows a white background** → ensure the loaded route returns a transparent body. `core/app/buddy/page.tsx` injects `html, body { background: transparent !important; }` for this reason.
- **Service killed in the background** → some OEMs aggressively kill foreground services. Disable battery optimization for vibebud in Settings → Apps → vibebud → Battery.

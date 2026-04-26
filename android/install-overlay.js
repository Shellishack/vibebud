#!/usr/bin/env node
/**
 * Patches the Capacitor-generated Android project with the floating-overlay
 * service, plugin, manifest entries, and MainActivity registration.
 *
 * Run once after `npx cap add android`. Idempotent — re-running is safe.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ANDROID = path.join(ROOT, 'android');
const PKG_PATH = ['app', 'src', 'main', 'java', 'dev', 'vibemoji', 'android'];
const JAVA_DIR = path.join(ANDROID, ...PKG_PATH);
const MANIFEST = path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml');
const MAIN_ACTIVITY = path.join(JAVA_DIR, 'MainActivity.java');
const APP_BUILD_GRADLE = path.join(ANDROID, 'app', 'build.gradle');

if (!fs.existsSync(ANDROID)) {
  console.error('[install-overlay] android/android/ not found.');
  console.error('  Run `npx cap add android` first.');
  process.exit(1);
}

fs.mkdirSync(JAVA_DIR, { recursive: true });

// 1. Drop in the Java sources.
for (const name of ['OverlayService.java', 'OverlayPlugin.java']) {
  const src = path.join(ROOT, 'native', name);
  const dst = path.join(JAVA_DIR, name);
  fs.copyFileSync(src, dst);
  console.log(`[install-overlay] wrote ${path.relative(ROOT, dst)}`);
}

// 2. Patch AndroidManifest.xml.
if (fs.existsSync(MANIFEST)) {
  let xml = fs.readFileSync(MANIFEST, 'utf8');
  const permsBlock =
    '\n    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />' +
    '\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />' +
    '\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />' +
    '\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n';
  if (!xml.includes('android.permission.SYSTEM_ALERT_WINDOW')) {
    xml = xml.replace(/(\n\s*<application\b)/, permsBlock + '$1');
  }

  const serviceBlock =
    '\n        <service\n' +
    '            android:name=".OverlayService"\n' +
    '            android:exported="false"\n' +
    '            android:foregroundServiceType="specialUse">\n' +
    '            <property\n' +
    '                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"\n' +
    '                android:value="floating_overlay_buddy" />\n' +
    '        </service>\n';
  if (!xml.includes('".OverlayService"')) {
    xml = xml.replace(/(\n\s*<\/application>)/, serviceBlock + '$1');
  }

  fs.writeFileSync(MANIFEST, xml);
  console.log('[install-overlay] patched AndroidManifest.xml');
} else {
  console.warn(`[install-overlay] manifest not found at ${MANIFEST}`);
}

// 3. Register the plugin in MainActivity.
if (fs.existsSync(MAIN_ACTIVITY)) {
  let java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  if (!java.includes('registerPlugin(OverlayPlugin.class)')) {
    if (java.includes('public class MainActivity')) {
      // Capacitor's BridgeActivity runs the bridge in onCreate. Override it to
      // register our plugin before super.onCreate runs (Capacitor requires
      // registerPlugin BEFORE onCreate).
      const onCreateOverride =
        '\n    @Override\n' +
        '    public void onCreate(android.os.Bundle savedInstanceState) {\n' +
        '        registerPlugin(OverlayPlugin.class);\n' +
        '        super.onCreate(savedInstanceState);\n' +
        '    }\n';
      java = java.replace(
        /public class MainActivity[^{]*\{/,
        (m) => m + onCreateOverride
      );
      fs.writeFileSync(MAIN_ACTIVITY, java);
      console.log('[install-overlay] patched MainActivity.java');
    } else {
      console.warn('[install-overlay] could not locate MainActivity class declaration');
    }
  } else {
    console.log('[install-overlay] MainActivity already registers OverlayPlugin');
  }
} else {
  console.warn(`[install-overlay] MainActivity not found at ${MAIN_ACTIVITY}`);
  console.warn('  This is expected if your package path differs. Edit the script or move the file.');
}

// 4. Add androidx.webkit dependency (used by OverlayService's WebViewAssetLoader).
if (fs.existsSync(APP_BUILD_GRADLE)) {
  let gradle = fs.readFileSync(APP_BUILD_GRADLE, 'utf8');
  if (!gradle.includes('androidx.webkit:webkit')) {
    gradle = gradle.replace(
      /implementation project\(':capacitor-android'\)/,
      "implementation \"androidx.webkit:webkit:1.12.1\"\n    implementation project(':capacitor-android')"
    );
    fs.writeFileSync(APP_BUILD_GRADLE, gradle);
    console.log('[install-overlay] added androidx.webkit dependency to app/build.gradle');
  } else {
    console.log('[install-overlay] androidx.webkit already present in app/build.gradle');
  }
}

console.log('[install-overlay] done.');

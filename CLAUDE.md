# vibemoji

A friendly "code buddy" UI that floats on the user's desktop (or Android device), surfaces what AI agents are doing on the user's behalf, and prompts for input when action is needed. Companion to `gh-autopilot` (sibling repo) but usable on its own.

## Product shape

- A **floating avatar** that lives on top of the user's other windows. Avatars are Lottie-animated and come in six color/personality variants (Helper, Tactician, Researcher, Skeptic, Cheerleader, Empath). Users can spawn additional buddies, drag them around, and merge them into groups.
- **Chat bubbles** for conversational interaction with the buddy. Each personality has its own system prompt and persona; chat streams from the user's chosen LLM provider (OpenAI / Anthropic / OpenRouter), with API keys stored in `localStorage` only.
- **Toasts** for passive notifications: "PR ready for review", "agent needs your input", etc.
- **Buddy groups:** dragging buddies near each other forms a group with a shared pastel "hull". Grouped buddies act as a small team — each one is told who its teammates are in its system prompt and can defer to them.
- The vibe is approachable and personable, not enterprise — think desktop pet meets dev tool.

## Platforms

- **Desktop:** macOS, Linux, Windows — via **Electron**. Currently only Windows is wired up in `desktop/` (`build:win` script + NSIS installer); macOS/Linux targets are planned but not configured.
- **Mobile:** Android only — via **Capacitor 8**. Renders the buddy as a true system overlay (drawn on top of every app, not just inside the vibemoji activity) via a custom `OverlayService` + Capacitor `Overlay` plugin.
- **No iOS support.** Don't add scaffolding, build targets, or conditional code for iOS.

## Repo layout

A shared core wrapped by per-platform shells. The root is a "loose" monorepo: a small `package.json` with delegating scripts, but each subdir manages its own `node_modules` and `package-lock.json`.

- `core/` — shared UI and business logic. **Next.js 16** (App Router) with **React 19**, **Tailwind v4**, **TypeScript 5**, and **lottie-react** for avatar animation. Configured for static export (`output: 'export'`) so the desktop shell can serve it from disk via a custom `app://` protocol handler.
  - `app/page.tsx` — marketing landing page (web).
  - `app/buddy/page.tsx` — transparent-background buddy-only route loaded by Electron.
  - `app/components/Buddy.tsx` — top-level orchestrator (drag, merge into groups, eject, persistence).
  - `app/components/BuddyInstance.tsx` — single buddy: avatar + chat bubble + toast.
  - `app/components/BuddyGroup.tsx` — pastel hull behind grouped members.
  - `app/components/avatars.ts` — Lottie JSON definitions per color variant.
  - `app/components/personalities.ts` — name, role, greeting, and system prompt per variant.
  - `app/components/llm.ts` — provider config + streaming chat + model fetch (OpenAI, Anthropic, OpenRouter).
- `desktop/` — Electron shell that loads `core/`'s static export.
  - `main.js` — full-workArea transparent always-on-top window with click-through enabled by default; renderer toggles interactivity per-element via `set-interactive` IPC.
  - `preload.js` — exposes a small `window.vibemoji` API (`setInteractive`, `setFocusable`, `setBounds`, `getCursorPoint`, `onSpawnBuddy`).
  - `sync-core.js` — copies `core/out/` → `desktop/core-out/` before packaging (excludes the `installers/` dir to avoid recursive bundling).
  - `make-icon.js` — generates the Windows `.ico` from a PNG via `sharp` + `png-to-ico`.
- `android/` — Capacitor 8 shell. Loads `core/`'s static export (or the dev server at `10.0.2.2:3060`) and adds a native `OverlayService` so the buddy floats above every other app.
  - `capacitor.config.ts` — `appId: dev.vibemoji.android`, `webDir: www`. Honors `VIBEMOJI_DEV_URL` to point the WebView at the running Next dev server.
  - `sync-core.js` — copies `core/out/` → `android/www/` (excludes `installers/`, mirroring `desktop/sync-core.js`).
  - `install-overlay.js` — one-shot patcher run after `npx cap add android`. Drops `OverlayService.java` + `OverlayPlugin.java` into the generated Gradle project, injects the `SYSTEM_ALERT_WINDOW` / `FOREGROUND_SERVICE_SPECIAL_USE` permissions and the `<service>` declaration into `AndroidManifest.xml`, and registers the plugin in `MainActivity`.
  - `native/OverlayService.java` — foreground service that owns its own transparent `WebView` and adds it to `WindowManager` with `TYPE_APPLICATION_OVERLAY`. Touch-passthrough toggle via `FLAG_NOT_TOUCHABLE`, controlled from JS through a `vibemojiNative.setInteractive(boolean)` bridge. Counterpart to `desktop/main.js`'s `setIgnoreMouseEvents`.
  - `native/OverlayPlugin.java` — Capacitor plugin exposed as `Capacitor.Plugins.Overlay`: `hasPermission()`, `requestPermission()`, `start({ url? })`, `stop()`, `isRunning()`, `setInteractive({ value })`.
  - **Touch model**: the overlay has no `FLAG_NOT_TOUCHABLE` (touch has no hover, so the desktop's mousemove-driven flag toggle isn't viable). Instead `OverlayService` registers an `OnComputeInternalInsetsListener` (via reflection — the API is `@hide`) that publishes `TOUCHABLE_INSETS_REGION` rects. `Buddy.tsx` walks every `[data-buddy-interactive]` element, multiplies `getBoundingClientRect` by `devicePixelRatio`, and posts the union via `vibemojiNative.setTouchableRegion(json)`. Touches inside any rect reach the WebView; touches outside fall through to whatever app is underneath. **During any pointer-down on a buddy element**, the published region is replaced with a single full-window rect so drags survive leaving the static avatar bounds — restored to per-element rects on `pointerup` / `pointercancel`. Native uses `webView.requestLayout()` (not `windowManager.updateViewLayout(...)`) to nudge the inset listener; the latter is heavier and can perturb in-flight gesture routing.
  - **Mobile layout**: `BuddyInstance.tsx` detects `Capacitor.getPlatform() !== 'web'` (or any viewport ≤ 480 px) and renders the chat panel + toast stack as a portal'd bottom sheet — full screen width minus 12 dp gutters, anchored to the bottom edge — instead of the desktop's 320 px popup anchored next to the buddy. The portal escapes the buddy wrapper's `transform`'d containing block (otherwise `position: fixed` would resolve relative to the buddy, not the viewport).
- `Notify-Terminal.ps1`, `Show-CatToast.ps1` — early Windows toast experiments, kept for reference.

The two shells should be thin — anything that can live in `core/` should live in `core/`.

## Dev / build / run

All commands below are run from the repo root unless noted. Top-level scripts in `package.json` simply delegate into `core/` or `desktop/`.

```bash
# First-time setup — installs deps for both core and desktop
npm run install-all

# Web dev (core only, http://localhost:3060)
npm run web-dev

# Web production build → core/out/ (static export)
npm run web-build

# Desktop dev — runs Electron pointing at the running web dev server.
# Run `npm run web-dev` first in another terminal.
npm run desktop-dev

# Desktop run against the static export — builds core, syncs into desktop/, launches Electron
npm run desktop-run

# Desktop production installer (Windows NSIS → desktop/dist/vibemoji-desktop-setup.exe)
npm run desktop-build

# Android — one-time setup after install-all:
#   cd android && npx cap add android && node install-overlay.js
# Then dev/build:
npm run android-dev      # builds debug APK, installs, points at 10.0.2.2:3060

# Quick debug APK — Gradle wrapper handles debug signing automatically.
# Run from android/android/.
gradlew.bat assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

# Capacitor CLI build — does sync + plugin update + gradle in one shot, but
# always requires signing creds (no --no-signing flag in Capacitor 8). For a
# throwaway dev build, generate a debug keystore once via keytool, then:
npx cap build android --androidreleasetype=APK \
  --keystorepath debug.keystore --keystorepass android \
  --keystorealias androiddebugkey --keystorealiaspass android
# → android/android/app/build/outputs/apk/release/app-release-signed.apk
```

Notes:

- The web dev server runs on **port 3060**, not 3000. `desktop:dev` reads `VIBEMOJI_DEV_URL` (set by the script to `http://localhost:3060`) and loads the `/buddy` route.
- The static-export build is what production Electron loads — the `app://local/` protocol handler in `desktop/main.js` resolves URLs into `desktop/core-out/`. If you change `core/`, you must re-run `desktop-run` (or `desktop-build`) for the desktop app to see the change.
- API keys and buddy state live in browser `localStorage` (keys: `vibemoji.buddies.v2`, `vibemoji.provider.v1`, `vibemoji.llmKey.<provider>.v1`, `vibemoji.llmModel.<provider>.v1`). Use the tray menu's "Clear local settings" item to wipe.

## Conventions

- **Next.js 16 has breaking changes vs. older majors.** Before writing `core/` code, consult `core/node_modules/next/dist/docs/` rather than relying on prior knowledge — see `core/AGENTS.md`.
- Keep platform-specific code out of `core/`. Detect Electron via `window.vibemoji?.isElectron` and feature-detect rather than UA-sniffing.
- The renderer toggles mouse-event passthrough via `data-buddy-interactive` markers on interactive elements; a global `mousemove` handler in `Buddy.tsx` checks the element under the cursor and calls `vibemoji.setInteractive()`. Don't break this — it's what makes the floating window not block the rest of the desktop.

## Out of scope

- iOS (explicitly excluded — see above).
- Hosting agents or interacting directly with GitHub — that's `gh-autopilot`'s job. `vibemoji` is the *face*; `gh-autopilot` is the *engine*.

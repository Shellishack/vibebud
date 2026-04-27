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
- `mobile/` — Capacitor 8 shell. Loads `core/`'s static export (or the dev server at `10.0.2.2:3060`) and adds a native `OverlayService` so the buddy floats above every other app. The generated Capacitor Android project lives in `mobile/android/` and is checked into git — overlay sources, manifest entries, MainActivity registration, and the `androidx.webkit` dependency are all part of the committed tree (no patcher step).
  - `capacitor.config.ts` — `appId: dev.vibemoji.android`, `webDir: '../core/out'` (Capacitor reads core's static export directly — no intermediate `www/` mirror). Honors `VIBEMOJI_DEV_URL` to point the WebView at the running Next dev server.
  - `android/app/src/main/java/dev/vibemoji/android/OverlayService.java` — foreground service that owns its own transparent `WebView` and adds it to `WindowManager` with `TYPE_APPLICATION_OVERLAY`. Touch-passthrough toggle via `FLAG_NOT_TOUCHABLE`, controlled from JS through a `vibemojiNative.setInteractive(boolean)` bridge. Counterpart to `desktop/main.js`'s `setIgnoreMouseEvents`.
  - `android/app/src/main/java/dev/vibemoji/android/OverlayPlugin.java` — Capacitor plugin exposed as `Capacitor.Plugins.Overlay`: `hasPermission()`, `requestPermission()`, `start({ url? })`, `stop()`, `isRunning()`, `setInteractive({ value })`.
  - **Touch model**: the overlay has no `FLAG_NOT_TOUCHABLE` (touch has no hover, so the desktop's mousemove-driven flag toggle isn't viable). Instead `OverlayService` registers an `OnComputeInternalInsetsListener` (via reflection — the API is `@hide`) that publishes `TOUCHABLE_INSETS_REGION` rects. `Buddy.tsx` walks every `[data-buddy-interactive]` element, multiplies `getBoundingClientRect` by `devicePixelRatio`, and posts the union via `vibemojiNative.setTouchableRegion(json)`. Touches inside any rect reach the WebView; touches outside fall through to whatever app is underneath. **`TOUCHABLE_INSETS_REGION` is checked per touch event, not per gesture** — so once a finger leaves the static avatar rect mid-drag, Android routes the next `MOVE` to the launcher and the gesture is lost. To handle this, the WebView's `OnTouchListener` flips a native `nativeDragActive` flag on `ACTION_DOWN` and back on `UP`/`CANCEL`; while it's set, the inset listener publishes a single full-window rect instead of the per-element list. This runs synchronously inside the gesture, so MOVE events stay routed to the WebView. The JS bridge handles only idle-state region updates. Native uses `webView.requestLayout()` (not `windowManager.updateViewLayout(...)`) to nudge the inset listener.
  - **Mobile layout**: decided by `LayoutAdapter.chatPanelMode === 'sheet'` (Capacitor and Web Mobile only). The sheet is portal'd to `document.body` to escape the buddy wrapper's `transform`'d containing block — otherwise `position: fixed` would resolve relative to the buddy, not the viewport.

## Platform abstraction (`core/lib/platform/`)

All host-bridge access goes through this module — no component reaches `window.vibemoji`, `window.vibemojiNative`, or `Capacitor.getPlatform()` directly. Adapters: `WebAdapter`, `ElectronAdapter`, `CapacitorAdapter`. Hooks: `usePlatform()`, `useLayout()` in `core/app/components/hooks/usePlatform.ts`.

`CapacitorAdapter` is where the drag-survival contract lives:

- `notifyDragStart(buddyId)` adds the id to a `dragHolders` set and **stops all `setTouchableRegion` publishes**.
- `notifyDragEnd(buddyId)` removes the id; when the set empties, one final flush publishes the latest rects.
- The native side (`OverlayService.WebView.setOnTouchListener`) independently flips its own `nativeDragActive` flag on `ACTION_DOWN`/`UP` to keep the touchable region full-window for input routing.

The two pieces work together: native handles OS-level routing (so `MOVE` events keep arriving), JS handles bridge churn (so `webView.requestLayout` doesn't fire mid-gesture and trigger Chromium's scroll-cancel). Either alone is insufficient.

Convention: when adding a new platform-aware behavior, extend `PlatformAdapter` / `LayoutAdapter` rather than feature-detecting in components.

**Editing Android native code:** the canonical Android sources live under `mobile/android/app/src/main/java/dev/vibemoji/android/` (this directory is checked in — there is no separate Java-only repo to sync to). When a problem is rooted in OS-level overlay behavior — `WindowManager` flags, `TYPE_APPLICATION_OVERLAY`, `FLAG_NOT_TOUCHABLE`, `TOUCHABLE_INSETS_REGION`, tap-zone `OnTouchListener` gesture routing, foreground service lifecycle, permission flow — fix it in the Java sources rather than working around it in `core/`. JS-side workarounds for native input routing tend to fight the OS and produce brittle gestures (lost MOVE events, stuck touch regions, scroll-cancel). The overlay is a native feature; treat the Java side as a first-class place to make changes, not a black box.
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

# Android — `mobile/android/` is checked in, so no scaffolding step is needed.
npm run android-dev      # builds debug APK, installs, points at 10.0.2.2:3060

# Quick debug APK — Gradle wrapper handles debug signing automatically.
# Run from mobile/android/.
gradlew.bat assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

# Capacitor CLI build — does sync + plugin update + gradle in one shot, but
# always requires signing creds (no --no-signing flag in Capacitor 8). For a
# throwaway dev build, generate a debug keystore once via keytool, then:
npx cap build android --androidreleasetype=APK \
  --keystorepath debug.keystore --keystorepass android \
  --keystorealias androiddebugkey --keystorealiaspass android
# → mobile/android/app/build/outputs/apk/release/app-release-signed.apk
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

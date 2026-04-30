# Repository Guidelines

## Project Structure & Module Organization

This is the open-source Vibebud client repository. It contains the frontend and cross-platform client code that will be shared on GitHub. Keep most client-visible features here, but exclude closed-source managed features such as remote service orchestration, subscription enforcement, private business logic, and server-side secrets.

This client repo has three main packages:

- `core/`: Next.js 16 app shared by all shells. Routes live in `core/app/`, UI in `core/app/components/`, and platform adapters in `core/lib/platform/`.
- `desktop/`: Electron shell, pairing bridge, preload scripts, and Windows build assets. Desktop builds sync web output into `desktop/core-out/`.
- `mobile/`: Capacitor Android wrapper. Native code lives in `mobile/android/app/src/main/java/dev/vibebud/android/`; generated resources and launch icons are under `mobile/android/app/src/main/res/`.

Root PowerShell scripts provide local notification helpers. Do not commit generated build output unless intentional.

The product is a friendly "code buddy" UI that floats on desktop or Android, surfaces what AI agents are doing, and prompts for input when needed. The shared core should own behavior that is not inherently platform-specific; Electron and Capacitor shells should stay thin.

There is no iOS support. Do not add iOS scaffolding, build targets, or conditional code.

Important shared paths:

- `core/app/page.tsx`: marketing landing page.
- `core/app/buddy/page.tsx`: transparent buddy-only route loaded by Electron and Android overlay flows.
- `core/app/components/Buddy.tsx`: top-level orchestrator for drag, grouping, ejection, and persistence.
- `core/app/components/BuddyInstance.tsx`: single buddy avatar, chat bubble, and toast.
- `core/app/components/BuddyGroup.tsx`: grouped buddy hull.
- `core/app/components/avatars.ts`: Lottie avatar definitions.
- `core/app/components/personalities.ts`: variant names, roles, greetings, and system prompts.
- `core/app/components/llm.ts`: provider config, model fetching, and streaming chat.
- `desktop/main.js`: transparent always-on-top Electron window and IPC bridge.
- `desktop/preload.js`: exposes `window.vibebud`.
- `desktop/sync-core.js`: copies `core/out/` to `desktop/core-out/`.
- `mobile/capacitor.config.ts`: Android Capacitor config, including `VIBEBUD_DEV_URL` support.

## Build, Test, and Development Commands

Install all packages with `npm run install-all`.

- `npm run web-dev`: starts Next.js on port `3060`.
- `npm run web-build`: builds the shared `core/` app.
- `npm run desktop-dev`: launches Electron against `http://localhost:3060`; run `web-dev` first.
- `npm run desktop-build`: builds `core/`, syncs Electron assets, and creates the installer.
- `npm run android-sync`: builds `core/` and syncs Capacitor Android assets.
- `npm run android-dev`: runs the Android shell against the dev server at `10.0.2.2:3060`.
- `npm run android-build`: syncs Android assets and runs the release Gradle build.

Run `npm --prefix core run lint` before submitting web or shared UI changes.

The web dev server runs on port `3060`, not `3000`. Production Electron loads the static export through the `app://local/` protocol handler in `desktop/main.js`; re-run `desktop-run` or `desktop-build` after changing `core/` if testing the packaged/static flow.

API keys and buddy state live in browser `localStorage` under keys such as `vibebud.buddies.v2`, `vibebud.provider.v1`, `vibebud.llmKey.<provider>.v1`, and `vibebud.llmModel.<provider>.v1`. Use the tray menu's "Clear local settings" item to wipe local state.

## Coding Style & Naming Conventions

Use TypeScript and React patterns already present in `core/`. Components use `PascalCase` filenames such as `BuddyInstance.tsx`; hooks use `useX.ts`; platform modules use lowercase names such as `remoteClaude.ts`. Keep `desktop/` JavaScript CommonJS-compatible unless the package is migrated as a whole.

Use two-space indentation for TS/JS/JSON. Prefer small, explicit modules. Avoid hand-editing generated Android resources owned by icon or Capacitor sync scripts.

Before writing `core/` code that depends on Next.js behavior, consult the installed Next.js 16 docs in `core/node_modules/next/dist/docs/` rather than relying on older Next.js assumptions.

Keep platform-specific bridge access inside `core/lib/platform/`. Components should not directly reach for `window.vibebud`, `window.vibebudNative`, or `Capacitor.getPlatform()`; extend `PlatformAdapter` or `LayoutAdapter` instead.

The floating desktop window depends on `data-buddy-interactive` markers and the global mousemove interactivity toggle in `Buddy.tsx`. Preserve that contract when changing interaction surfaces.

For Android overlay behavior, prefer native fixes in `mobile/android/app/src/main/java/dev/vibebud/android/` when the issue involves `WindowManager` flags, `TYPE_APPLICATION_OVERLAY`, touchable regions, foreground service lifecycle, permission flow, or gesture routing. JS-side workarounds for OS-level routing tend to be brittle.

Android touch routing uses `TOUCHABLE_INSETS_REGION` plus a native drag-active path in `OverlayService` so move events stay routed to the overlay during drag. The platform adapter suppresses touchable-region publishes while JS drag holders are active and flushes after drag end; keep both halves in sync.

## Testing Guidelines

There is no broad automated test suite yet. Use targeted checks:

- `npm --prefix core run lint` for TypeScript/React changes.
- `npm run web-build` for shared app behavior.
- `npm run desktop-dev` or `npm run desktop-build` for Electron changes.
- `npm run android-sync` and `npm run android-build` for Capacitor or native Android changes.

Android sample tests exist under `mobile/android/app/src/test/` and `src/androidTest/`; name new Java tests after the behavior tested.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commits with optional scopes, for example `feat(Buddy): implement master rotation toggle`. Follow `type(scope): summary`; common types include `feat`, `fix`, `chore`, and `docs`.

Pull requests should include a short description, commands run, linked issues, and screenshots or recordings for UI, tray, overlay, pairing, or Android permission-flow changes. Mention generated files when icon, Capacitor, or installer assets change.

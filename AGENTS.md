# Repository Guidelines

## Project Structure & Module Organization

This private monorepo has three main packages:

- `core/`: Next.js 16 app shared by all shells. Routes live in `core/app/`, UI in `core/app/components/`, and platform adapters in `core/lib/platform/`.
- `desktop/`: Electron shell, pairing bridge, preload scripts, and Windows build assets. Desktop builds sync web output into `desktop/core-out/`.
- `mobile/`: Capacitor Android wrapper. Native code lives in `mobile/android/app/src/main/java/dev/vibebud/android/`; generated resources and launch icons are under `mobile/android/app/src/main/res/`.

Root PowerShell scripts provide local notification helpers. Do not commit generated build output unless intentional.

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

## Coding Style & Naming Conventions

Use TypeScript and React patterns already present in `core/`. Components use `PascalCase` filenames such as `BuddyInstance.tsx`; hooks use `useX.ts`; platform modules use lowercase names such as `remoteClaude.ts`. Keep `desktop/` JavaScript CommonJS-compatible unless the package is migrated as a whole.

Use two-space indentation for TS/JS/JSON. Prefer small, explicit modules. Avoid hand-editing generated Android resources owned by icon or Capacitor sync scripts.

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

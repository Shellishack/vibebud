# vibemoji

A friendly floating code buddy that surfaces what your AI agents are doing — and taps you on the shoulder when they need a hand.

> Screenshot coming soon. For now: imagine a small animated avatar in the corner of your screen, blinking at you, occasionally popping a chat bubble.

## What it is

vibemoji is a desktop pet for AI-assisted development. A small avatar floats on top of your other windows, chats with you in bubbles, and fires the occasional toast when an agent finishes a PR or needs your input. It's the *face* of the [`auto-buddy`](../) workflow — the engine that runs the agents lives in the sibling repo [`gh-autopilot`](../gh-autopilot). vibemoji is usable on its own.

## Personalities and groups

Each buddy has a name, a role, and its own system prompt. The six built-ins:

- **Helper** — general assistant
- **Tactician** — planner and prioritizer
- **Researcher** — digger for prior art and references
- **Skeptic** — critical reviewer who probes assumptions
- **Cheerleader** — upbeat encourager
- **Empath** — listens first, validates, then suggests

Drag two buddies near each other and they form a small team — a pastel "hull" appears behind them, and each member is told who its teammates are so it can defer to a better-suited specialist when appropriate.

## Status

| Surface                            | State                                      |
| ---------------------------------- | ------------------------------------------ |
| Web preview (`core/`)              | working                                    |
| Electron desktop — Windows         | working, NSIS installer builds end-to-end  |
| Electron desktop — macOS / Linux   | planned, not yet wired up                  |
| Android (Capacitor 8)              | scaffolded — system overlay floats above all apps via `OverlayService` |
| iOS                                | out of scope                               |

## Stack

- **`core/`** — Next.js 16 (App Router) · React 19 · Tailwind v4 · TypeScript 5 · lottie-react. Configured for static export so the desktop shell can serve it from disk.
- **`desktop/`** — Electron 33 · electron-builder. Transparent always-on-top window covering the full work area, with click-through enabled by default and toggled off per-element while the cursor is over a buddy or chat bubble.
- **`android/`** — Capacitor 8 + a small native module that runs the buddy as a `WindowManager` overlay (`TYPE_APPLICATION_OVERLAY`) from a foreground service, so it floats above the home screen and other apps. Touch-passthrough mirrors the desktop click-through behavior.
- **`../server/`** — optional dependency-free Node.js backend for login, sync snapshots, backups, subscription state, and managed AI proxy calls.

## Layout

```
vibemoji/
├── core/        # shared Next.js UI — runs as a website, also bundled into the desktop shell
├── desktop/     # Electron wrapper around core/
└── android/     # (future) Capacitor wrapper around core/
```

Anything that can live in `core/` should — the platform shells stay thin.
The optional backend lives at `../server/` from this package.

## Bring your own LLM

Chat features can still call OpenAI, Anthropic, or OpenRouter directly from the renderer. You enter your API key in the buddy's settings panel; it's stored in `localStorage` and never leaves the device except when talking to the provider you chose.

For a hosted product model, `../server/` adds optional accounts, sync, backups, subscription state, and managed AI calls through server-owned provider keys. See [`../server/README.md`](../server/README.md).

## Getting started

```bash
# Install deps for both core and desktop
npm run install-all

# Web preview at http://localhost:3060
npm run web-dev

# Optional backend at http://localhost:3070
npm run server-dev

# Electron pointed at the running web dev server
# (run alongside `npm run web-dev` in another terminal)
npm run desktop-dev

# Build core, copy into desktop, launch Electron against the static export
npm run desktop-run

# Windows installer → desktop/dist/vibemoji-desktop-setup.exe
npm run desktop-build

# Android — one-time, after install-all:
#   cd android && npx cap add android && node install-overlay.js
npm run android-dev          # debug APK on a connected device/emulator
npm run android-build        # release APK
```

The dev server runs on **port 3060**, not 3000. The desktop window loads the `/buddy` route, which has a transparent background so only the avatar shows through.

## Relationship to `gh-autopilot`

`gh-autopilot` is the engine — it watches a GitHub repo and dispatches agents to work on issues. `vibemoji` is the face — it shows you what those agents are up to and lets you respond without context-switching. They're sibling repos under [`auto-buddy`](../), independent but designed to be used together.

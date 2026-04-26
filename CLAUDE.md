# vibemoji

A friendly "code buddy" UI that floats on the user's desktop (or Android device), surfaces what AI agents are doing on the user's behalf, and prompts for input when action is needed. Companion to `gh-autopilot` (sibling repo) but usable on its own.

## Product shape

- A **floating avatar** that lives on top of the user's other windows. The avatar is customizable — users can swap it out.
- **Chat bubbles** for conversational interaction with the buddy.
- **Toasts** for passive notifications: "PR ready for review", "agent needs your input", etc.
- The vibe is approachable and personable, not enterprise — think desktop pet meets dev tool.

## Platforms

- **Desktop:** macOS, Linux, Windows — via **Electron**.
- **Mobile:** Android only — via **Capacitor**.
- **No iOS support.** Don't add scaffolding, build targets, or conditional code for iOS.

## Repo layout

A shared core wrapped by per-platform shells:

- `core/` — shared UI and business logic. Built with **Next.js** (latest, scaffolded via `npx create-next-app@latest`). All platform-agnostic code lives here: components, state, agent-communication logic.
- `desktop/` — **Electron** shell that loads `core/`. Handles desktop-specific concerns: floating-window behavior, OS notifications, tray integration.
- `android/` — **Capacitor** shell that loads `core/`. Handles Android-specific concerns: native notifications, background behavior.

The two shells should be thin — anything that can live in `core/` should live in `core/`.

## Status

Fresh repo. None of the three subprojects are scaffolded yet. When initializing:

1. Scaffold `core/` with `npx create-next-app@latest` first.
2. Then add `desktop/` (Electron) and `android/` (Capacitor) shells that consume `core/`.

Update this file with concrete dev/build/run commands once the stack is in place.

## Out of scope

- iOS (explicitly excluded — see above).
- Hosting agents or interacting directly with GitHub — that's `gh-autopilot`'s job. `vibemoji` is the *face*; `gh-autopilot` is the *engine*.

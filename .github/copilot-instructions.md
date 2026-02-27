# Slack Todos — Project Guidelines

## Architecture

This is a personal Slack → Obsidian todo sync app with three entry points:

- **`src-tauri/src/lib.rs`** — Tauri v2 menu bar (tray) app. Primary entry point for end users. Spawns the Node.js sidecar, manages the tray icon/menu, and exposes Tauri commands for the settings window.
- **`src/sidecar.ts`** — Node.js sidecar entry point for Tauri. Emits JSON IPC messages to stdout for tray status updates.
- **`src/index.ts`** — Headless CLI entry point for running without a GUI.

Settings UI:

- **`src-tauri/settings/index.html`** — Settings window HTML. Served as the Tauri `frontendDist`.
- **`src-tauri/settings/settings.js`** — Settings window logic. Calls Tauri commands via `window.__TAURI__.core.invoke()`.

Core modules:

- **`src/config.ts`** — Env var loading and validation. Supports Tauri bundled resource (`execDir/../Resources/.env`), Electron legacy path, and dev (cwd) `.env` locations.
- **`src/slack.ts`** — Slack Bolt app using Socket Mode with user tokens (not bot tokens). Listens for `reaction_added` events.
- **`src/obsidian.ts`** — Appends markdown checkbox items to an Obsidian vault file. Handles file creation, directory creation, and permalink-based deduplication.

## Code Style

- TypeScript with strict mode
- Node16 module resolution
- Prefer `node:` protocol for built-in imports (`node:fs`, `node:path`)
- Export types with `export interface` / `export type`
- Use JSDoc on all exported functions and interfaces

## Build and Test

```bash
npm run typecheck        # Type-check without emitting
npm run build            # Compile TS → dist/
npm run build:sidecar    # Compile TS + package sidecar binary
npm run test             # Run vitest
npm run test:coverage    # Run vitest with v8 coverage
npm run dev              # Build sidecar + cargo tauri dev
npm run start:cli        # Launch headless (no GUI)
npm run pack             # Build macOS .app
npm run dist             # Build macOS .app (distributable)
```

Always run `npm run typecheck` before `npm run build`.

Requires Rust toolchain (`rustup`) and Tauri CLI (`cargo install tauri-cli`).

## Conventions

- Config is loaded eagerly at import time via side-effect in `config.ts` — do not lazy-load
- The `createApp()` function accepts an optional `onSync` callback for the tray to track sync count
- User tokens (`xoxp-`) are used instead of bot tokens — the app acts as the user, not a bot
- The `.env` file is gitignored and bundled into the Tauri app via `src-tauri/resources/`
- Tray icons use macOS template images (`iconAsTemplate: true`) for automatic light/dark adaptation
- The sidecar communicates with the Rust tray via JSON messages on stdout (`{"event":"status","value":"Running"}`)
- Code signing is disabled (`signingIdentity: null`) to prevent keychain manipulation during builds
- Tests mock `dotenv` to avoid loading the real `.env` during test runs
- The settings window uses `withGlobalTauri: true` so JS can call Tauri commands without a bundler
- Tauri commands exposed from `lib.rs`: `read_config` (reads `.env` into a HashMap), `write_config` (writes HashMap back to `.env`), `close_settings` (closes settings window), `restart_app` (relaunches .app bundle)

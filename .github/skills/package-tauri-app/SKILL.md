---
name: package-tauri-app
description: 'Build and package the macOS Tauri app. Use when creating a distributable .app, updating the app icon, or modifying Tauri config.'
---

# Package the Tauri App

## When to Use

- Building a distributable `.app` for macOS
- Updating the app or tray icon
- Modifying the Tauri config in `src-tauri/tauri.conf.json`

## Procedure

1. Ensure all changes compile: `npm run typecheck && npm run build`
2. Build the sidecar + app: `npm run pack`
3. For distributable build: `npm run dist`
4. Built app is at `src-tauri/target/release/bundle/macos/Slack Todos.app`
5. Install: `cp -r "src-tauri/target/release/bundle/macos/Slack Todos.app" /Applications/`

## Prerequisites

- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Tauri CLI: `cargo install tauri-cli --version "^2"`

## Icon Sizes

- **Tray icon** (menu bar): 22x22 PNG (`src-tauri/icons/iconTemplate.png`) + 44x44 @2x (`src-tauri/icons/iconTemplate@2x.png`). Must be black on transparent. Named `*Template` for macOS light/dark auto-adaptation.
- **App icon** (Dock/Finder): 1024x1024 PNG → convert to `.icns` via:
    ```bash
    mkdir icon.iconset
    sips -z 16 16 source.png --out icon.iconset/icon_16x16.png
    # ... (all sizes from 16 to 512@2x)
    iconutil -c icns icon.iconset -o icon.icns
    ```

## Key Config

- `src-tauri/tauri.conf.json` → app identifier, bundle icons, resources, sidecar binary
- `src-tauri/Cargo.toml` → Rust dependencies (tray-icon, shell, single-instance plugins)
- Code signing is disabled (`signingIdentity: null`) — no keychain manipulation
- `.env` is bundled via `src-tauri/resources/.env`
- Sidecar binary is built via `npm run build:sidecar` (uses @yao-pkg/pkg)

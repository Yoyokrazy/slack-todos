# Slack Todos — Project Specification

## 1. Overview

Slack Todos is a personal macOS menu bar app that watches for emoji reactions you add in Slack and syncs those messages as todo items into an Obsidian vault. It runs as a Tauri v2 tray application backed by a Node.js sidecar, or as a headless CLI. The app uses **user tokens** (`xoxp-`), not bot tokens — it acts as you, stays invisible in channels, and can only see messages you have access to. Duplicates are detected by permalink and silently skipped.

## 2. Architecture

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────┐
│               macOS Menu Bar                     │
│         (tray icon + dropdown menu)              │
└────────────────────┬────────────────────────────┘
                     │ Tauri tray API
┌────────────────────▼────────────────────────────┐
│           Tauri Rust Host (lib.rs)               │
│  • TrayIconBuilder, MenuBuilder                  │
│  • Spawns sidecar via tauri-plugin-shell         │
│  • Reads JSON IPC from sidecar stdout            │
│  • Updates menu items + tooltip in real time      │
└────────────────────┬────────────────────────────┘
                     │ stdin/stdout (JSON lines)
┌────────────────────▼────────────────────────────┐
│         Node.js Sidecar (sidecar.ts)             │
│  • Compiled to native binary via @yao-pkg/pkg    │
│  • Emits {"event":"status","value":"Running"}    │
│  • Emits {"event":"sync","count":N}              │
└────────┬───────────────────────────┬────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐       ┌──────────────────────┐
│   Slack API      │       │   Obsidian Vault     │
│ (Socket Mode)    │       │ (local filesystem)   │
│                  │       │                      │
│ • reaction_added │       │ • Append checkbox    │
│ • conversations  │       │   items to .md file  │
│   .history       │       │ • Dedup by permalink │
│ • chat           │       │ • Create dirs/files  │
│   .getPermalink  │       │   as needed          │
│ • users.info     │       │                      │
│ • conversations  │       │                      │
│   .info          │       │                      │
└─────────────────┘       └──────────────────────┘
```

### 2.2 Entry Points

| Entry Point | File | Description |
|---|---|---|
| **Tray app** (primary) | `src-tauri/src/lib.rs` → spawns `src/sidecar.ts` | Tauri v2 macOS menu bar app. Rust host manages the tray; Node.js sidecar runs the Slack listener. |
| **Sidecar** | `src/sidecar.ts` | Standalone Node.js binary. Emits JSON IPC on stdout for the Rust host. Built with `@yao-pkg/pkg`. |
| **Headless CLI** | `src/index.ts` | Runs the Slack Bolt app without any GUI. Use `npm run start:cli` or `node dist/index.js`. |

### 2.3 IPC Protocol

The sidecar communicates with the Rust host via **JSON lines on stdout** (one JSON object per `\n`-delimited line).

**Message schema:**

```typescript
interface SidecarMessage {
    event: string;        // "status" | "sync"
    value?: string;       // present when event === "status"
    count?: number;       // present when event === "sync"
}
```

**Messages emitted:**

| Event | Payload | When |
|---|---|---|
| `status` | `{"event":"status","value":"Running"}` | After `app.start()` succeeds |
| `status` | `{"event":"status","value":"Error"}` | On fatal startup failure |
| `sync` | `{"event":"sync","count":5}` | After each successful todo sync (cumulative count) |

The Rust host deserializes each line with `serde_json::from_str::<SidecarMessage>()` and updates the tray menu items accordingly. Stderr from the sidecar is logged via `log::error!`.

## 3. Modules

### 3.1 Rust (src-tauri/src/)

| File | Purpose |
|---|---|
| `main.rs` | Binary entry point. Calls `app_lib::run()`. Hides console window on Windows in release builds. |
| `lib.rs` | Core Tauri application setup. Exports `pub fn run()`. |

**`lib.rs` key structures:**

| Item | Description |
|---|---|
| `SidecarMessage` | `#[derive(Deserialize)]` struct for JSON IPC: `event: String`, `value: Option<String>`, `count: Option<u32>` |
| `TrayState` | Shared mutable state: `status: String`, `sync_count: u32`. Wrapped in `Arc<Mutex<_>>`. |
| `run()` | Builds the Tauri app with plugins (shell, single-instance, log), sets up the tray icon/menu, spawns the sidecar, and listens for stdout events in an async task. |

**Plugins used:**

| Plugin | Crate | Purpose |
|---|---|---|
| `tauri-plugin-shell` | `tauri-plugin-shell = "2"` | Spawn and communicate with the sidecar binary |
| `tauri-plugin-single-instance` | `tauri-plugin-single-instance = "2"` | Prevent multiple instances of the app |
| `tauri-plugin-log` | `tauri-plugin-log = "2"` | Logging (debug builds only, `LevelFilter::Info`) |

### 3.2 TypeScript (src/)

| File | Purpose | Exports |
|---|---|---|
| `config.ts` | Env var loading and validation | `required(key: string): string`, `config` (const object) |
| `slack.ts` | Slack Bolt app setup and event handling | `createApp(onSync?: (count: number) => void): App` |
| `obsidian.ts` | Obsidian vault file writer | `TodoEntry` (interface), `appendTodo(filePath, entry): void`, `formatTodo(entry): string` |
| `sidecar.ts` | Tauri sidecar entry point | (no exports — runs `main()`) |
| `index.ts` | Headless CLI entry point | (no exports — runs `main()`) |

#### `config.ts`

- **Side-effect on import**: loads `.env` via `dotenv.config()` at module evaluation time
- **`required(key)`**: reads `process.env[key]`, throws if missing
- **`config`**: frozen object with validated `slack`, `todoEmojis`, and `obsidian` properties

#### `slack.ts`

- **`createApp(onSync?)`**: creates a `@slack/bolt` App in Socket Mode using `authorize` (not `token`) for user token auth. Registers a `reaction_added` handler that:
  1. Filters by `config.slack.userId` and `config.todoEmojis`
  2. Calls `conversations.history` to fetch the original message
  3. Calls `chat.getPermalink` for the message URL
  4. Calls `users.info` for the author display name
  5. Calls `conversations.info` for the channel name
  6. Calls `appendTodo()` to write the entry
  7. Increments `syncCount` and invokes `onSync(syncCount)`

#### `obsidian.ts`

- **`TodoEntry`**: `{ text, author, channel, permalink, timestamp }` — all strings
- **`appendTodo(filePath, entry)`**: creates parent directories/file as needed, skips if permalink already exists in file, appends formatted line
- **`formatTodo(entry)`**: returns `- [ ] todo <text> [link](<permalink>)\n` with text truncated at 300 chars

#### `sidecar.ts`

- **`emit(msg)`**: writes `JSON.stringify(msg) + "\n"` to stdout
- **`main()`**: calls `createApp(onSync)` where `onSync` emits `{"event":"sync","count":N}`, then `app.start()`, then emits `{"event":"status","value":"Running"}`

## 4. Configuration

### 4.1 Environment Variables

| Variable | Required | Type | Default | Description |
|---|---|---|---|---|
| `SLACK_USER_TOKEN` | ✅ | `string` | — | Slack user OAuth token (`xoxp-...`) |
| `SLACK_APP_TOKEN` | ✅ | `string` | — | Slack app-level token for Socket Mode (`xapp-...`) |
| `SLACK_USER_ID` | ✅ | `string` | — | Your Slack member ID (e.g. `U0XXXXXXXXX`). Only reactions from this user are captured. |
| `TODO_FILE_PATH` | ✅ | `string` | — | Absolute path to the todo file, including filename (e.g. `/Users/you/vault/Slack-Todos.md`) |
| `TODO_EMOJI` | ❌ | `string` | `"yyk-todo"` | Emoji name(s) that trigger todo sync. Comma-separated for multiple (e.g. `"todo,white_check_mark,star"`). Without colons. |

### 4.2 `.env` File Resolution Order

The `.env` file is located by checking these paths in order (first match wins):

| Priority | Path | Context |
|---|---|---|
| 1 | `<execDir>/../Resources/resources/.env` | Tauri bundled app (`Contents/MacOS/../Resources/resources/.env`) |
| 2 | `<execDir>/../Resources/.env` | Legacy Electron bundled app |
| 3 | `<process.resourcesPath>/.env` | Electron `process.resourcesPath` (if defined) |
| 4 | `<cwd>/.env` | Development (project root) |

### 4.3 Loading Behavior

Config is loaded **eagerly at import time** as a side-effect of importing `config.ts`. The `config` object is a `const` frozen at module evaluation. If any required env var is missing, `required()` throws immediately, crashing the sidecar at startup.

## 5. Build Pipeline

### 5.1 TypeScript Compilation

| Setting | Value |
|---|---|
| Target | `ES2022` |
| Module | `Node16` |
| Module Resolution | `Node16` |
| Output Directory | `dist/` |
| Root Directory | `src/` |
| Strict Mode | `true` |
| Declaration Files | `true` |

Compile command: `npx tsc` (via `npm run build`).

### 5.2 Sidecar Binary Packaging

The sidecar is compiled from `dist/sidecar.js` into a standalone native binary using [`@yao-pkg/pkg`](https://github.com/nicolo-ribaudo/pkg):

```bash
npx @yao-pkg/pkg dist/sidecar.js \
  --targets node22-macos-arm64 \
  --output src-tauri/binaries/slack-todos-sidecar-aarch64-apple-darwin
```

The output binary name must include the Rust target triple (`aarch64-apple-darwin`) for Tauri's `externalBin` resolution. This binary is referenced in `tauri.conf.json` as `binaries/slack-todos-sidecar`.

### 5.3 Tauri Build

Tauri's `beforeBuildCommand` is set to `npm run build:sidecar`, which runs TypeScript compilation + sidecar packaging before `cargo build`.

```bash
cargo tauri build           # Full build (invokes beforeBuildCommand automatically)
cargo tauri build --bundles app   # .app only (no DMG)
cargo tauri dev             # Dev mode with hot-reload
```

### 5.4 NPM Scripts

| Script | Command | Description |
|---|---|---|
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `build:sidecar` | `tsc && npx @yao-pkg/pkg dist/sidecar.js --targets node22-macos-arm64 --output src-tauri/binaries/slack-todos-sidecar-aarch64-apple-darwin` | Compile TS + package sidecar binary |
| `dev` | `npm run build:sidecar && cargo tauri dev` | Build sidecar + launch Tauri in dev mode |
| `start:cli` | `node dist/index.js` | Run headless CLI (no GUI) |
| `typecheck` | `tsc --noEmit` | Type-check without emitting files |
| `test` | `vitest run` | Run test suite once |
| `test:watch` | `vitest` | Run tests in watch mode |
| `test:coverage` | `vitest run --coverage` | Run tests with v8 code coverage |
| `pack` | `npm run build:sidecar && cargo tauri build --bundles app` | Build macOS `.app` (unpacked) |
| `dist` | `npm run build:sidecar && cargo tauri build` | Build macOS `.app` + DMG (distributable) |

## 6. Packaging & Distribution

### 6.1 `.app` Bundle Structure

```
Slack Todos.app/
  Contents/
    MacOS/
      Slack Todos                                    # Rust binary (Tauri host)
      slack-todos-sidecar-aarch64-apple-darwin       # Node.js sidecar binary
    Resources/
      resources/
        .env                                         # Bundled environment config
      icons/
        iconTemplate.png                             # 22x22 tray icon
        iconTemplate@2x.png                          # 44x44 tray icon (Retina)
      icon.icns                                      # App icon
    Info.plist
```

### 6.2 Bundle Configuration

Defined in `src-tauri/tauri.conf.json`:

| Key | Value | Purpose |
|---|---|---|
| `bundle.targets` | `["dmg", "app"]` | Build both `.app` and `.dmg` |
| `bundle.externalBin` | `["binaries/slack-todos-sidecar"]` | Sidecar binary (target triple appended at build time) |
| `bundle.resources` | `["resources/.env", "icons/iconTemplate.png", "icons/iconTemplate@2x.png"]` | Files copied into `Contents/Resources/` |
| `bundle.macOS.infoPlist` | `"Info.plist"` | Custom plist overrides |
| `bundle.macOS.signingIdentity` | `null` | Disables code signing |

### 6.3 Code Signing

Code signing is **disabled** (`signingIdentity: null`). This is intentional — the app is for personal use and disabling signing avoids keychain access prompts and codesign errors during builds. macOS will flag the app as unidentified on first launch; the user must allow it via **System Settings → Privacy & Security → Open Anyway**.

### 6.4 LSUIElement (Dock Hiding)

The app is hidden from the macOS Dock via two mechanisms:

1. **`Info.plist`**: `<key>LSUIElement</key><true/>` — tells macOS the app is an agent (no Dock icon, no menu bar app menu).
2. **Programmatic**: In `lib.rs`, `NSApp().setActivationPolicy_(NSApplicationActivationPolicyAccessory)` is called at setup time via the `cocoa` crate.

### 6.5 Single Instance

The `tauri-plugin-single-instance` plugin prevents multiple copies of the app from running simultaneously. If a second instance is launched, it silently exits.

## 7. Tray Menu Structure

The tray menu is built in `lib.rs` using Tauri's `MenuBuilder`:

| Order | ID | Text | Enabled | Behavior |
|---|---|---|---|---|
| 1 | `title` | `Slack Todos` | ✅ | Static label (text item, not a button) |
| — | — | *(separator)* | — | — |
| 2 | `status` | `Status: Starting...` | ❌ | Disabled info item. Updated to `Status: Running`, `Status: Error`, or `Status: Error (sidecar exited)` via sidecar IPC. |
| 3 | `sync` | `Todos synced: 0` | ❌ | Disabled info item. Counter updated on each successful sync via sidecar IPC. |
| — | — | *(separator)* | — | — |
| 4 | `quit` | `Quit` | ✅ | Calls `app.exit(0)` to terminate the app and sidecar. |

**Tray icon**: `icons/iconTemplate.png` loaded as a macOS template image (`icon_as_template: true`) for automatic light/dark mode adaptation. Falls back to the resource directory path, then to the default app icon.

**Tooltip**: `"Slack Todos — <status>"`, updated dynamically.

**Click behavior**: `show_menu_on_left_click: true` — both left and right click open the menu.

## 8. Slack Integration

### 8.1 Socket Mode Setup

The app connects to Slack via [Socket Mode](https://api.slack.com/apis/socket-mode) (WebSocket), not HTTP webhooks. This means:

- No public URL or server required
- The app connects outbound to Slack's WebSocket endpoint
- Connection is established via the `xapp-...` app-level token
- The `@slack/bolt` library handles reconnection automatically

### 8.2 User Tokens vs Bot Tokens

The app uses **user tokens** (`xoxp-`) exclusively, configured via the `authorize` callback (not the `token` option). This means:

- The app acts as the user, not a bot
- No bot user appears in channels
- The app can read any message the user has access to
- Reactions are detected for the user's own reactions only (filtered by `SLACK_USER_ID`)

**Required user token scopes:**

| Scope | Purpose |
|---|---|
| `channels:history` | Read messages in public channels |
| `groups:history` | Read messages in private channels |
| `im:history` | Read messages in DMs |
| `mpim:history` | Read messages in group DMs |
| `reactions:read` | Receive `reaction_added` events |
| `users:read` | Resolve user display names |
| `channels:read` | Resolve public channel names |
| `groups:read` | Resolve private channel names |
| `im:read` | Resolve DM channel info |
| `mpim:read` | Resolve group DM channel info |

**App-level token scope:** `connections:write` (required for Socket Mode).

### 8.3 `reaction_added` Event Flow

```
1. User adds emoji reaction to a Slack message
2. Slack sends `reaction_added` event via Socket Mode
3. Handler checks: event.user === config.slack.userId?
   └─ No → return (ignore other users' reactions)
4. Handler checks: config.todoEmojis.includes(event.reaction)?
   └─ No → return (ignore non-todo emoji)
5. Fetch original message:
   └─ client.conversations.history({ channel, latest: ts, inclusive: true, limit: 1 })
6. Get permalink:
   └─ client.chat.getPermalink({ channel, message_ts: ts })
7. Resolve author name:
   └─ client.users.info({ user: message.user ?? event.user })
8. Resolve channel name:
   └─ client.conversations.info({ channel })
9. Write to Obsidian:
   └─ appendTodo(todoFilePath, { text, author, channel, permalink, timestamp })
10. Increment sync counter, invoke onSync callback
```

### 8.4 Slack API Calls

| Method | Purpose | Parameters |
|---|---|---|
| `conversations.history` | Fetch the message that was reacted to | `channel`, `latest` (message ts), `inclusive: true`, `limit: 1` |
| `chat.getPermalink` | Get permanent URL for the message | `channel`, `message_ts` |
| `users.info` | Resolve the message author's display name | `user` (message author or reactor) |
| `conversations.info` | Resolve the channel's human-readable name | `channel` |

## 9. Obsidian Integration

### 9.1 File Format

The todo file is a standard Markdown file with a header and checkbox items:

```markdown
# Slack Todos

- [ ] todo Review the PR please [link](https://team.slack.com/archives/C123/p170000)
- [ ] todo Deploy the hotfix to staging [link](https://team.slack.com/archives/C456/p180000)
```

Each line follows the format:
```
- [ ] todo <text> [link](<permalink>)
```

- Text is truncated to 300 characters (with `…` appended if truncated)
- The `# Slack Todos` header is written once when the file is first created
- The file is valid CommonMark and renders natively in Obsidian as interactive checkboxes

### 9.2 Deduplication

Before appending, `appendTodo()` reads the entire file and checks if `entry.permalink` appears anywhere in the file content via `String.includes()`. If the permalink is already present, the write is silently skipped. This prevents duplicate entries when the same message is re-reacted to.

### 9.3 File and Directory Creation

- If the target directory does not exist, it is created recursively via `mkdirSync(dir, { recursive: true })`
- If the target file does not exist, it is initialized with `# Slack Todos\n\n` before the first entry
- All writes use `appendFileSync` (synchronous, atomic per-call)

## 10. Testing

### 10.1 Test Framework

- **Runner**: [Vitest](https://vitest.dev/) v4
- **Coverage provider**: `@vitest/coverage-v8`
- **Test location**: `tests/**/*.test.ts`

### 10.2 Test Suites

| File | Module Under Test | Tests |
|---|---|---|
| `tests/config.test.ts` | `src/config.ts` | 9 tests: `required()` throws/returns correctly, all config fields load, default/custom `todoEmojis`, missing required vars throw |
| `tests/obsidian.test.ts` | `src/obsidian.ts` | 8 tests: `formatTodo` output format, text truncation at 300 chars, permalink in output; `appendTodo` creates file with header, appends entries, no duplicate headers, skips duplicate permalinks, allows different permalinks, creates nested directories |

### 10.3 What's Mocked

| Mock | Why |
|---|---|
| `dotenv` module (`vi.mock("dotenv", ...)`) | Prevents loading the real `.env` file during tests. Config tests set `process.env` directly and use `vi.resetModules()` to re-import `config.ts` fresh. |

`obsidian.test.ts` uses real filesystem operations against temporary directories (`mkdtempSync` + `rmSync` in `beforeEach`/`afterEach`).

### 10.4 Coverage Configuration

Defined in `vitest.config.ts`:

| Setting | Value |
|---|---|
| Included | `src/obsidian.ts`, `src/config.ts` |
| Excluded | `src/tray.ts`, `src/index.ts`, `src/slack.ts` |

`slack.ts` is excluded because it requires a live Slack connection to test meaningfully.

### 10.5 Running Tests

```bash
npm run test              # Run all tests once
npm run test:watch        # Run in watch mode
npm run test:coverage     # Run with v8 coverage report
```

## 11. Development Workflow

### 11.1 Prerequisites

| Tool | Install |
|---|---|
| Node.js ≥ 22 | Required for `@yao-pkg/pkg` `node22` target |
| Rust toolchain | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Tauri CLI v2 | `cargo install tauri-cli --version "^2"` |
| npm dependencies | `npm install` |

### 11.2 Dev Commands

```bash
# Type-check (always run first)
npm run typecheck

# Build TypeScript
npm run build

# Run tests
npm run test

# Dev mode (build sidecar + launch Tauri with hot-reload)
npm run dev

# Headless mode (no GUI, for quick iteration)
npm run start:cli

# Package for distribution
npm run pack     # .app only
npm run dist     # .app + .dmg
```

### 11.3 How to Add New Features

**Adding a new Slack event handler:**
1. Add the event handler in `src/slack.ts` inside `createApp()`
2. Filter by `config.slack.userId` (only respond to your events)
3. Fetch context with the `client` Web API
4. Write output via `src/obsidian.ts` or a new module
5. Add required user token scopes to `README.md`
6. Run `npm run typecheck && npm run build`

**Modifying Obsidian output format:**
1. Update `TodoEntry` interface in `src/obsidian.ts` if adding new fields
2. Update `formatTodo()` for the new Markdown output
3. Update `appendTodo()` if changing file structure or dedup logic
4. Update `src/slack.ts` where `appendTodo()` is called
5. Update tests in `tests/obsidian.test.ts`
6. Run `npm run test && npm run typecheck && npm run build`

**Packaging the app:**
1. Ensure changes compile: `npm run typecheck && npm run build`
2. Build: `npm run pack` (`.app`) or `npm run dist` (`.app` + `.dmg`)
3. Output: `src-tauri/target/release/bundle/macos/Slack Todos.app`
4. Install: `cp -r "src-tauri/target/release/bundle/macos/Slack Todos.app" /Applications/`

## 12. Dependencies

### 12.1 Node.js (package.json)

**Runtime:**

| Package | Version | Purpose |
|---|---|---|
| `@slack/bolt` | `^4.1.0` | Slack Bolt framework (Socket Mode, event handling) |
| `dotenv` | `^16.4.7` | Load `.env` files into `process.env` |

**Dev:**

| Package | Version | Purpose |
|---|---|---|
| `@types/node` | `^22.0.0` | Node.js type definitions |
| `@vitest/coverage-v8` | `^4.0.18` | V8 code coverage provider |
| `@yao-pkg/pkg` | `^6.14.0` | Package Node.js into standalone binary (sidecar) |
| `typescript` | `^5.7.0` | TypeScript compiler |
| `vitest` | `^4.0.18` | Test framework |

### 12.2 Rust (Cargo.toml)

| Crate | Version | Purpose |
|---|---|---|
| `tauri` | `2.10.0` | Tauri framework (features: `tray-icon`, `image-png`) |
| `tauri-plugin-shell` | `2` | Sidecar process spawning |
| `tauri-plugin-single-instance` | `2` | Prevent multiple app instances |
| `tauri-plugin-log` | `2` | Logging (debug builds only) |
| `serde` | `1.0` | Serialization (with `derive` feature) |
| `serde_json` | `1.0` | JSON parsing for sidecar IPC |
| `log` | `0.4` | Logging facade |
| `cocoa` | `0.26` | macOS native APIs (Dock hiding via `NSApplicationActivationPolicy`) |

**Build dependency:**

| Crate | Version | Purpose |
|---|---|---|
| `tauri-build` | `2.5.4` | Tauri build script (`build.rs`) |

## 13. Known Issues / Future Work

- **Code signing**: Disabled for personal use. Distributing to others would require an Apple Developer certificate and notarization.
- **macOS Gatekeeper**: Users must manually allow the app on first launch via System Settings → Privacy & Security.
- **arm64 only**: The sidecar is currently built for `aarch64-apple-darwin` only. Intel Mac support would require a second `@yao-pkg/pkg` target and a universal binary or separate build.
- **No settings UI**: Configuration is entirely via `.env` file. A settings window (Tauri webview or native) could allow editing tokens and paths without file editing.
- **No login item**: The app does not auto-start at login. Users must manually add it to Login Items or use a LaunchAgent.
- **Potential native rewrite**: The Node.js sidecar adds ~50 MB to the app bundle. A native Swift or Rust Slack client would eliminate this overhead.
- **No error recovery UI**: If the sidecar crashes, the tray shows "Error (sidecar exited)" but offers no way to restart it without quitting and relaunching the app.
- **Copilot code review**: GitHub Copilot code review is not available for private repositories (as of this writing).

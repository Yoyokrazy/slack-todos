# Slack Todos → Obsidian

A personal Slack app that watches for emoji reactions **you** add and syncs those messages as todos into an Obsidian vault. Runs as a macOS menu bar app or headless CLI.

## How it works

1. You react to any Slack message with `:yyk-todo:`
2. The app captures the message text and permalink
3. It appends a checkbox item to your Obsidian `Slack Todos.md` file
4. Duplicates are skipped automatically (matched by permalink)

The app uses **user tokens** (`xoxp-`), not bot tokens — it acts as you, stays invisible in channels, and can only see messages you have access to.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it something like `My Todos` and pick your workspace

#### Enable Socket Mode

1. **Settings → Socket Mode** → toggle **Enable Socket Mode**
2. Give the app-level token a name (e.g. `socket`) with the `connections:write` scope — copy the `xapp-...` token

#### User Token Scopes

Go to **OAuth & Permissions → Scopes → User Token Scopes** and add:

| Scope              | Why                        |
| ------------------ | -------------------------- |
| `channels:history` | Read messages you react to |
| `groups:history`   | Same, for private channels |
| `im:history`       | Same, for DMs              |
| `mpim:history`     | Same, for group DMs        |
| `reactions:read`   | Receive reaction events    |
| `users:read`       | Resolve display names      |
| `channels:read`    | Resolve channel names      |
| `groups:read`      | Same, for private channels |
| `im:read`          | Resolve DM channel info    |
| `mpim:read`        | Same, for group DMs        |

#### Event Subscriptions

Go to **Event Subscriptions → Subscribe to events on behalf of users** and add:

- `reaction_added`

#### Install to Workspace

Go to **Install App** → **Install to Workspace** → copy the `xoxp-...` User OAuth Token.

### 2. Find your Slack User ID

Open your Slack profile → click the **⋮** menu → **Copy member ID**.

### 3. Configure the app

Launch the app and click **Settings…** in the tray menu. Fill in your tokens, user ID, and todo file path, then click Save and restart.

### 4. Install & Run

```bash
npm install
npm run build
npm run dev        # Build sidecar + launch Tauri tray app
npm run start:cli  # Headless (no GUI)
```

For development:

```bash
npm run dev        # Build sidecar + cargo tauri dev
npm run test       # Run tests
npm run test:coverage  # Tests with coverage report
```

### 5. Build a macOS .app

```bash
npm run pack       # .app in src-tauri/target/release/bundle/macos/
npm run dist       # Full distributable
```

Then drag `Slack Todos.app` from `src-tauri/target/release/bundle/macos/` to `/Applications`.

> macOS may block it the first time — go to **System Settings → Privacy & Security → Open Anyway**.

## Settings

The tray menu includes a **Settings…** item that opens a native settings window. From there you can edit all configuration values (Slack tokens, user ID, emoji, vault path, and todo file) without touching the `.env` file directly. Changes require a restart to take effect.

The vault path field includes a **Browse…** button that opens a native folder picker.

## Output format

Each synced todo appears in your Obsidian file as:

```markdown
- [ ] todo Hey can you review the PR? [link](https://yourteam.slack.com/archives/...)
```

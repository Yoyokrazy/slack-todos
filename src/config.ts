/**
 * Application configuration loaded from environment variables.
 *
 * Supports four .env file locations (checked in order):
 * 1. App data dir: `~/Library/Application Support/com.slack-todos.tray/.env`
 * 2. Tauri bundled resource: `<executable dir>/../Resources/resources/.env`
 * 3. Packaged Electron app: `<Resources>/.env`
 * 4. Development: `<cwd>/.env`
 *
 * Required env vars: SLACK_USER_TOKEN, SLACK_APP_TOKEN, SLACK_USER_ID, TODO_FILE_PATH
 * Optional env vars: TODO_EMOJI (default: "yyk-todo", comma-separated for multiple)
 */
import { config as loadEnv } from "dotenv";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

// In Tauri, the sidecar binary sits in MacOS/ — .env is in ../Resources/resources/.env
// In packaged Electron app, .env lives in the Resources folder.
// App data dir stores user-modified config from the settings window.
// In dev, it's in the project root (cwd).
const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const execDir = dirname(process.execPath);

/** macOS app data directory for persistent config and state. */
export const appDataDir = join(homedir(), "Library", "Application Support", "com.slack-todos.tray");

const envPaths = [
    join(appDataDir, ".env"),
    join(execDir, "..", "Resources", "resources", ".env"),
    join(execDir, "..", "Resources", ".env"),
    resourcesPath ? join(resourcesPath, ".env") : "",
    join(process.cwd(), ".env"),
].filter(Boolean);

for (const p of envPaths) {
    if (existsSync(p)) {
        loadEnv({ path: p });
        break;
    }
}

/**
 * Reads an env var or throws if missing.
 * Used for values that have no sensible default.
 */
export function required(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required env var: ${key}`);
    }
    return value;
}

/** Validated, typed application config. */
export const config = {
    slack: {
        /** Slack user OAuth token (xoxp-...) */
        userToken: required("SLACK_USER_TOKEN"),
        /** Slack app-level token for Socket Mode (xapp-...) */
        appToken: required("SLACK_APP_TOKEN"),
        /** Your Slack member ID — only reactions from this user are captured */
        userId: required("SLACK_USER_ID"),
    },
    /** Custom emoji name(s) (without colons) that trigger a todo sync. Comma-separated for multiple. */
    todoEmojis: (process.env.TODO_EMOJI ?? "yyk-todo")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    /** Custom suffixes appended to each todo line. Supports {{date}} for today's date (YYYY-MM-DD). */
    todoSuffixes: (process.env.TODO_SUFFIX ?? "")
        .split("|||")
        .map((s) => s.trim())
        .filter(Boolean),
    /** Absolute path to the todo file (including filename and extension) */
    todoFilePath: process.env.TODO_FILE_PATH ?? required("TODO_FILE_PATH"),
} as const;

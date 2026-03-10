/**
 * Sidecar entry point for Tauri.
 *
 * Runs the Slack Bolt app as a standalone process. Emits JSON messages
 * to stdout so the Rust tray host can update its menu.
 *
 * Protocol (one JSON object per line):
 *   {"event":"status","value":"Running"}
 *   {"event":"sync","count":5}
 */
import { createApp } from "./slack.js";

/** Emit a JSON IPC message to stdout for the Tauri host. */
function emit(msg: Record<string, unknown>) {
    process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Parse --initial-count from process.argv. */
function parseInitialCount(): number {
    const idx = process.argv.indexOf("--initial-count");
    if (idx !== -1 && process.argv[idx + 1]) {
        const n = parseInt(process.argv[idx + 1], 10);
        return Number.isNaN(n) ? 0 : n;
    }
    return 0;
}

async function main() {
    try {
        const initialCount = parseInitialCount();
        const app = createApp({
            initialCount,
            onSync: (count) => {
                emit({ event: "sync", count });
            },
        });
        await app.start();
        emit({ event: "status", value: "Running" });
    } catch (err) {
        const msg = JSON.stringify({ event: "status", value: "Error" }) + "\n";
        console.error("Fatal:", err);
        // Flush the status message before exiting
        process.stdout.write(msg, () => process.exit(1));
    }
}

main();

/**
 * Headless (CLI) entry point.
 *
 * Starts the Slack Bolt app without Electron or a tray icon.
 * Use `npm run start:cli` or `node dist/index.js` to run.
 */
import { createApp } from "./slack.js";

async function main() {
    const app = createApp();
    await app.start();
    console.log("⚡ Slack-Todos is running (Socket Mode)");
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});

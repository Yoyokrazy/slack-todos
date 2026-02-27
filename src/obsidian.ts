/**
 * Obsidian vault writer.
 *
 * Appends Slack messages as Markdown checkbox items to a file inside
 * an Obsidian vault. Handles directory creation, file initialization,
 * and duplicate detection (by permalink).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Shape of a single todo item extracted from Slack. */
export interface TodoEntry {
    /** The Slack message text */
    text: string;
    /** Display name of the message author */
    author: string;
    /** Channel name (without #) */
    channel: string;
    /** Permanent URL to the original Slack message */
    permalink: string;
    /** ISO-8601 timestamp of the message */
    timestamp: string;
}

/**
 * Appends a todo entry to the specified file.
 *
 * Idempotent — if the entry's permalink already exists in the file,
 * the write is silently skipped.
 *
 * @param filePath - Absolute path to the todo file (including filename)
 * @param entry    - The todo to append
 */
export function appendTodo(
    filePath: string,
    entry: TodoEntry,
): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(filePath)) {
        appendFileSync(filePath, "# Slack Todos\n\n", "utf-8");
    }

    // Duplicate detection by permalink
    const existing = readFileSync(filePath, "utf-8");
    if (existing.includes(entry.permalink)) {
        return;
    }

    const line = formatTodo(entry);
    appendFileSync(filePath, line, "utf-8");
}

/**
 * Formats a TodoEntry into a Markdown checkbox line.
 * Truncates message text beyond 300 chars.
 */
export function formatTodo(entry: TodoEntry): string {
    const text =
        entry.text.length > 300 ? entry.text.slice(0, 297) + "…" : entry.text;
    return `- [ ] todo ${text} [link](${entry.permalink})\n`;
}

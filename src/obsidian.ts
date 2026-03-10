/**
 * Obsidian vault writer.
 *
 * Appends Slack messages as Markdown checkbox items to a file inside
 * an Obsidian vault. Handles directory creation, file initialization,
 * and duplicate detection (by permalink).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Maps priority levels (0–4) to their display emojis. */
export const PRIORITY_EMOJIS: Record<number, string> = {
    0: "🔺",
    1: "⏫",
    2: "🔼",
    3: "🔽",
    4: "⏬",
};

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
 * @param suffixes - Optional suffix templates appended to each line
 * @param priority - Optional priority level (0–4) rendered as an emoji before suffixes
 */
export function appendTodo(
    filePath: string,
    entry: TodoEntry,
    suffixes?: string[],
    priority?: number,
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

    const line = formatTodo(entry, suffixes, priority);
    appendFileSync(filePath, line, "utf-8");
}

/**
 * Formats a TodoEntry into a Markdown checkbox line.
 * Truncates message text beyond 300 chars.
 * Appends configured suffixes with {{date}} interpolation.
 */
export function formatTodo(entry: TodoEntry, suffixes?: string[], priority?: number): string {
    const text =
        entry.text.length > 300 ? entry.text.slice(0, 297) + "…" : entry.text;
    const today = new Date().toISOString().slice(0, 10);
    const priorityStr = priority !== undefined && PRIORITY_EMOJIS[priority]
        ? " " + PRIORITY_EMOJIS[priority]
        : "";
    const resolvedSuffix = suffixes && suffixes.length > 0
        ? " " + suffixes.map((s) => s.replace(/\{\{date\}\}/g, today)).join(" ")
        : "";
    return `- [ ] todo ${text} [link](${entry.permalink})${priorityStr}${resolvedSuffix}\n`;
}

/**
 * Updates the priority emoji on an existing todo identified by permalink.
 * If no matching todo is found, the call is silently ignored.
 *
 * @param filePath  - Absolute path to the todo file
 * @param permalink - Permanent URL identifying the todo to update
 * @param priority  - Priority level (0–4)
 */
export function updateTodoPriority(
    filePath: string,
    permalink: string,
    priority: number,
): void {
    if (!existsSync(filePath)) return;
    const emoji = PRIORITY_EMOJIS[priority];
    if (!emoji) return;

    const content = readFileSync(filePath, "utf-8");
    if (!content.includes(permalink)) return;

    const linkMarker = `[link](${permalink})`;
    const lines = content.split("\n");
    const updated = lines.map((line) => {
        if (!line.includes(linkMarker)) return line;
        const linkIdx = line.indexOf(linkMarker);
        const before = line.slice(0, linkIdx + linkMarker.length);
        let after = line.slice(linkIdx + linkMarker.length);

        // Strip existing priority emoji if present
        for (const existing of Object.values(PRIORITY_EMOJIS)) {
            if (after.startsWith(` ${existing}`)) {
                after = after.slice(` ${existing}`.length);
                break;
            }
        }

        return `${before} ${emoji}${after}`;
    });

    writeFileSync(filePath, updated.join("\n"), "utf-8");
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendTodo, formatTodo, type TodoEntry } from "../src/obsidian.js";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTodo(overrides?: Partial<TodoEntry>): TodoEntry {
    return {
        text: "Review the PR please",
        author: "Jane Smith",
        channel: "engineering",
        permalink: "https://team.slack.com/archives/C123/p1700000000",
        timestamp: "2026-02-18T12:00:00.000Z",
        ...overrides,
    };
}

describe("formatTodo", () => {
    it("formats a standard entry as a markdown checkbox", () => {
        const entry = makeTodo();
        const result = formatTodo(entry);
        expect(result).toBe(
            "- [ ] todo Review the PR please [link](https://team.slack.com/archives/C123/p1700000000)\n",
        );
    });

    it("truncates text longer than 300 characters", () => {
        const longText = "a".repeat(400);
        const result = formatTodo(makeTodo({ text: longText }));
        // Should be 297 chars + ellipsis
        expect(result).toContain("a".repeat(297) + "…");
        expect(result).not.toContain("a".repeat(298));
    });

    it("preserves text exactly at 300 characters", () => {
        const text = "b".repeat(300);
        const result = formatTodo(makeTodo({ text }));
        expect(result).toContain(text);
        expect(result).not.toContain("…");
    });

    it("includes the permalink as a markdown link", () => {
        const entry = makeTodo({ permalink: "https://example.com/msg" });
        const result = formatTodo(entry);
        expect(result).toContain("[link](https://example.com/msg)");
    });
});

describe("appendTodo", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "slack-todos-test-"));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates the file with a header when it does not exist", () => {
        appendTodo(join(tmpDir, "Todos.md"), makeTodo());
        const content = readFileSync(join(tmpDir, "Todos.md"), "utf-8");
        expect(content).toMatch(/^# Slack Todos\n\n/);
    });

    it("appends a todo entry to a new file", () => {
        appendTodo(join(tmpDir, "Todos.md"), makeTodo());
        const content = readFileSync(join(tmpDir, "Todos.md"), "utf-8");
        expect(content).toContain("- [ ] todo Review the PR please");
        expect(content).toContain("[link](https://team.slack.com/archives/C123/p1700000000)");
    });

    it("appends to an existing file without duplicating the header", () => {
        const filePath = join(tmpDir, "Todos.md");
        writeFileSync(filePath, "# Slack Todos\n\n- [ ] todo Existing item [link](https://other.com)\n", "utf-8");

        appendTodo(filePath, makeTodo());
        const content = readFileSync(filePath, "utf-8");
        const headerCount = (content.match(/# Slack Todos/g) || []).length;
        expect(headerCount).toBe(1);
        expect(content).toContain("Existing item");
        expect(content).toContain("Review the PR please");
    });

    it("skips duplicates based on permalink", () => {
        appendTodo(join(tmpDir, "Todos.md"), makeTodo());
        appendTodo(join(tmpDir, "Todos.md"), makeTodo());

        const content = readFileSync(join(tmpDir, "Todos.md"), "utf-8");
        const occurrences = (content.match(/p1700000000/g) || []).length;
        expect(occurrences).toBe(1);
    });

    it("allows entries with different permalinks", () => {
        appendTodo(join(tmpDir, "Todos.md"), makeTodo({ permalink: "https://a.com/1" }));
        appendTodo(join(tmpDir, "Todos.md"), makeTodo({ permalink: "https://a.com/2", text: "Second item" }));

        const content = readFileSync(join(tmpDir, "Todos.md"), "utf-8");
        expect(content).toContain("https://a.com/1");
        expect(content).toContain("https://a.com/2");
    });

    it("creates nested directories if needed", () => {
        appendTodo(join(tmpDir, "sub/folder/Todos.md"), makeTodo());
        const content = readFileSync(join(tmpDir, "sub/folder/Todos.md"), "utf-8");
        expect(content).toContain("Review the PR please");
    });
});

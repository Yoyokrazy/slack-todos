import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";

// Prevent dotenv from loading the real .env file during tests
vi.mock("dotenv", () => ({
    config: vi.fn(),
}));

describe("config", () => {
    const VALID_ENV = {
        SLACK_USER_TOKEN: "xoxp-test-token",
        SLACK_APP_TOKEN: "xapp-test-token",
        SLACK_USER_ID: "U12345",
        TODO_FILE_PATH: "/tmp/vault/Slack-Todos.md",
    };

    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        // Clear all env vars we care about
        for (const key of [
            "SLACK_USER_TOKEN",
            "SLACK_APP_TOKEN",
            "SLACK_USER_ID",
            "TODO_FILE_PATH",
            "TODO_EMOJI",
        ]) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it("required() throws when env var is missing", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { required } = await import("../src/config.js");
        expect(() => required("NONEXISTENT_VAR")).toThrow("Missing required env var: NONEXISTENT_VAR");
    });

    it("required() returns the value when present", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { required } = await import("../src/config.js");
        expect(required("SLACK_USER_TOKEN")).toBe("xoxp-test-token");
    });

    it("loads all required config when env vars are set", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { config } = await import("../src/config.js");

        expect(config.slack.userToken).toBe("xoxp-test-token");
        expect(config.slack.appToken).toBe("xapp-test-token");
        expect(config.slack.userId).toBe("U12345");
        expect(config.todoFilePath).toBe("/tmp/vault/Slack-Todos.md");
    });

    it("uses default todoEmojis when TODO_EMOJI is not set", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual(["yyk-todo"]);
    });

    it("uses custom todoEmojis when TODO_EMOJI is set", async () => {
        process.env = { ...process.env, ...VALID_ENV, TODO_EMOJI: "custom-emoji" };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual(["custom-emoji"]);
    });

    it("supports comma-separated todoEmojis", async () => {
        process.env = { ...process.env, ...VALID_ENV, TODO_EMOJI: "todo,white_check_mark, star" };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual(["todo", "white_check_mark", "star"]);
    });

    it("throws when SLACK_USER_TOKEN is missing", async () => {
        const { SLACK_USER_TOKEN, ...partial } = VALID_ENV;
        process.env = { ...process.env, ...partial };
        await expect(import("../src/config.js")).rejects.toThrow("Missing required env var: SLACK_USER_TOKEN");
    });

    it("throws when TODO_FILE_PATH is missing", async () => {
        const { TODO_FILE_PATH, ...partial } = VALID_ENV;
        process.env = { ...process.env, ...partial };
        await expect(import("../src/config.js")).rejects.toThrow("Missing required env var: TODO_FILE_PATH");
    });
});

describe("config path resolution", () => {
    const VALID_ENV = {
        SLACK_USER_TOKEN: "xoxp-test-token",
        SLACK_APP_TOKEN: "xapp-test-token",
        SLACK_USER_ID: "U12345",
        TODO_FILE_PATH: "/tmp/vault/Slack-Todos.md",
    };

    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        for (const key of [
            "SLACK_USER_TOKEN", "SLACK_APP_TOKEN", "SLACK_USER_ID",
            "TODO_FILE_PATH", "TODO_EMOJI",
        ]) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it("loads from Tauri bundled path when it exists", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        vi.doMock("node:fs", () => ({
            existsSync: (p: string) => p.includes("/Resources/resources/.env"),
        }));
        const { config: loadEnv } = await import("dotenv");
        vi.mocked(loadEnv).mockClear();
        await import("../src/config.js");
        expect(loadEnv).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringContaining("Resources/resources/.env") }),
        );
    });

    it("skips to cwd when bundled paths do not exist", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const cwdEnv = join(process.cwd(), ".env");
        vi.doMock("node:fs", () => ({
            existsSync: (p: string) => p === cwdEnv,
        }));
        const { config: loadEnv } = await import("dotenv");
        vi.mocked(loadEnv).mockClear();
        await import("../src/config.js");
        expect(loadEnv).toHaveBeenCalledWith(expect.objectContaining({ path: cwdEnv }));
    });

    it("does not call dotenv when no .env exists at any path", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        vi.doMock("node:fs", () => ({
            existsSync: () => false,
        }));
        const { config: loadEnv } = await import("dotenv");
        vi.mocked(loadEnv).mockClear();
        await import("../src/config.js");
        expect(loadEnv).not.toHaveBeenCalled();
    });

    it("stops at the first matching path", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        vi.doMock("node:fs", () => ({
            existsSync: () => true,
        }));
        const { config: loadEnv } = await import("dotenv");
        vi.mocked(loadEnv).mockClear();
        await import("../src/config.js");
        expect(loadEnv).toHaveBeenCalledTimes(1);
    });
});

describe("todoEmojis edge cases", () => {
    const VALID_ENV = {
        SLACK_USER_TOKEN: "xoxp-test-token",
        SLACK_APP_TOKEN: "xapp-test-token",
        SLACK_USER_ID: "U12345",
        TODO_FILE_PATH: "/tmp/vault/Slack-Todos.md",
    };

    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        for (const key of [
            "SLACK_USER_TOKEN", "SLACK_APP_TOKEN", "SLACK_USER_ID",
            "TODO_FILE_PATH", "TODO_EMOJI",
        ]) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it("returns empty array for empty string", async () => {
        process.env = { ...process.env, ...VALID_ENV, TODO_EMOJI: "" };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual([]);
    });

    it("filters out whitespace-only entries", async () => {
        process.env = { ...process.env, ...VALID_ENV, TODO_EMOJI: "todo, ,star" };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual(["todo", "star"]);
    });

    it("handles trailing commas", async () => {
        process.env = { ...process.env, ...VALID_ENV, TODO_EMOJI: "todo,star," };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual(["todo", "star"]);
    });

    it("handles single emoji without commas", async () => {
        process.env = { ...process.env, ...VALID_ENV, TODO_EMOJI: "checkmark" };
        const { config } = await import("../src/config.js");
        expect(config.todoEmojis).toEqual(["checkmark"]);
    });
});

describe("required() descriptive errors", () => {
    const VALID_ENV = {
        SLACK_USER_TOKEN: "xoxp-test-token",
        SLACK_APP_TOKEN: "xapp-test-token",
        SLACK_USER_ID: "U12345",
        TODO_FILE_PATH: "/tmp/vault/Slack-Todos.md",
    };

    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        for (const key of [
            "SLACK_USER_TOKEN", "SLACK_APP_TOKEN", "SLACK_USER_ID",
            "TODO_FILE_PATH", "TODO_EMOJI",
        ]) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it("throws descriptive error when SLACK_APP_TOKEN is missing", async () => {
        const { SLACK_APP_TOKEN, ...partial } = VALID_ENV;
        process.env = { ...process.env, ...partial };
        await expect(import("../src/config.js")).rejects.toThrow("Missing required env var: SLACK_APP_TOKEN");
    });

    it("throws descriptive error when SLACK_USER_ID is missing", async () => {
        const { SLACK_USER_ID, ...partial } = VALID_ENV;
        process.env = { ...process.env, ...partial };
        await expect(import("../src/config.js")).rejects.toThrow("Missing required env var: SLACK_USER_ID");
    });

    it("includes the variable name in the error message", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { required } = await import("../src/config.js");
        expect(() => required("MY_CUSTOM_VAR")).toThrow("MY_CUSTOM_VAR");
    });
});

describe("config immutability", () => {
    const VALID_ENV = {
        SLACK_USER_TOKEN: "xoxp-test-token",
        SLACK_APP_TOKEN: "xapp-test-token",
        SLACK_USER_ID: "U12345",
        TODO_FILE_PATH: "/tmp/vault/Slack-Todos.md",
    };

    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        for (const key of [
            "SLACK_USER_TOKEN", "SLACK_APP_TOKEN", "SLACK_USER_ID",
            "TODO_FILE_PATH", "TODO_EMOJI",
        ]) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it("top-level properties are readonly (as const)", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { config } = await import("../src/config.js");

        // @ts-expect-error — Cannot assign to 'slack' because it is a read-only property
        config.slack = {};
        // @ts-expect-error — Cannot assign to 'todoEmojis' because it is a read-only property
        config.todoEmojis = [];
        // @ts-expect-error — Cannot assign to 'todoFilePath' because it is a read-only property
        config.todoFilePath = "/other";
    });

    it("nested properties are readonly (as const)", async () => {
        process.env = { ...process.env, ...VALID_ENV };
        const { config } = await import("../src/config.js");

        // @ts-expect-error — Cannot assign to 'userToken' because it is a read-only property
        config.slack.userToken = "modified";
        // @ts-expect-error — Cannot assign to 'appToken' because it is a read-only property
        config.slack.appToken = "modified";
    });
});

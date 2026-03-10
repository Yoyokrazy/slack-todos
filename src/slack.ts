/**
 * Slack Bolt application.
 *
 * Listens for `reaction_added` events via Socket Mode. When the configured
 * user reacts with the configured emoji, the original message is fetched,
 * enriched with author/channel/permalink metadata, and written to Obsidian.
 */
import App from "@slack/bolt";
import type { ReactionAddedEvent } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { config } from "./config.js";
import { appendTodo, updateTodoPriority } from "./obsidian.js";

/**
 * Options for creating the Slack Bolt app.
 */
export interface CreateAppOptions {
    /** Callback invoked after each successful sync with the cumulative count. */
    onSync?: (count: number) => void;
    /** Initial sync count to resume from (loaded from persistent state). */
    initialCount?: number;
}

/** Maps Slack number-emoji reaction names to priority levels. */
const PRIORITY_REACTIONS: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
};

/**
 * Creates and configures the Slack Bolt app.
 *
 * @param options - Configuration options including sync callback and initial count.
 * @returns A configured Bolt App instance (call `.start()` to connect).
 */
export function createApp(options: CreateAppOptions = {}) {
    const { onSync, initialCount = 0 } = options;
    let syncCount = initialCount;
    const app = new App({
        appToken: config.slack.appToken,
        socketMode: true,
        authorize: async () => ({
            userToken: config.slack.userToken,
        }),
    });

    app.event("reaction_added", async ({ event, client }: { event: ReactionAddedEvent; client: WebClient }) => {
        // Only react to YOUR reactions
        if (event.user !== config.slack.userId) return;

        const priority = PRIORITY_REACTIONS[event.reaction];
        if (priority !== undefined) {
            try {
                const linkResult = await client.chat.getPermalink({
                    channel: event.item.channel,
                    message_ts: event.item.ts,
                });
                if (linkResult.permalink) {
                    updateTodoPriority(config.todoFilePath, linkResult.permalink, priority);
                    console.log(`🔢 Updated priority to ${priority}`);
                }
            } catch (err) {
                console.error("Failed to update todo priority:", err);
            }
            return;
        }

        // Only react to the configured emoji(s)
        if (!config.todoEmojis.includes(event.reaction)) return;

        try {
            // Fetch the original message
            const result = await client.conversations.history({
                channel: event.item.channel,
                latest: event.item.ts,
                inclusive: true,
                limit: 1,
            });

            const message = result.messages?.[0];
            if (!message || !message.text) {
                console.warn("Could not fetch reacted message");
                return;
            }

            // Get a permalink for the message
            const linkResult = await client.chat.getPermalink({
                channel: event.item.channel,
                message_ts: event.item.ts,
            });

            // Resolve display names
            const authorInfo = await client.users.info({
                user: message.user ?? event.user,
            });

            const channelInfo = await client.conversations.info({
                channel: event.item.channel,
            });

            appendTodo(config.todoFilePath, {
                text: message.text,
                author:
                    authorInfo.user?.real_name ??
                    authorInfo.user?.name ??
                    "Unknown",
                channel: channelInfo.channel?.name ?? event.item.channel,
                permalink: linkResult.permalink ?? "",
                timestamp: new Date(
                    parseFloat(event.item.ts) * 1000,
                ).toISOString(),
            }, config.todoSuffixes.length > 0 ? config.todoSuffixes : undefined);

            console.log(
                `✅ Synced todo from #${channelInfo.channel?.name ?? event.item.channel}`,
            );
            syncCount++;
            onSync?.(syncCount);
        } catch (err) {
            console.error("Failed to sync todo:", err);
        }
    });

    return app;
}

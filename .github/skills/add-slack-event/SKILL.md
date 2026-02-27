---
name: add-slack-event
description: 'Add a new Slack event handler to the Bolt app. Use when adding new event types like message_changed, reaction_removed, or app_mention.'
---

# Add a Slack Event Handler

## When to Use

- Adding support for a new Slack event type
- Extending the app to react to different event patterns

## Procedure

1. Identify the event type from the [Slack Events API](https://api.slack.com/events)
2. Check if the event requires additional OAuth scopes in `README.md`
3. Add the event handler in `src/slack.ts` inside `createApp()`
4. Follow the existing pattern:
    - Filter by `config.slack.userId` (only respond to your events)
    - Fetch necessary context with the `client` Web API
    - Write output via `src/obsidian.ts` or a new output module
5. Update the `onSync` callback if the new event should increment the sync count
6. Add user token scopes to the README scopes table if needed
7. Write tests covering the new handler logic
8. Run `npm run typecheck && npm run build` to verify

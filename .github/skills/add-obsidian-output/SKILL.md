---
name: add-obsidian-output
description: 'Add or modify Obsidian output formatting. Use when changing how todos appear in the vault, adding new metadata fields, or creating new output files.'
---

# Add or Modify Obsidian Output

## When to Use

- Changing the todo line format
- Adding new metadata (tags, dates, priorities) to entries
- Writing to additional vault files (e.g., daily notes)

## Procedure

1. Modify `TodoEntry` interface in `src/obsidian.ts` if adding new fields
2. Update `formatTodo()` to include new fields in the Markdown output
3. Update `appendTodo()` if changing file structure or dedup logic
4. Ensure Markdown output is valid — Obsidian renders standard CommonMark
5. Update corresponding fields in `src/slack.ts` where `appendTodo()` is called
6. Update tests in `tests/obsidian.test.ts` to cover new formatting
7. Run `npm run test` to verify, then `npm run typecheck && npm run build`

## Format Guidelines

- Each todo is a single line starting with `- [ ] `
- Keep lines scannable — truncate long text (currently 300 char limit)
- Links use Markdown syntax: `[link](url)`
- Obsidian supports `#tags`, `[[wikilinks]]`, and YAML frontmatter

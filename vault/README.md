# vault

Keeps an Obsidian vault for you, with no hand-logging.

- **One note per session** in `<vault>/sessions/`, found by session id so resume, compact and `/clear` never create duplicates. Linked under `## Sessions` in today's daily note.
- **Auto-summary**: on exit the mod asks the session's own model (low effort, cached transcript) for Log, Key Decisions and Open Questions bullets, writes them into the note, sets `status: archived` and rolls decisions into the daily note.
- **Prior context**: the system prompt gets the active note path plus recent sessions, decisions, open questions, related knowledge notes and plans for the repo.
- **Domain context**: `projects/*/_context.md` with `keywords: [a, b]` frontmatter is appended to a prompt that mentions a keyword.

## Install

```
/plugin marketplace add Dizzyobeah/claude_plugins
/plugin install vault@dizzyobeah-plugins
```

Setup asks for **Vault path** (absolute path to the vault folder) and an optional **Index script** (run as `<script> <repo>` after each session). Change either later in `/config`.

## Replacing the old shell hooks

Remove the `vault-session-start.sh`, `vault-session-end.sh`, `route-domain.sh` and `pretool-memory.sh` entries from `~/.claude/settings.json`, and drop the "YOU MUST append" block from `~/.claude/CLAUDE.md`. `vault-plan-sync.sh` is not part of this mod and can stay. Add `Read/Edit/Write(<vault>/**)` once to your user permissions.

## Limits

- Needs no Obsidian app or CLI: it writes files directly.
- Summary needs a turn that has run; a session that exits before its first reply keeps an empty note.
- `session.end` has a short bound; if the summary fork does not finish, the note is archived without it.

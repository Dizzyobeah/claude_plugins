# model-router

A Claude Code mod that classifies every prompt you type and runs the turn on the model that fits:

| Tier | Examples | Model | Band colour |
| --- | --- | --- | --- |
| simple | file renames, git commits, quick lookups | `claude-haiku-5-5` | blue |
| standard | features, refactors, tests, typical bug fixes | `claude-sonnet-5-5` | green |
| complex | architecture, deep debugging, multi-file logic | `claude-opus-5-5` | magenta |

Classification is one fast Haiku call (`$.model.classify`) before the prompt runs; if it fails the turn runs on Sonnet.
Subagents keep their own models.

A band above the prompt shows the live route and session totals:

```
🤖 [Router Active] -> [Current Model: claude-sonnet-5-5] · 41.2k tok · $0.0912 · saved $0.0911 vs Opus
```

Savings compare each turn's tokens with the same tokens billed at Opus 5.5 list price.

## Control it: `/route`

| Command | Effect |
| --- | --- |
| `/route` | Toggle routing off ↔ on |
| `/route on` / `auto` | Classify and route each prompt (default) |
| `/route off` | Router steps aside; your session model runs |
| `/route haiku` / `sonnet` / `opus` | Lock every turn to that model, no classification |
| `/route status` | Show the current state |

The band shows `Router Active`, `Router Off` (dim, with the session model) or `Router Locked`. The setting lasts for the session only.

## Install

```
/plugin marketplace add <owner>/<repo>
/plugin install model-router@calund-plugins
```

Before the repository is on GitHub, use the local folder instead: `/plugin marketplace add /Users/calund/projects/_git/claude_plugins`.

Or try it locally: `claude --plugin-dir ./model-router`.

## Notes

- Prices (per MTok, in `hooks/register.tsx` → `TIERS`): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20; cache writes 1.25× input. Update them there when pricing changes.
- Switching models between turns starts a fresh prompt cache on the new model, so a route change costs a cache write.
- The classifier call's own tokens are not counted in the totals.
- Slash commands and hidden prompts are not classified; they run on the last route.

## Develop

```
claude plugin validate .
claude plugin test .
```

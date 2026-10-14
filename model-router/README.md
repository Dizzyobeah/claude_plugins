# model-router

A Claude Code mod that classifies every prompt you type and runs the turn on the model that fits:

| Tier | Examples | Model | Effort | Band colour |
| --- | --- | --- | --- | --- |
| simple | file renames, git commits, quick lookups | `claude-haiku-5-5` | low | blue |
| standard | features, refactors, tests, typical bug fixes | `claude-sonnet-5-5` | medium | green |
| complex | architecture, deep debugging, multi-file logic | `claude-opus-5-5` | medium | magenta |

Classification is one fast Haiku call (`$.model.classify`) before the prompt runs; if it fails the turn runs on Sonnet.
Subagents keep their own models.

A band above the prompt shows the live route and session totals:

```
 🤖 Router Active  claude-sonnet-5-5 · effort medium  41.2k tok · $0.0912 · saved $0.0911 vs Opus 
```

It is drawn as dark Powerlevel10k-style segments with arrow separators, so it needs a Powerline/Nerd Font in your terminal; without one the arrows show as boxes.

Savings compare each turn's tokens with the same tokens billed at Opus 5.5 list price.

## Control it: `/route`

| Command | Effect |
| --- | --- |
| `/route` | Toggle routing off ↔ on |
| `/route on` / `auto` | Classify and route each prompt (default) |
| `/route off` | Router steps aside; your session model runs |
| `/route haiku` / `sonnet` / `opus` | Lock every turn to that model, no classification |
| `/route fable` / `mythos` | Lock every turn to `claude-fable-5-1` or `claude-mythos-5-1` ($10/$50 per MTok, 2.5× Opus), effort `medium`. Asks you to confirm twice |
| `/route effort <level>` | Use this effort for every routed turn (`low`, `medium`, `high`) |
| `/route effort xhigh` / `max` | Same, but asks you to confirm first |
| `/route effort default` | Back to each tier's default effort |
| `/route status` | Show the current state |

The band shows `Router Active`, `Router Off` (dim, with the session model) or `Router Locked`, plus the effort. The settings last for the session only.

Automatic routing never picks `xhigh`, `max` or Fable; they burn tokens fast, so `xhigh`/`max` need your explicit yes each time, and Fable and Mythos only run when you lock them with `/route fable` or `/route mythos` and answer yes to two separate confirmations. A dismissed or unanswered dialog counts as no. Mythos 5.1 is only available to Project Glasswing participants; without access its requests fail.

## Install

```
/plugin marketplace add <owner>/<repo>
/plugin install model-router@calund-plugins
```

Before the repository is on GitHub, use the local folder instead: `/plugin marketplace add /Users/calund/projects/_git/claude_plugins`.

Or try it locally: `claude --plugin-dir ./model-router`.

## Notes

- Prices (per MTok, in `hooks/register.tsx` → `TIERS`): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Fable 5.1 and Mythos 5.1 $10/$50 (cache reads $0.25); cache writes 1.25× input. Update them there when pricing changes.
- Default effort per tier is also in `TIERS`. Effort is sent on each `turn.step`; a model without effort support is sent none.
- Switching models between turns starts a fresh prompt cache on the new model, so a route change costs a cache write. A change of effort may do the same; not yet measured.
- The classifier call's own tokens are not counted in the totals.
- Slash commands and hidden prompts are not classified; they run on the last route.

## Develop

```
claude plugin validate .
claude plugin test .
```

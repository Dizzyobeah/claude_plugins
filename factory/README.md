# factory

A small multi-agent loop for Claude Code. `/factory` takes a one-line feature through:

```
feature -> spec -> build (own branch + worktree) -> parallel reviews -> approval -> pull request
```

State lives in `.factory/board.json` in your project, changed only through the bundled `board.py`. A live HTML dashboard shows every job. Everything project-specific (what the repo is, how to test, who reviews, what always needs a human) is in one file, `.factory/config.json`.

## Rules
- Agents get context from files, not the conversation; each writes only its own file.
- The `/factory` skill is the only writer of `board.json`, and only through `board.py`.
- It never merges into the default branch: approved work becomes a pull request on the latest `origin/main`; a human merges it.
- A missing agent file is never written by the orchestrator: it resumes the agent, re-spawns it once with opus, then asks you.
- Only `[introduced]` review findings block a job; `[pre-existing]` ones go to `.factory/backlog.md`.
- "Not run" tests never count as a pass. Escalation is rule-based (`escalate_on`), not size-based.

## Requirements
- A git repo with remote `origin` and default branch `main`.
- `git`, Python 3 (standard library only) and the GitHub CLI `gh`, authenticated with `repo` scope (add `workflow` if jobs touch `.github/workflows/`).
- Your project's test toolchain, on the host or in Docker.

## Install
```
/plugin marketplace add Dizzyobeah/claude_plugins
/plugin install factory@dizzyobeah-plugins
```

## Set up a project
1. Run `/factory status`. With no `.factory/config.json` it asks which profile fits and installs it (`python3 <plugin>/scripts/board.py profile <name>`):

   | Profile | Reviewers |
   |---|---|
   | `backend` | security, api-contract, reliability, code |
   | `data-engineering` | data-governance, data-contract, data-quality, code; escalates on destructive DDL, large backfills, PII, external-consumer tables |
   | `frontend` | ui, ux, security, code; with screenshots |

2. Fill in `.factory/config.json`; the factory refuses to start while any value says `TODO`:
   `project.name/summary/conventions/docs`, `tests.host` / `tests.docker` (a command that passes on a clean `main`), optional `tests.screenshots`, `reviewers[]` (`key`, `label`, `model`, `focus`; exactly one has `"runs_tests": true`), `max_rounds`, `escalate_on[]`.
3. Add to `.gitignore` (the skill offers to):
   ```
   .factory/jobs/*
   .factory/board.json
   .factory/backlog.md
   .claude/worktrees/
   ```
4. Commit `.factory/config.json`, then run one small, low-risk job and check it ends in an open PR with a review file per reviewer.

A copy of `profiles/<name>/config.json`, `backlog.example.md` or `dashboard.html` placed in `.factory/` overrides the bundled one.

## Use
- `/factory <one-line feature>` runs the whole loop.
- `/factory next` takes the first unchecked line in `.factory/backlog.md`.
- `/factory status` shows in-flight jobs, open PRs, jobs needing a human, leftover worktrees and branches behind `origin/main`.
- `/factory approve <job-id>` or `/factory rework <job-id> <note>` for escalated jobs.
- Dashboard: `python3 <plugin>/scripts/board.py serve`, then open http://localhost:8765/dashboard.html (`--port`, `--interval`). Ask Claude for the exact command; it knows the plugin path.
- Every command starts with `board.py sync-prs`, which marks jobs whose PR merged as `merged`.

## How the loop works
1. **Preflight** runs `tests.host`, falling back to `tests.docker`, on current `main`; if neither works it stops.
2. **spec-writer** (opus) writes `spec.md`; `board.py overlap` blocks a job touching files of an in-flight job.
3. **builder** (opus) works on `factory/<job-id>` in `.claude/worktrees/<job-id>` and writes `build.md`.
4. **reviewer** agents, one per config entry, run in parallel and write `round-N/review-<key>.md` starting `VERDICT: PASS` or `VERDICT: CHANGES`.
5. Any `CHANGES` with rounds left resumes the builder; at `max_rounds` the job goes to the approver.
6. **approver** (opus) writes `decision.md`: `APPROVE` opens a PR (after merging `origin/main` and re-testing); `ESCALATE` waits for `/factory approve`.
7. A human merges; `sync-prs` marks the job `merged`, `board.py worktrees` lists what can be removed.

The agents are `factory:spec-writer`, `factory:builder`, `factory:reviewer` and `factory:approver`. Changing the loop shape means editing `skills/factory/SKILL.md`, `STAGES`/`IN_FLIGHT` in `scripts/board.py` and `STAGES` in `assets/dashboard.html`. Self-check: `python3 scripts/test_board.py`.

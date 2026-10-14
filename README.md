# calund-plugins

A Claude Code marketplace of my mods and plugins. Mods change Claude's own interface or behaviour (bands above the prompt, slash commands, hooks); plugins add skills, agents and commands. Each one lives in its own folder with its own README.

## Available

| Name | Type | What it does |
| --- | --- | --- |
| [model-router](./model-router) | mod | Routes each prompt to Haiku, Sonnet or Opus by complexity, shows a live cost band, `/route` to control it |

## Install

Add the marketplace once, then install what you want:

```
/plugin marketplace add <owner>/<repo>
/plugin install <name>@calund-plugins
```

Before the repository is on GitHub, add it from the local folder:

```
/plugin marketplace add /Users/calund/projects/_git/claude_plugins
```

## Add a mod or plugin

1. Create `<name>/` with `.claude-plugin/plugin.json` (and `hooks/hooks.json` for a mod).
2. Add an entry to `plugins` in `.claude-plugin/marketplace.json` with `"source": "./<name>"`.
3. Add a row to the table above.
4. Run `claude plugin validate .` here.

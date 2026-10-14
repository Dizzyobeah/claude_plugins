# dizzyobeah-plugins

Claude Code plugins and mods by Dizzyobeah. Mods change Claude's own interface or behaviour (bands above the prompt, slash commands, hooks); plugins add skills, agents and commands. Each one lives in its own folder with its own README.

## Available

| Name | Type | What it does |
| --- | --- | --- |
| [model-router](./model-router) | mod | Classifies each prompt and routes it to Haiku, Sonnet or Opus, with `/route` to control it |
| [usage-band](./usage-band) | mod | Session, daily and weekly usage pinned under the prompt; `/usage` opens a per-model pane. Works alongside model-router |

## Install

Add the marketplace once, then install what you want:

```
/plugin marketplace add Dizzyobeah/claude_plugins
/plugin install model-router@dizzyobeah-plugins
/plugin install usage-band@dizzyobeah-plugins
```

To test local changes, add it from the folder instead:

```
/plugin marketplace add /Users/calund/projects/_git/claude_plugins
```

## Add a mod or plugin

1. Create `<name>/` with `.claude-plugin/plugin.json` (and `hooks/hooks.json` for a mod).
2. Add an entry to `plugins` in `.claude-plugin/marketplace.json` with `"source": "./<name>"`.
3. Add a row to the table above.
4. Run `claude plugin validate .` here.

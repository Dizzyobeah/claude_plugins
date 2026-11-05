# dizzyobeah-plugins

Claude Code plugins and mods by Dizzyobeah. Mods change Claude's own interface or behaviour (bands above the prompt, slash commands, hooks); plugins add skills, agents and commands. Each one lives in its own folder with its own README.

## Available

| Name | Type | What it does |
| --- | --- | --- |
| [model-router](./model-router) | mod | Classifies each prompt and routes it to Haiku, Sonnet or Opus, with `/route` to control it |
| [usage-band](./usage-band) | mod | Session, daily and weekly usage in a band above the prompt; `/usage-band` turns it on (`off` hides it), click the band or `/usage-band pane` for a live per-model and per-agent pane. Works alongside model-router |

## Install

Add the marketplace once, then install what you want:

```
/plugin marketplace add Dizzyobeah/claude_plugins
/plugin install model-router@dizzyobeah-plugins
/plugin install usage-band@dizzyobeah-plugins
```

### Desktop app

Both mods also run in the Claude desktop app's Code tab. `/plugin` is a terminal command, so install from a terminal at the **user** scope (the default); every desktop Code session on this machine then loads them. There the bands and the usage pane draw with `·` separators, no terminal fill, and the app's own theme colours, so they read in light and dark mode.

To test local changes, add it from the folder instead:

```
/plugin marketplace add /Users/calund/projects/_git/claude_plugins
```

## Add a mod or plugin

1. Create `<name>/` with `.claude-plugin/plugin.json` (and `hooks/hooks.json` for a mod).
2. Add an entry to `plugins` in `.claude-plugin/marketplace.json` with `"source": "./<name>"`.
3. Add a row to the table above.
4. Run `claude plugin validate .` here.

### Bands above the prompt

The band above the prompt is one tree per instance, so a plain `return <row/>` hides every other plugin's band. A mod that draws there must stack: `if (e.props.hasSurvey) return next(e)`, `const rest = await next(e)`, then return `rest ? <Box flexDirection="column">{rest}{row}</Box> : row`. model-router and usage-band do this, so they show together.

import { atom, read, update } from 'claude-code'
import type { Register, ThemeKey } from 'claude-code'

import type { Agents, Daily } from '../types'

const PANE = 'usage'
const STORE_KEY = 'daily'
const OFF_KEY = 'isOff'

// Same Powerline look as model-router.
const BG = '#303030'
const SEP = '\ue0b1'
const CAP = '\ue0b0'

// model-router's hues (blue, green, magenta, yellow, red) as theme keys, so the pane follows the selected theme.
const COLORS: [string, ThemeKey][] = [
  ['haiku', 'suggestion'], ['sonnet', 'success'], ['opus', 'merged'], ['fable', 'warning'], ['mythos', 'error'],
]
const colorOf = (model: string): ThemeKey => COLORS.find(([k]) => model.includes(k))?.[1] ?? 'inactive'

// ponytail: UTC day, not local; shift by the offset if the rollover hour matters.
const today = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const tokens = (n: number) =>
  n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`

const heat = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : '#5fd700')

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [])
const daily = atom({ plugin: 'usage-band', key: 'daily' } as const, { date: '', byModel: {} } as Daily)

const agents = atom({ plugin: 'usage-band', key: 'agents' } as const, {} as Agents)
const isOff = atom({ plugin: 'usage-band', key: 'isOff' } as const, false)

const total = (d: Daily) => Object.values(d.byModel).reduce((a, b) => a + b, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage', description: 'Show usage under the prompt (off to hide, pane for the per-model pane)', argumentHint: 'off|pane' })
    const stored = (await $.store.get(STORE_KEY)) as Daily | undefined
    const date = today(await $.clock.now())
    await update($, daily, () => (stored?.date === date ? stored : { date, byModel: {} }))
    const { rateLimits } = await $.session.usage()
    await update($, limits, () => rateLimits)
    const off = Boolean(await $.store.get(OFF_KEY))
    await update($, isOff, () => off)

    return next(e)
  })

  on('command.run', { command: 'usage' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'pane') {
      await $.ui.open({ id: PANE, title: 'Usage' })
      return { text: 'Usage pane opened.' }
    }
    if (arg !== '' && arg !== 'off') return { text: 'Usage: /usage [off|pane]' }
    await $.store.set(OFF_KEY, arg === 'off')
    await update($, isOff, () => arg === 'off')

    return { text: arg === 'off' ? 'Usage line hidden.' : 'Usage line on.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits)
    }

    return next(e)
  })

  // Name each subagent by its type and task; the main loop is 'main'.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = r.agentId
    if (id) {
      await update($, agents, a => ({ ...a, [id]: { label: `${e.subagentType}: ${e.description}`, model: r.model, tokens: 0, turns: 0 } }))
    }

    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage) {
      const u = e.usage
      const n = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const id = e.agentId ?? 'main'
      await update($, agents, a => {
        const was = a[id] ?? { label: id === 'main' ? 'main' : `agent ${id.slice(0, 6)}`, model: u.model, tokens: 0, turns: 0 }
        return { ...a, [id]: { ...was, model: u.model, tokens: was.tokens + n, turns: was.turns + 1 } }
      })
      const date = today(await $.clock.now())
      const prev = await read($, daily)
      const base = prev.date === date ? prev.byModel : {}
      const updated: Daily = { date, byModel: { ...base, [u.model]: (base[u.model] ?? 0) + n } }
      await update($, daily, () => updated)
      // ponytail: read-modify-write across concurrent sessions can drop a turn; fine for a gauge.
      await $.store.set(STORE_KEY, updated)
    }

    return next(e)
  })

  // A band above the prompt is one tree per instance: stack on whatever the hooks beneath drew (model-router's band).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e).catch(() => undefined) // nothing beneath = nothing to stack on
    if (e.props.hasSurvey || (await read($, isOff))) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    const ls = await read($, limits)
    const d = await read($, daily)
    const five = ls.find(l => l.kind === 'five_hour')
    const week = ls.find(l => l.kind === 'seven_day')
    const pct = (l: typeof five) => (l ? `${l.percentUsed}%` : 'n/a')
    const row = (
      <Button key="usage" label="Usage" onPress={() => $.ui.open({ id: PANE, title: 'Usage' })}>
        <Text backgroundColor={BG} color="#00afff" weight="bold">{' 📊 Usage '}</Text>
        <Text backgroundColor={BG} color="#808080">{SEP}</Text>
        <Text backgroundColor={BG} color={five ? heat(five.percentUsed) : '#808080'}>{` Session ${pct(five)} `}</Text>
        <Text backgroundColor={BG} color="#808080">{SEP}</Text>
        <Text backgroundColor={BG} color="#5fd700">{` Today ${tokens(total(d))} tok `}</Text>
        <Text backgroundColor={BG} color="#808080">{SEP}</Text>
        <Text backgroundColor={BG} color={week ? heat(week.percentUsed) : '#808080'}>{` Week ${pct(week)} `}</Text>
        <Text color={BG}>{CAP}</Text>
      </Button>
    )

    return rest ? <Box flexDirection="column">{rest}{row}</Box> : row
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const d = await read($, daily)
    const as = Object.entries(await read($, agents)).sort((x, y) => y[1].tokens - x[1].tokens)
    const sum = total(d)
    const rows = Object.entries(d.byModel).sort((x, y) => y[1] - x[1])
    const spent = as.reduce((t, [, a]) => t + a.tokens, 0)

    return (
      <Box flexDirection="column">
        <Text weight="bold">{`Tokens by model · ${d.date}`}</Text>
        {rows.length === 0 && <Text dimColor>No usage recorded today.</Text>}
        {rows.map(([model, n]) => {
          const p = (n / sum) * 100
          return (
            <Text>
              <Text color={colorOf(model)} weight="bold">{`${p.toFixed(1).padStart(5)}% `}</Text>
              <Text color={colorOf(model)}>{'█'.repeat(Math.max(1, Math.round(p / 5)))}</Text>
              <Text>{` ${model} `}</Text>
              <Text dimColor>{tokens(n)}</Text>
            </Text>
          )
        })}
        <Text weight="bold">{'\nAgents · this session'}</Text>
        {as.length === 0 && <Text dimColor>No agent has answered yet.</Text>}
        {as.map(([id, a]) => (
          <Box key={id} flexDirection="column" borderStyle="round" borderColor={colorOf(a.model)} paddingX={1}>
            <Text weight="bold" wrap="truncate-end">{a.label}</Text>
            <Text color={colorOf(a.model)}>{a.model}</Text>
            <Text>{`${tokens(a.tokens)} tok · ${a.turns} turn${a.turns === 1 ? '' : 's'} · ${spent ? Math.round((a.tokens / spent) * 100) : 0}%`}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Agents, Limit, Scan } from '../types'

const PANE = 'usage'
const OFF_KEY = 'isOff'
const TTL_MS = 60_000
const WEEK_MS = 7 * 86_400_000

// Every transcript touched this week, usage lines only (subagents live under the same tree). awk keeps one short
// line per message (`timestamp id model tokens`), so the output stays under the 4 MiB the host returns.
const AWK = String.raw`function num(k) { return match($0, "\"" k "\":[0-9]+") ? substr($0, RSTART + length(k) + 3, RLENGTH - length(k) - 3) + 0 : 0 }
{
  ts = match($0, /"timestamp":"[^"]*"/) ? substr($0, RSTART + 13, RLENGTH - 14) : ""
  id = match($0, /"id":"msg_[^"]*"/) ? substr($0, RSTART + 6, RLENGTH - 7) : ""
  mo = match($0, /"model":"[^"]*"/) ? substr($0, RSTART + 9, RLENGTH - 10) : ""
  if (id != "" && mo != "") print ts, id, mo, num("input_tokens") + num("output_tokens") + num("cache_read_input_tokens") + num("cache_creation_input_tokens")
}`
const SCAN_CMD = `find "$HOME/.claude/projects" -name '*.jsonl' -mtime -7 -exec grep -h '"usage":{' {} + 2>/dev/null | awk '${AWK}'; true`

// Powerline-style separator; no background fill, so the band sits on Claude Code's own background.
const SEP = ''
const TITLE = '#00afff'
const MUTED = '#808080'
const GOOD = '#5fd700'

// model-router's per-model colors.
const COLORS: [string, string][] = [
  ['haiku', 'blue'], ['sonnet', 'green'], ['opus', 'magenta'], ['fable', 'yellow'], ['mythos', 'red'],
]
const colorOf = (model: string) => COLORS.find(([k]) => model.includes(k))?.[1] ?? 'gray'

const heat = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : GOOD)

const tokens = (n: number) =>
  n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [] as Limit[])
const scan = atom({ plugin: 'usage-band', key: 'scan' } as const, { at: 0, today: {}, week: {}, isTruncated: false } as Scan)
const agents = atom({ plugin: 'usage-band', key: 'agents' } as const, {} as Agents)
const isOff = atom({ plugin: 'usage-band', key: 'isOff' } as const, false)

const sum = (byModel: Record<string, number>) => Object.values(byModel).reduce((a, b) => a + b, 0)

// ponytail: local day from the clock's local fields; a turn that straddles midnight counts on the day it was written.
const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Read every session's transcript, not this one's: each assistant message's usage, once per message id (the last line wins, it is the complete one).
const scanUsage = async ($: Engine) => {
  const now = await $.clock.now()
  if (now - (await read($, scan)).at < TTL_MS) return
  try {
    const { stdout, isStdoutTruncated } = await $.process.run(['sh', '-c', SCAN_CMD], { timeoutMs: 60_000 })
    const byId = new Map<string, { model: string; n: number; ts: number }>()
    for (const line of stdout.split('\n')) {
      const [timestamp, id, model, n] = line.split(' ')
      if (id) byId.set(id, { model, n: Number(n), ts: Date.parse(timestamp) })
    }
    const today: Record<string, number> = {}
    const week: Record<string, number> = {}
    const day = dayOf(now)
    for (const { model, n, ts } of byId.values()) {
      if (!(now - ts <= WEEK_MS)) continue
      week[model] = (week[model] ?? 0) + n
      if (dayOf(ts) === day) today[model] = (today[model] ?? 0) + n
    }
    await update($, scan, () => ({ at: now, today, week, isTruncated: isStdoutTruncated }))
  } catch {
    // ponytail: a failed scan keeps the last numbers; it retries after the TTL, not on every draw.
    await update($, scan, s => ({ ...s, at: now }))
  }
}

// Give the agents section a box before the first turn finishes.
const seedMain = async ($: Engine) => {
  const model = await $.session.model()
  await update($, agents, a => (a.main ? a : { ...a, main: { label: 'main', model, tokens: 0, turns: 0 } }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage', description: 'Show usage under the prompt (off to hide, pane for the per-model pane)', argumentHint: 'off|pane' })
    const off = Boolean(await $.store.get(OFF_KEY))
    await update($, isOff, () => off)
    await seedMain($)
    const { rateLimits } = await $.session.usage()
    await update($, limits, () => rateLimits)
    await scanUsage($)

    return next(e)
  })

  on('command.run', { command: 'usage' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'pane') {
      await scanUsage($)
      await seedMain($)
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
      await scanUsage($)
    }

    return next(e)
  })

  // A band above the prompt is one tree per instance: stack on whatever the hooks beneath drew (model-router's band).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e).catch(() => undefined) // nothing beneath = nothing to stack on
    if (e.props.hasSurvey || (await read($, isOff))) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    const ls = await read($, limits)
    const s = await read($, scan)
    const five = ls.find(l => l.kind === 'five_hour')
    const week = ls.find(l => l.kind === 'seven_day')
    const pct = (l: typeof five) => (l ? `${l.percentUsed}%` : 'n/a')
    const row = (
      <Button key="usage" label="Usage" onPress={() => $.ui.open({ id: PANE, title: 'Usage' })}>
        <Text weight="bold" color={TITLE}>{' 📊 Usage '}</Text>
        <Text color={MUTED}>{SEP}</Text>
        <Text color={five ? heat(five.percentUsed) : MUTED}>{` Session ${pct(five)} `}</Text>
        <Text color={MUTED}>{SEP}</Text>
        <Text color={GOOD}>{` Today ${tokens(sum(s.today))} tok `}</Text>
        <Text color={MUTED}>{SEP}</Text>
        <Text color={week ? heat(week.percentUsed) : MUTED}>{` Week ${pct(week)} `}</Text>
      </Button>
    )

    return rest ? <Box flexDirection="column">{rest}{row}</Box> : row
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, scan)
    const as = Object.entries(await read($, agents)).sort((x, y) => y[1].tokens - x[1].tokens)
    const spent = as.reduce((t, [, a]) => t + a.tokens, 0)

    const section = (title: string, byModel: Record<string, number>) => {
      const total = sum(byModel)
      const rows = Object.entries(byModel).sort((x, y) => y[1] - x[1])
      return (
        <Box flexDirection="column">
          <Text color={TITLE} weight="bold">{title}</Text>
          {rows.length === 0 && <Text color={MUTED}>No usage.</Text>}
          {rows.map(([model, n]) => {
            const p = (n / total) * 100
            return (
              <Text key={model}>
                <Text color={colorOf(model)} weight="bold">{`${p.toFixed(1).padStart(5)}% `}</Text>
                <Text color={colorOf(model)}>{'█'.repeat(Math.max(1, Math.round(p / 5)))}</Text>
                <Text>{` ${model} `}</Text>
                <Text color={MUTED}>{tokens(n)}</Text>
              </Text>
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {s.isTruncated && <Text color={MUTED}>partial: transcripts cut at 4 MiB</Text>}
        {section('Today · all sessions', s.today)}
        {section('This week · all sessions', s.week)}
        <Text color={TITLE} weight="bold">{'\nAgents · this session'}</Text>
        {as.length === 0 && <Text color={MUTED}>No agent has answered yet.</Text>}
        {as.map(([id, a]) => (
          <Box key={id} flexDirection="column" borderStyle="round" borderColor={colorOf(a.model)} paddingX={1}>
            <Text weight="bold" wrap="truncate-end">{a.label}</Text>
            <Text color={colorOf(a.model)}>{a.model}</Text>
            <Text color={MUTED}>{`${tokens(a.tokens)} tok · ${a.turns} turn${a.turns === 1 ? '' : 's'} · ${spent ? Math.round((a.tokens / spent) * 100) : 0}%`}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}

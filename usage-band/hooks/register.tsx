import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Daily } from '../types'

const PANE = 'usage-by-model'
const STORE_KEY = 'daily'

// Same per-model colors as model-router's TIERS.
const COLORS: [string, string][] = [
  ['haiku', 'blue'], ['sonnet', 'green'], ['opus', 'magenta'], ['fable', 'yellow'], ['mythos', 'red'],
]
const colorOf = (model: string) => COLORS.find(([k]) => model.includes(k))?.[1] ?? 'gray'

// ponytail: UTC day, not local; shift by the offset if the rollover hour matters.
const today = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const tokens = (n: number) =>
  n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [])
const daily = atom({ plugin: 'usage-band', key: 'daily' } as const, { date: '', byModel: {} } as Daily)

const total = (d: Daily) => Object.values(d.byModel).reduce((a, b) => a + b, 0)

// The status line is plain text pinned under the prompt, so the band above stays model-router's.
const show = async ($: Engine) => {
  const ls = await read($, limits)
  const pct = (kind: string) => {
    const l = ls.find(x => x.kind === kind)
    return l ? `${l.percentUsed}%` : 'n/a'
  }
  $.ui.status(`📊 Session ${pct('five_hour')} · Today ${tokens(total(await read($, daily)))} tok · Week ${pct('seven_day')}  (/usage)`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage', description: 'Show token usage per model today in a pane' })
    const stored = (await $.store.get(STORE_KEY)) as Daily | undefined
    const date = today(await $.clock.now())
    await update($, daily, () => (stored?.date === date ? stored : { date, byModel: {} }))
    const { rateLimits } = await $.session.usage()
    await update($, limits, () => rateLimits)
    await show($)

    return next(e)
  })

  on('command.run', { command: 'usage' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Usage by model' })

    return { text: 'Usage pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits)
      await show($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage) {
      const u = e.usage
      const n = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const date = today(await $.clock.now())
      const prev = await read($, daily)
      const base = prev.date === date ? prev.byModel : {}
      const updated: Daily = { date, byModel: { ...base, [u.model]: (base[u.model] ?? 0) + n } }
      await update($, daily, () => updated)
      // ponytail: read-modify-write across concurrent sessions can drop a turn; fine for a gauge.
      await $.store.set(STORE_KEY, updated)
      await show($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const d = await read($, daily)
    const sum = total(d)
    const rows = Object.entries(d.byModel).sort((a, b) => b[1] - a[1])

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
      </Box>
    )
  })
}

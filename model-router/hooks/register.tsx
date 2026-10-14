import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { Mode, Tier } from '../types'

// $ per million tokens; cache writes bill at 1.25x input.
const TIERS = {
  simple: { model: 'claude-haiku-5-5', color: 'blue', input: 0.1, output: 0.5, cacheRead: 0.01 },
  standard: { model: 'claude-sonnet-5-5', color: 'green', input: 2, output: 10, cacheRead: 0.2 },
  complex: { model: 'claude-opus-5-5', color: 'magenta', input: 4, output: 20, cacheRead: 0.2 },
} as const

const LABELS = ['simple', 'standard', 'complex'] as const

const GUIDE = `Rate the complexity of the coding task below.
simple: file renames, git commits, one-line edits, quick lookups or questions.
standard: building a feature, refactoring, writing tests, typical bug fixes.
complex: system architecture, deep or cross-cutting debugging, logic spanning many files.

Task:
`

const route = atom({ plugin: 'model-router', key: 'route' } as const, {
  tier: 'standard' as Tier,
  isClassifying: false,
})
const totals = atom({ plugin: 'model-router', key: 'totals' } as const, {
  tokens: 0,
  cost: 0,
  baseline: 0,
})

const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto' as Mode)

const ALIASES: Record<string, Mode> = {
  on: 'auto', auto: 'auto', off: 'off',
  haiku: 'simple', simple: 'simple',
  sonnet: 'standard', standard: 'standard',
  opus: 'complex', complex: 'complex',
}
const USAGE = 'Usage: /route [on|off|auto|haiku|sonnet|opus|status]'

const describe = (m: Mode) =>
  m === 'auto' ? 'Router on: routing each prompt by complexity.'
  : m === 'off' ? 'Router off: using the session model.'
  : `Router locked to ${TIERS[m].model}.`

const isTier = (label: string | undefined): label is Tier =>
  LABELS.some(l => l === label)

const costOf = (usage: TurnUsage, p: (typeof TIERS)[Tier]) =>
  (usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    usage.cache_read_input_tokens * p.cacheRead +
    usage.cache_creation_input_tokens * p.input * 1.25) /
  1e6

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`

const tokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Turn model routing on or off, or force Haiku, Sonnet or Opus',
      argumentHint: 'on|off|auto|haiku|sonnet|opus',
    })

    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, mode)
    if (arg === 'status') return { text: describe(current) }

    const next: Mode | undefined = arg === '' ? (current === 'off' ? 'auto' : 'off') : ALIASES[arg]
    if (next === undefined) return { text: USAGE }

    await update($, mode, () => next)

    return { text: describe(next) }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !e.text.trim() || (await read($, mode)) !== 'auto') {
      return next(e)
    }

    await update($, route, r => ({ ...r, isClassifying: true }))
    let tier: Tier = 'standard'
    try {
      const label = await $.model.classify(GUIDE + e.text, LABELS, { model: 'haiku' })
      if (isTier(label)) tier = label
    } catch {
      // ponytail: classifier down → Sonnet; the classify call's own tokens are not counted.
    }
    await update($, route, () => ({ tier, isClassifying: false }))

    return next(e)
  }).catch(($, e, next) => next(e)) // never block a prompt because the router failed

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    const m = await read($, mode)
    if (m === 'off') {
      return yield* next(e)
    }
    const { tier } = await read($, route)

    return yield* next({ ...e, model: TIERS[m === 'auto' ? tier : m].model })
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.usage) {
      const usage = e.usage
      const price = Object.values(TIERS).find(p => p.model === usage.model)
      await update($, totals, t => ({
        tokens: t.tokens + usage.input_tokens + usage.output_tokens +
          usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        cost: t.cost + (price ? costOf(usage, price) : 0),
        baseline: t.baseline + costOf(usage, TIERS.complex),
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const m = await read($, mode)
    const { tier, isClassifying } = await read($, route)
    const t = await read($, totals)
    const { Text } = $.ui.resolve(e)
    const { model, color } =
      m === 'off'
        ? { model: await $.session.model(), color: undefined }
        : TIERS[m === 'auto' ? tier : m]
    const label = m === 'auto' ? 'Active' : m === 'off' ? 'Off' : 'Locked'
    const detail = isClassifying
      ? ' · classifying…'
      : t.tokens > 0
        ? ` · ${tokens(t.tokens)} tok · ${money(t.cost)} · saved ${money(t.baseline - t.cost)} vs Opus`
        : ''

    return (
      <Text wrap="truncate-end" dimColor={m === 'off'}>
        🤖 [Router {label}] -&gt; [Current Model: <Text color={color} weight="bold">{model}</Text>]
        <Text dimColor>{detail}</Text>
      </Text>
    )
  })
}

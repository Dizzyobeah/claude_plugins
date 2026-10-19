import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, TurnUsage } from 'claude-code'

import type { Effort, Mode, Tier } from '../types'

// $ per million tokens; cache writes bill at 1.25x input. Effort is the default
// per tier; automatic routing never picks xhigh or max (see /route effort).
// Opus 5.5's own default is medium, and the docs say it beats Opus 5 at high on coding.
const TIERS = {
  simple: { model: 'claude-haiku-5-5', color: 'blue', effort: 'low', input: 0.1, output: 0.5, cacheRead: 0.01 },
  standard: { model: 'claude-sonnet-5-5', color: 'green', effort: 'medium', input: 2, output: 10, cacheRead: 0.2 },
  complex: { model: 'claude-opus-5-5', color: 'magenta', effort: 'medium', input: 4, output: 20, cacheRead: 0.2 },
  // Fable and Mythos: manual only (/route fable|mythos), 2.5x Opus price, double confirmation.
  // The classifier never picks them (not in LABELS). Mythos 5.1 needs Project Glasswing access.
  frontier: { model: 'claude-fable-5-1', color: 'yellow', effort: 'medium', input: 10, output: 50, cacheRead: 0.25 },
  mythos: { model: 'claude-mythos-5-1', color: 'red', effort: 'medium', input: 10, output: 50, cacheRead: 0.25 },
} as const

// Powerlevel10k-style band: dark segments, thin arrows between, a solid arrow to close (needs a Nerd/Powerline font).
const BG = '#303030'
const SEP = '\ue0b1'
const CAP = '\ue0b0'

const LABELS = ['simple', 'standard', 'complex'] as const
const ANSWER_TAIL = 500 // characters of Claude's last message the classifier sees
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const GUIDE = `Rate the complexity of the coding task below.
simple: file renames, git commits, one-line edits, quick lookups or questions.
standard: building a feature, refactoring, writing tests, typical bug fixes.
complex: system architecture, deep or cross-cutting debugging, logic spanning many files.
`
// Offered only once Claude has said something: an answer to it keeps the task's route.
const REPLY = `reply: answers or approves the assistant's last message and continues its task (yes, go ahead, option B, use the second one). A new request, however short, gets its own tier.
`

const route = atom({ plugin: 'model-router', key: 'route' } as const, {
  tier: 'standard' as Tier,
  isClassifying: false,
  lastAnswer: '',
})
const totals = atom({ plugin: 'model-router', key: 'totals' } as const, {
  tokens: 0,
  cost: 0,
  baseline: 0,
})

const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto' as Mode)
const effortOverride = atom({ plugin: 'model-router', key: 'effortOverride' } as const, null as Effort | null)

const ALIASES: Record<string, Mode> = {
  on: 'auto', auto: 'auto', off: 'off',
  haiku: 'simple', simple: 'simple',
  sonnet: 'standard', standard: 'standard',
  opus: 'complex', complex: 'complex',
  fable: 'frontier', frontier: 'frontier', mythos: 'mythos',
}
const USAGE = 'Usage: /route [on|off|auto|haiku|sonnet|opus|fable|mythos|status|effort <low|medium|high|xhigh|max|default>]'
const YES = 'Yes, use it'
const GATED = ['frontier', 'mythos'] as const // models that need a double confirmation

const describe = (m: Mode) =>
  m === 'auto' ? 'Router on: routing each prompt by complexity.'
  : m === 'off' ? 'Router off: using the session model.'
  : `Router locked to ${TIERS[m].model}.`

const isTier = (label: string | undefined): label is Tier =>
  LABELS.some(l => l === label)

const isEffort = (s: string): s is Effort => EFFORTS.some(l => l === s)

// The user's /route effort choice wins; otherwise the tier's default.
const effortFor = (tier: Tier, override: Effort | null) => override ?? TIERS[tier].effort

const costOf = (usage: TurnUsage, p: (typeof TIERS)[Tier]) =>
  (usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    usage.cache_read_input_tokens * p.cacheRead +
    usage.cache_creation_input_tokens * p.input * 1.25) /
  1e6

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`

const tokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`)

// $.state starts over on /clear, /resume and /branch, so the /route choices live in $.store and load from both
// session.start and classic.SessionStart. A Fable or Mythos lock loads as auto: it needs its two yeses again.
const load = async ($: Engine) => {
  const m = (await $.store.get('mode')) as Mode | undefined
  const o = (await $.store.get('effortOverride')) as Effort | null | undefined
  await update($, mode, () => (m === undefined || GATED.some(g => g === m) ? 'auto' : m))
  await update($, effortOverride, () => o ?? null)
}

const setMode = async ($: Engine, m: Mode) => {
  await update($, mode, () => m)
  await $.store.set('mode', m)
}

const setEffort = async ($: Engine, o: Effort | null) => {
  await update($, effortOverride, () => o)
  await $.store.set('effortOverride', o)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Turn model routing on or off, force Haiku, Sonnet, Opus, Fable or Mythos, or set effort',
      argumentHint: 'on|off|auto|haiku|sonnet|opus|fable|mythos|effort <level>',
    })
    await load($)

    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failed load never holds up the session

  on('command.run', { command: 'route' }, async ($, e) => {
    const yes = (question: string) =>
      $.ui.ask(question, [YES, 'No']).then(a => a === YES, () => false) // dismissed or headless = no
    const arg = e.args.trim().toLowerCase()
    const current = await read($, mode)
    if (arg === 'status') return { text: describe(current) }

    if (arg === 'effort' || arg.startsWith('effort ')) {
      const level = arg.slice('effort'.length).trim()
      if (level === '' || level === 'default') {
        await setEffort($, null)
        return { text: 'Effort back to each tier\'s default.' }
      }
      if (!isEffort(level)) return { text: USAGE }
      // xhigh and max cost far more tokens, so they need an explicit yes each time.
      if (level === 'xhigh' || level === 'max') {
        if (!(await yes(`Use ${level} effort for every routed turn? It burns tokens fast.`))) {
          return { text: `Effort unchanged (${level} not approved).` }
        }
      }
      await setEffort($, level)
      return { text: `Effort set to ${level} for routed turns.` }
    }

    const next: Mode | undefined = arg === '' ? (current === 'off' ? 'auto' : 'off') : ALIASES[arg]
    if (next === undefined) return { text: USAGE }

    // Fable and Mythos are 2.5x Opus: two separate yeses, and any other answer leaves the route alone.
    if (GATED.some(g => g === next) && next !== current) {
      const { model, input, output } = TIERS[next as (typeof GATED)[number]]
      const price = `$${input}/$${output} per MTok`
      if (
        !(await yes(`Lock every turn to ${model} (${price}, 2.5x Opus)?`)) ||
        !(await yes(`Really? Every turn bills at ${price} until you run /route auto.`))
      ) {
        return { text: `Router unchanged (${model} not approved).` }
      }
    }

    await setMode($, next)

    return { text: describe(next) }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !e.text.trim() || (await read($, mode)) !== 'auto') {
      return next(e)
    }

    // With Claude's last message in view, "yes" or "option B" reads as a reply and keeps the task's route,
    // while "rename foo.txt" is a new task and gets its own tier.
    const { tier: current, lastAnswer } = await read($, route)
    await update($, route, r => ({ ...r, isClassifying: true }))
    let tier: Tier = 'standard'
    try {
      const label = lastAnswer
        ? await $.model.classify(
            `${GUIDE}${REPLY}\nAssistant's last message (end):\n${lastAnswer}\n\nUser's message:\n${e.text}`,
            [...LABELS, 'reply'],
            { model: 'haiku' },
          )
        : await $.model.classify(`${GUIDE}\nTask:\n${e.text}`, LABELS, { model: 'haiku' })
      if (label === 'reply') tier = current
      else if (isTier(label)) tier = label
    } catch {
      // ponytail: classifier down → Sonnet; the classify call's own tokens are not counted.
    } finally {
      await update($, route, r => ({ ...r, tier, isClassifying: false }))
    }

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
    const routed = m === 'auto' ? tier : m
    const effort = effortFor(routed, await read($, effortOverride))

    return yield* next({ ...e, model: TIERS[routed].model, effort })
  })

  on('turn.complete', async ($, e, next) => {
    // An empty answer (interrupted, thinking only) keeps the previous one.
    if (e.agentId === undefined && e.answer) {
      const lastAnswer = e.answer.slice(-ANSWER_TAIL)
      await update($, route, r => ({ ...r, lastAnswer }))
    }
    if (e.agentId === undefined && e.usage) {
      const usage = e.usage
      const price = Object.values(TIERS).find(p => p.model === usage.model)
      await update($, totals, t => ({
        tokens: t.tokens + usage.input_tokens + usage.output_tokens +
          usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        // A model with no price here (the session's own, a [1m] variant) saves nothing.
        cost: t.cost + (price ? costOf(usage, price) : 0),
        baseline: t.baseline + (price ? costOf(usage, TIERS.complex) : 0),
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    // One band tree per instance: stack on what the hooks beneath drew (e.g. usage-band).
    const rest = await next(e)

    const m = await read($, mode)
    const { tier, isClassifying } = await read($, route)
    const t = await read($, totals)
    const { Box, Text } = $.ui.resolve(e)
    const { model, color } =
      m === 'off'
        ? { model: await $.session.model(), color: undefined }
        : TIERS[m === 'auto' ? tier : m]
    const effort = m === 'off' ? undefined : effortFor(m === 'auto' ? tier : m, await read($, effortOverride))
    const label = m === 'auto' ? 'Active' : m === 'off' ? 'Off' : 'Locked'
    // Always shown; before the first turn the totals are zero.
    const detail = isClassifying
      ? 'classifying…'
      : `${tokens(t.tokens)} tok · ${money(t.cost)} · saved ${money(t.baseline - t.cost)} vs Opus`

    const dim = m === 'off'
    // Powerline glyphs and a dark fill suit a terminal; the desktop gets plain separators and its theme's colours.
    const isTerminal = e.surface === 'terminal'
    const sep = isTerminal ? SEP : '·'
    const bg = isTerminal ? BG : undefined
    const [title, muted, soft, good] = isTerminal ? ['#00afff', '#808080', '#a8a8a8', '#5fd700'] : ['suggestion', 'subtle', 'inactive', 'success']

    // ponytail: one flat run of segments; add a segment by adding a <Text> and a sep.
    const row = (
      <Text wrap="truncate-end" dimColor={dim}>
        <Text backgroundColor={bg} color={title} bold>{` 🤖 Router ${label} `}</Text>
        <Text backgroundColor={bg} color={muted}>{sep}</Text>
        <Text backgroundColor={bg}> </Text>
        <Text backgroundColor={bg} color={color} bold>{model}</Text>
        {effort && <Text backgroundColor={bg} color={soft}>{` · effort ${effort}`}</Text>}
        <Text backgroundColor={bg}> </Text>
        <Text backgroundColor={bg} color={muted}>{sep}</Text>
        <Text backgroundColor={bg} color={good}>{` ${detail} `}</Text>
        {isTerminal && <Text color={BG}>{CAP}</Text>}
      </Text>
    )

    return rest ? <Box flexDirection="column">{rest}{row}</Box> : row
  })
}

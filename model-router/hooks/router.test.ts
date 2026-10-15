import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'model-router',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { bodyRows: 10, offset: 0, contentRows: 1 },
    view: {},
  },
} as const

const bandText = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const text = (await ui.find({ type: 'Text', text: /Router/ }))?.text
  await ui.unmount()
  return text
}

const calls = { classify: 0 }
const efforts: unknown[] = []

const engine = (on: On, classify: () => string | undefined | Promise<never>) => {
  const seen: string[] = []
  calls.classify = 0
  efforts.length = 0
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('classic.SessionStart', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] })) // the engine's own band: empty
  on('model.classify', async () => {
    calls.classify += 1
    return { value: await classify() }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.step', async function* ($, e) {
    seen.push(e.model)
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  return seen
}

// Answer every AskUserQuestion dialog from `answers`, in order; no answers left = dismissed.
const answerAsks = (on: On, answers: string[]) => {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    const answer = answers.shift()
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [question]: answer } }, text: answer }
  })
  return asked
}

const submit = ($: Engine, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const route = ($: Engine, args = '') => $.command.run({
    command: 'route',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

const step = async ($: Engine) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  for await (const _ of stream) {
  }
}

describe('model-router', () => {
  test('a complex prompt routes to Opus and the band says so', async ($, on) => {
    const seen = engine(on, () => 'complex')
    await submit($, 'Redesign the auth architecture across all services')
    await step($)
    expect(seen).toEqual(['claude-opus-5-5'])
    expect(await bandText($)).toContain('claude-opus-5-5')
  })

  test('a simple prompt routes to Haiku', async ($, on) => {
    const seen = engine(on, () => 'simple')
    await submit($, 'rename foo.txt to bar.txt')
    await step($)
    expect(seen).toEqual(['claude-haiku-5-5'])
  })

  test('a failed classification falls back to Sonnet', async ($, on) => {
    const seen = engine(on, () => Promise.reject(new Error('down')))
    await submit($, 'add a settings page')
    await step($)
    expect(seen).toEqual(['claude-sonnet-5-5'])
  })

  test('the band shows cost and savings after a turn', async ($, on) => {
    engine(on, () => 'standard')
    await submit($, 'add a settings page')
    await $.turn.complete({
      turnId: 't1',
      reason: 'answer',
      answer: 'done',
      durationMs: 1000,
      isAborted: false,
      usage: {
        model: 'claude-sonnet-5-5',
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })
    // Sonnet $2 vs Opus $4 for 1M input tokens.
    expect(await bandText($)).toContain('1000.0k tok · $2.00 · saved $2.00 vs Opus')
  })

  test('/route toggles routing off and on', async ($, on) => {
    engine(on, () => 'simple')
    expect((await route($)).text).toContain('Router off')
    expect(await bandText($)).toContain('Router Off')
    expect((await route($)).text).toContain('Router on')
    expect(await bandText($)).toContain('Router Active')
  })

  test('with routing off nothing is classified and the session model runs', async ($, on) => {
    const seen = engine(on, () => 'simple')
    await route($, 'off')
    await submit($, 'rename foo.txt to bar.txt')
    await step($)
    expect(calls.classify).toBe(0)
    expect(seen).toEqual(['claude-sonnet-5-5'])
    expect(await bandText($)).toContain('claude-opus-5-5')
  })

  test('/route haiku locks the model without classifying', async ($, on) => {
    const seen = engine(on, () => 'complex')
    await route($, 'haiku')
    await submit($, 'Redesign the auth architecture across all services')
    await step($)
    expect(calls.classify).toBe(0)
    expect(seen).toEqual(['claude-haiku-5-5'])
    expect(await bandText($)).toContain('Router Locked')
    await route($, 'auto')
    await submit($, 'Redesign the auth architecture across all services')
    await step($)
    expect(seen).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
  })

  test('each tier sends its default effort', async ($, on) => {
    engine(on, () => 'simple')
    await submit($, 'rename foo.txt to bar.txt')
    await step($)
    expect(efforts).toEqual(['low'])
    await route($, 'opus')
    await step($)
    expect(efforts).toEqual(['low', 'medium'])
  })

  test('xhigh and max need approval; a refusal changes nothing', async ($, on) => {
    engine(on, () => 'standard')
    expect((await route($, 'effort max')).text).toContain('unchanged')
    await submit($, 'add a settings page')
    await step($)
    expect(efforts).toEqual(['medium'])
  })

  test('/route effort sets a level for routed turns, default clears it', async ($, on) => {
    engine(on, () => 'standard')
    expect((await route($, 'effort low')).text).toContain('Effort set to low')
    await submit($, 'add a settings page')
    await step($)
    expect(efforts).toEqual(['low'])
    expect((await route($, 'effort default')).text).toContain('each tier')
    await submit($, 'add a settings page')
    await step($)
    expect(efforts).toEqual(['low', 'medium'])
  })

  test('with routing off the session effort runs untouched', async ($, on) => {
    engine(on, () => 'simple')
    await route($, 'effort low')
    await route($, 'off')
    await submit($, 'rename foo.txt to bar.txt')
    await step($)
    expect(efforts).toEqual([undefined])
  })

  test('/route fable locks to Fable after two yeses; the classifier can never pick it', async ($, on) => {
    const seen = engine(on, () => 'frontier')
    const asked = answerAsks(on, ['Yes, use it', 'Yes, use it'])
    await submit($, 'Redesign the auth architecture across all services')
    await step($)
    expect(seen).toEqual(['claude-sonnet-5-5'])
    expect((await route($, 'fable')).text).toContain('locked to claude-fable-5-1')
    expect(asked).toHaveLength(2)
    await submit($, 'rename foo.txt to bar.txt')
    await step($)
    expect(calls.classify).toBe(1)
    expect(seen).toEqual(['claude-sonnet-5-5', 'claude-fable-5-1'])
    expect(efforts).toEqual(['medium', 'medium'])
    expect(await bandText($)).toContain('claude-fable-5-1')
  })

  test('Fable and Mythos stay off unless both confirmations are yes', async ($, on) => {
    const seen = engine(on, () => 'standard')
    const asked = answerAsks(on, ['Yes, use it', 'No', 'No', 'Yes, use it'])
    expect((await route($, 'fable')).text).toContain('unchanged') // second ask refused
    expect((await route($, 'mythos')).text).toContain('unchanged') // first ask refused
    expect(asked).toHaveLength(3)
    await route($, 'mythos') // both asks dismissed
    await submit($, 'add a settings page')
    await step($)
    expect(seen).toEqual(['claude-sonnet-5-5'])
  })

  test('/route mythos locks to Mythos after two yeses', async ($, on) => {
    const seen = engine(on, () => 'standard')
    answerAsks(on, ['Yes, use it', 'Yes, use it'])
    expect((await route($, 'mythos')).text).toContain('locked to claude-mythos-5-1')
    await step($)
    expect(seen).toEqual(['claude-mythos-5-1'])
  })

  test('a bad /route argument changes nothing', async ($, on) => {
    engine(on, () => 'simple')
    await route($, 'opus')
    expect((await route($, 'banana')).text).toContain('Usage')
    expect((await route($, 'status')).text).toContain('claude-opus-5-5')
  })

  test('/route off and the effort survive /clear', async ($, on) => {
    const seen = engine(on, () => 'simple')
    await route($, 'off')
    await route($, 'effort low')
    await $.classic.SessionStart({ source: 'clear' })
    expect((await route($, 'status')).text).toContain('Router off')
    await route($, 'auto')
    await submit($, 'rename foo.txt to bar.txt')
    await step($)
    expect(seen).toEqual(['claude-haiku-5-5'])
    expect(efforts).toEqual(['low'])
  })

  test('a Mythos lock loads back as auto, never skipping its confirmations', async ($, on) => {
    engine(on, () => 'standard')
    answerAsks(on, ['Yes, use it', 'Yes, use it'])
    await route($, 'mythos')
    await $.classic.SessionStart({ source: 'resume' })
    expect((await route($, 'status')).text).toContain('Router on')
  })

  test('a turn on an unpriced model claims no savings', async ($, on) => {
    engine(on, () => 'standard')
    await route($, 'off')
    await $.turn.complete({
      turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false,
      usage: { model: 'claude-opus-5-5[1m]', input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })
    expect(await bandText($)).toContain('saved $0.0000 vs Opus')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the band draws on ${surface}`, async ($, on) => {
      engine(on, () => 'standard')
      expect(await bandText($, surface)).toContain('Router Active')
    })
  }

  test('on desktop the band has no dark fill and uses theme colours', async ($, on) => {
    engine(on, () => 'standard')
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const title = await ui.find({ type: 'Text', text: /^ 🤖 Router Active $/ })
    expect(title?.props?.backgroundColor).toBeUndefined()
    expect(title?.props?.color).toBe('suggestion')
    await ui.unmount()
  })
})

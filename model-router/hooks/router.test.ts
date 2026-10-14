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

const bandText = async ($: Engine) => {
  const ui = await $.ui.mount(BAND)
  const text = (await ui.find({ type: 'Text', text: /Router/ }))?.text
  await ui.unmount()
  return text
}

const calls = { classify: 0 }

const engine = (on: On, classify: () => string | undefined | Promise<never>) => {
  const seen: string[] = []
  calls.classify = 0
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('model.classify', async () => {
    calls.classify += 1
    return { value: await classify() }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.step', async function* ($, e) {
    seen.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  return seen
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

  test('a bad /route argument changes nothing', async ($, on) => {
    engine(on, () => 'simple')
    await route($, 'opus')
    expect((await route($, 'banana')).text).toContain('Usage')
    expect((await route($, 'status')).text).toContain('claude-opus-5-5')
  })
})

import { describe, expect, test } from 'claude-code/testing'

describe('usage-band', () => {
  test('/usage opens the pane', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('store.get', () => ({ value: undefined }))
    on('clock.now', () => ({ value: Date.now() }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    const r = await $.command.run({
      command: 'usage',
      args: 'pane',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(r.text).toMatch(/pane opened/)
  })

  test('/usage alone turns the line on and opens no pane', async ($, on) => {
    on('ui.open', () => { throw new Error('opened') })
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
    const r = await $.command.run({
      command: 'usage',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(r.text).toBe('Usage line on.')
  })

  test('the band stacks on the tree beneath it instead of replacing it', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['Router band'] }))
    const ui = await $.ui.mount({
      plugin: 'usage-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { bodyRows: 10, offset: 0, contentRows: 2 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Router band/ })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Usage/ }))?.props?.backgroundColor).toBe('#303030')
    expect(await ui.find({ type: 'Text', text: /Session/ })).toBeTruthy()
    await ui.unmount()
  })

  test('the pane draws the agent section', async $ => {
    const ui = await $.ui.mount({
      plugin: 'usage-band',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'usage',
      props: { bodyColumns: 80, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Agents/ })).toBeTruthy()
    await ui.unmount()
  })

  test("a turn keeps other sessions' models in the pane", async ($, on) => {
    const day = new Date().toISOString().slice(0, 10)
    const sets: unknown[] = []
    on('store.get', () => ({ value: { date: day, byModel: { 'claude-haiku-5-5': 100 } } }))
    on('store.set', (_$, e) => { sets.push(e.value); return { value: undefined } })
    on('turn.complete', () => ({ text: '' }))
    on('clock.now', () => ({ value: Date.now() }))
    await $.turn.complete({
      turnId: 't1',
      reason: 'answer',
      answer: 'done',
      durationMs: 1,
      isAborted: false,
      usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })
    expect(sets).toContainEqual({ date: day, byModel: { 'claude-haiku-5-5': 100, 'claude-opus-5-5': 15 } })
  })
})

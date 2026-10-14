import { describe, expect, test } from 'claude-code/testing'

describe('usage-band', () => {
  test('/usage opens the pane', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
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
    expect(await ui.find({ type: 'Text', text: /Session/ })).toBeTruthy()
    await ui.unmount()
  })
})

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.now()
// One line as the scan's awk prints it: `timestamp id model tokens`.
const line = (id: string, model: string, n: number, ago = 0) => `${new Date(NOW - ago).toISOString()} ${id} ${model} ${n}`

// Stubs for the engine's host calls; `stdout` is what the scan command prints.
const host = (on: On, stdout: string, isOpenStubbed = true) => {
  on('clock.now', () => ({ value: NOW }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  if (isOpenStubbed) on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } }))
}

const BAND = {
  plugin: 'usage-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { bodyRows: 10, offset: 0, contentRows: 2 }, view: {} },
} as const

describe('usage-band', () => {
  test('/usage pane opens the pane', async ($, on) => {
    host(on, '')
    const r = await $.command.run({ command: 'usage', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(r.text).toMatch(/pane opened/)
  })

  test('/usage alone turns the line on and opens no pane', async ($, on) => {
    host(on, '', false)
    on('ui.open', () => { throw new Error('opened') })
    const r = await $.command.run({ command: 'usage', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(r.text).toBe('Usage line on.')
  })

  test('the band stacks on the tree beneath it and has no fill of its own', async ($, on) => {
    host(on, '')
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['Router band'] }))
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: /Router band/ })).toBeTruthy()
    const usage = await ui.find({ type: 'Text', text: /Usage/ })
    expect(usage).toBeTruthy()
    expect(usage?.props?.backgroundColor).toBeUndefined()
    await ui.unmount()
  })

  test('the pane lists every model in the transcripts, once per message id', async ($, on) => {
    host(on, [
      line('m1', 'claude-haiku-5-5', 100),
      line('m1', 'claude-haiku-5-5', 900), // same message, streamed again: the last line counts once
      line('m2', 'claude-opus-5-5', 500),
      line('m3', 'claude-sonnet-5-5', 50, 3 * 86_400_000), // this week, not today
      line('m4', 'claude-sonnet-5-5', 10, 30 * 86_400_000), // older than a week: left out
    ].join('\n'))
    await $.command.run({ command: 'usage', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'Pane', requestId: 'usage', props: { bodyColumns: 80, view: {} } })
    expect(await ui.find({ type: 'Text', text: /claude-haiku-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /claude-opus-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /claude-sonnet-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /claude-opus-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^900$/ })).toBeTruthy() // m1 counted once, its last line
    expect(await ui.find({ type: 'Text', text: /^1000$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Agents/ })).toBeTruthy()
    await ui.unmount()
  })
})

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.now()
// One line as the scan's awk prints it: `timestamp id model tokens`.
const line = (id: string, model: string, n: number, ago = 0) => `${new Date(NOW - ago).toISOString()} ${id} ${model} ${n}`

// Stubs for the engine's host calls; `stdout` is what the scan command prints.
const host = (on: On, stdout: string, isOpenStubbed = true) => {
  on('clock.now', () => ({ value: NOW }))
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  if (isOpenStubbed) on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.after', () => ({ value: undefined }))
  on('classic.SessionStart', () => ({}))
  on('process.run', () => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

const BAND = {
  plugin: 'usage-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { bodyRows: 10, offset: 0, contentRows: 2 }, view: {} },
} as const

describe('usage-band', () => {
  test('/usage-band pane opens the pane', async ($, on) => {
    host(on, '')
    const r = await $.command.run({ command: 'usage-band', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(r.text).toMatch(/pane opened/)
  })

  test('/usage-band alone turns the line on and opens no pane', async ($, on) => {
    host(on, '', false)
    on('ui.open', () => { throw new Error('opened') })
    const r = await $.command.run({ command: 'usage-band', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
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
    await $.command.run({ command: 'usage-band', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'Pane', requestId: 'usage', props: { title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 20, offset: 0 }, view: {} } })
    expect(await ui.find({ type: 'Text', text: /claude-haiku-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /claude-opus-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /claude-sonnet-5-5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^900$/ })).toBeTruthy() // m1 counted once, its last line
    expect(await ui.find({ type: 'Text', text: /^1000$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Agents/ })).toBeTruthy()
    await ui.unmount()
  })

  test('/usage-band off still hides the band after /clear resets $.state', async ($, on) => {
    host(on, '')
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] })) // the engine's own band: empty
    await $.command.run({ command: 'usage-band', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await $.classic.SessionStart({ source: 'clear' })
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: /Usage/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the band steps aside for a survey', async ($, on) => {
    host(on, '')
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] })) // the engine's own band: empty
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Text', text: /Usage/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the band draws a plain separator off the terminal', async ($, on) => {
    host(on, '')
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] })) // the engine's own band: empty
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^·$/ })).toBeTruthy()
    await ui.unmount()
  })

  test('the pane fills with the terminal-matching background', async ($, on) => {
    host(on, '')
    await $.command.run({ command: 'usage-band', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'Pane', requestId: 'usage', props: { title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 20, offset: 0 }, view: {} } })
    const drawn = await ui.drawn()
    const box = drawn.type === 'Box' ? (drawn.props as { backgroundColor?: string; height?: number }) : {}
    expect(box.backgroundColor).toBe('#1b1d1e')
    expect(box.height).toBe(20)
    await ui.unmount()
  })

  test('session.start registers /usage-band, not the built-in /usage', async ($, on) => {
    host(on, '')
    const names: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => { names.push(e.name); return { value: undefined as never } })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(names).toEqual(['usage-band'])
  })

  test('an inline pane is only as tall as its content', async ($, on) => {
    host(on, '')
    await $.command.run({ command: 'usage-band', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'Pane', requestId: 'usage', props: { title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20, offset: 0 }, view: {} } })
    const drawn = await ui.drawn()
    expect(drawn.type === 'Box' && (drawn.props as { height?: number }).height).toBeUndefined()
    await ui.unmount()
  })

  test('on desktop the band and pane follow the app theme, with no terminal fill', async ($, on) => {
    host(on, line('m1', 'claude-opus-5-5', 500))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] })) // the engine's own band: empty
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await band.find({ type: 'Text', text: /Usage/ }))?.props?.color).toBe('suggestion')
    await band.unmount()
    await $.command.run({ command: 'usage-band', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const pane = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'Pane', requestId: 'usage', props: { title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 20, offset: 0 }, view: {} } })
    const drawn = await pane.drawn()
    const box = drawn.type === 'Box' ? (drawn.props as { backgroundColor?: string; height?: number }) : {}
    expect(box.backgroundColor).toBeUndefined()
    expect(box.height).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /claude-opus-5-5/ })).toBeTruthy()
    await pane.unmount()
  })
})

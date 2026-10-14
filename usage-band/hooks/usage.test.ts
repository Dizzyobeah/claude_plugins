import { describe, expect, test } from 'claude-code/testing'

describe('usage-band', () => {
  test('/usage opens the pane', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const r = await $.command.run({
      command: 'usage',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(r.text).toMatch(/pane opened/)
  })
})

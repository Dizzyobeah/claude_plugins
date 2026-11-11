import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const V = '/v'
const NOW = new Date(2026, 10, 11, 9, 30).getTime()
const OPTS = { options: { vault_path: V, index_script: '' } }

// In-memory fs + store; `reply` is what the summary fork answers.
const host = (on: On, reply: string, id = 's1') => {
  const files = new Map<string, string>()
  const store = new Map<string, unknown>()
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('clock.now', () => ({ value: NOW }))
  on('session.id', () => ({ value: id }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: reply, usage: {} } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return files
}

const REPLY = '## Log\n- did a thing\n\n## Key Decisions\n- chose X because Y\n\n## Open Questions\n- none\n'

describe('vault', () => {
  test('start creates one note and one daily link; same id reuses it', { ...OPTS }, async ($, on) => {
    const files = host(on, REPLY)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    const notes = [...files.keys()].filter(k => k.startsWith(`${V}/sessions/`))
    expect(notes.length).toBe(1)
    const daily = files.get(`${V}/daily/2026-11-11.md`) ?? ''
    expect(daily.match(/\[\[2026-11-11-0930-app\|app\]\]/g)?.length).toBe(1)
    expect(daily.indexOf('## Sessions')).toBeLessThan(daily.indexOf('2026-11-11-0930-app'))
    expect(daily.indexOf('2026-11-11-0930-app')).toBeLessThan(daily.indexOf('## Key Decisions'))
  })

  test('end fills sections, archives, rolls decisions into daily', { ...OPTS }, async ($, on) => {
    const files = host(on, REPLY)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ reason: 'answer', answer: 'done' } as never)
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
    const note = files.get(`${V}/sessions/2026-11-11-0930-app.md`) ?? ''
    expect(note).toMatch(/status: archived/)
    expect(note).toMatch(/## Log\n- did a thing/)
    expect(note).toMatch(/## Key Decisions\n- chose X because Y/)
    expect(note).not.toMatch(/none/)
    expect(files.get(`${V}/daily/2026-11-11.md`)).toMatch(/- chose X because Y \(\[\[2026-11-11-0930-app\]\]\)/)
  })
})

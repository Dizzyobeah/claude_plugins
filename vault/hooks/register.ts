import type { EngineInterface as Engine, Register } from 'claude-code'

type Info = { project: string; repo: string; root: string; branch: string; isGit: boolean; type: 'session' | 'scratch'; tech: string[] }

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => ({
  date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
})
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TECH_SH = String.raw`cd "$1" 2>/dev/null || exit 0
f() { find . -maxdepth 3 "$@" -print -quit 2>/dev/null | grep -q .; }
f \( -name '*.tf' -o -name terragrunt.hcl \) && echo tech/terraform
{ [ -d dags ] || [ -f airflow.cfg ]; } && echo tech/airflow
f -name dbt_project.yml && echo tech/dbt
{ [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; } && echo tech/python
[ -f package.json ] && echo tech/node
[ -f Cargo.toml ] && echo tech/rust
[ -f go.mod ] && echo tech/go
true`

const DAILY = (date: string) =>
  `---\ntitle: "${date}"\ntype: daily\ntags: [daily]\ncreated: ${date}\nupdated: ${date}\n---\n\n## Sessions\n\n## Key Decisions\n\n## Notes\n`

// Insert `lines` right under `## <heading>` (or append the heading if missing).
const insertUnder = (text: string, heading: string, lines: string) => {
  const re = new RegExp(`^## ${esc(heading)}[ \\t]*\\n`, 'm')
  return re.test(text) ? text.replace(re, m => `${m}${lines}\n`) : `${text.replace(/\n*$/, '\n')}\n## ${heading}\n${lines}\n`
}

// Replace the body of `## <heading>` with `body`, keeping whatever was already in it.
const fillSection = (text: string, heading: string, body: string) => {
  const re = new RegExp(`(^## ${esc(heading)}[ \\t]*\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm')
  return text.replace(re, (_, h, old) => `${h}${old.trim() ? `${old.trimEnd()}\n` : ''}${body}\n\n`)
}

const section = (text: string, heading: string) =>
  new RegExp(`^## ${esc(heading)}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text)?.[1] ?? ''

const bullets = (s: string) => s.split('\n').filter(l => /^\s*[-*]\s+/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)

const SUMMARY_PROMPT = `Summarise this session for my knowledge vault. Answer with exactly these three markdown sections and nothing else, at most 8 short bullets each, "- none" when there is nothing:

## Log
(what was done and found, in order)

## Key Decisions
(decisions with lasting impact, with the reason)

## Open Questions
(unresolved questions and follow-ups)`

const run = async ($: Engine, script: string, ...args: string[]) =>
  (await $.process.run(['sh', '-c', script, '_', ...args], { timeoutMs: 15_000 }).catch(() => ({ stdout: '' }))).stdout

const infoOf = async ($: Engine, cwd: string): Promise<Info> => {
  const git = (...a: string[]) => $.process.run(['git', '-C', cwd, ...a]).then(r => (r.exitCode === 0 ? r.stdout.trim() : '')).catch(() => '')
  const common = await git('rev-parse', '--path-format=absolute', '--git-common-dir')
  const isGit = common !== ''
  const root = isGit ? common.replace(/\/\.git\/?$/, '') || common.replace(/\/[^/]*$/, '') : cwd.replace(/\/\.claude\/worktrees\/.*$/, '')
  const project = base(cwd)
  const home = (await $.env.get('HOME')) ?? ''
  const isScratch = !isGit && (/^\/(private\/)?(tmp|var\/folders)\//.test(cwd) || cwd === home || cwd.startsWith(`${home}/.claude`) || /^tmp\./.test(project) || /^\d+$/.test(project))
  const tech = (await run($, TECH_SH, root)).split('\n').filter(Boolean)
  return { project, repo: base(root), root, branch: isGit ? await git('rev-parse', '--abbrev-ref', 'HEAD') : '', isGit, type: isScratch ? 'scratch' : 'session', tech }
}

// The note for this session id: reuse (resume, compact, /clear continuations) or create. Idempotent.
const ensureNote = async ($: Engine, vault: string) => {
  const id = await $.session.id()
  const notes = ((await $.store.get('notes')) ?? {}) as Record<string, string>
  if (notes[id] && (await $.fs.exists(notes[id]))) return { id, path: notes[id], info: undefined }
  const cwd = await $.session.cwd()
  const info = await infoOf($, cwd)
  const { date, time } = stamp(new Date(await $.clock.now()))
  const slug = `${date}-${time.replace(':', '')}-${info.project}`
  let path = `${vault}/sessions/${slug}.md`
  if (await $.fs.exists(path)) path = `${vault}/sessions/${slug}-${id.slice(0, 4)}.md`
  const tags = [`project/${info.project}`, ...(info.isGit || info.project !== info.repo ? [`repo/${info.repo}`] : []), ...(info.type === 'scratch' ? ['scratch'] : []), ...info.tech]
  await $.fs.write(path, `---
title: "${info.project} session"
type: ${info.type}
tags: [${tags.join(', ')}]
created: ${date}
updated: ${date}
status: active
project_dir: "${cwd}"
repo: "${info.repo}"
branch: "${info.branch}"
git_root: "${info.root}"
session_id: "${id}"
related: []
---

## Context
Session started at ${time} in \`${cwd}\`.

## Log


## Key Decisions


## Open Questions


## Knowledge Created

`)
  await $.fs.write(`${vault}/projects/${info.repo}/plans/.keep`, '').catch(() => {})
  if (info.type !== 'scratch') {
    const daily = `${vault}/daily/${date}.md`
    const text = (await $.fs.exists(daily)) ? await $.fs.read(daily) : DAILY(date)
    const link = `- ${time} — [[${base(path).replace(/\.md$/, '')}|${info.project}]] — \`${cwd}\``
    if (!text.includes(`[[${base(path).replace(/\.md$/, '')}`)) await $.fs.write(daily, insertUnder(text, 'Sessions', link))
  }
  // ponytail: keep the last 200 ids only; an older resume gets a fresh note.
  await $.store.set('notes', Object.fromEntries(Object.entries({ ...notes, [id]: path }).slice(-200)))
  return { id, path, info }
}

const noteMeta = (text: string, key: string) => new RegExp(`^${key}: "?([^"\\n]*)"?$`, 'm').exec(text)?.[1] ?? ''

const buildDigest = async ($: Engine, vault: string, path: string, text: string) => {
  const repo = noteMeta(text, 'repo')
  const root = noteMeta(text, 'git_root')
  const tech = (await run($, TECH_SH, root)).split('\n').filter(Boolean)
  const out: string[] = []
  if (await $.fs.exists(`${vault}/projects/${repo}/index.md`)) out.push(`### Repo Index\n- [[projects/${repo}/index|${repo} index]]`)

  const recent = (await run($, 'ls -t "$1"/*.md 2>/dev/null | xargs grep -lF -- "repo: \\"$2\\"" 2>/dev/null | head -8', `${vault}/sessions`, repo)).split('\n').filter(f => f && f !== path)
  const rec: string[] = [], dec: string[] = [], oq: string[] = []
  for (const [i, f] of recent.entries()) {
    const t = await $.fs.read(f).catch(() => '')
    const name = base(f).replace(/\.md$/, '')
    if (i < 5) {
      const first = bullets(section(t, 'Log'))[0] ?? section(t, 'Context').trim().split('\n')[0] ?? ''
      rec.push(`- [[${name}]]${first ? ` — ${first.slice(0, 100)}` : ''}`)
    }
    for (const d of bullets(section(t, 'Key Decisions')).slice(0, 3)) if (dec.length < 8) dec.push(`- ${d} — [[${name}]]`)
    for (const q of bullets(section(t, 'Open Questions')).slice(0, 3)) if (oq.length < 8) oq.push(`- ${q} — [[${name}]]`)
  }
  if (rec.length) out.push(`### Recent sessions in ${repo}\n${rec.join('\n')}`)
  if (dec.length) out.push(`### Recent decisions in ${repo}\n${dec.join('\n')}`)
  if (oq.length) out.push(`### Open questions from recent ${repo} sessions\n${oq.join('\n')}`)

  const pats = [`repo/${repo}`, `project/${repo}`, repo, ...tech.flatMap(t => [t, t.replace('tech/', '')])].map(esc).join('|')
  const kn = (await run($, 'grep -rlE --include=*.md "^tags:.*[[,/ ]($2)[],]" "$1" 2>/dev/null | head -8', `${vault}/knowledge`, pats)).split('\n').filter(Boolean)
  if (kn.length) {
    const rows: string[] = []
    for (const f of kn) rows.push(`- [[${base(f).replace(/\.md$/, '')}]] — ${noteMeta(await $.fs.read(f).catch(() => ''), 'title') || base(f)}`)
    out.push(`### Related knowledge notes\n${rows.join('\n')}`)
  }

  const plans = (await run($, 'ls -t "$1"/*.md 2>/dev/null | head -3', `${vault}/projects/${repo}/plans`)).split('\n').filter(Boolean)
  if (plans.length) {
    const rows: string[] = []
    for (const f of plans) {
      const st = noteMeta(await $.fs.read(f).catch(() => ''), 'status')
      rows.push(`- [[${base(f).replace(/\.md$/, '')}]]${st ? ` — *${st}*` : ''}`)
    }
    out.push(`### Recent plans for ${repo}\n${rows.join('\n')}`)
  }
  return { repo, text: out.join('\n\n') }
}


export const register: Register = (on, options) => {
  const vault = String(options.vault_path ?? '').replace(/\/+$/, '')
  const indexScript = String(options.index_script ?? '')
  let digest: { key: string; text: string } | undefined

  // System-prompt section: the active note plus prior context. Cached per session id.
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    if (!vault) return res
    try {
      const { id, path } = await ensureNote($, vault)
      if (digest?.key !== id) {
        const d = await buildDigest($, vault, path, await $.fs.read(path))
        digest = {
          key: id,
          text: `## Active Session Note
**Session note:** \`${path}\`
**Repo:** \`${d.repo}\`
**Plans directory:** \`${vault}/projects/${d.repo}/plans/\`

The vault plugin writes this note: it summarises the session into Log, Key Decisions and Open Questions when the session ends. Do not log by hand. When you find something reusable, create a note in \`${vault}/knowledge/{patterns,decisions,references}/\` and link it under Knowledge Created. Save implementation plans to the plans directory as \`YYYY-MM-DD-short-description.md\`.${d.text ? `\n\n## Prior Vault Context (${d.repo})\n${d.text}\n\n*Read the linked notes that look relevant before starting work.*` : ''}`,
        }
      }
      return { sections: [...res.sections, { id: 'vault:session', text: digest.text, scope: 'session' as const }] }
    } catch {
      return res
    }
  })

  // Domain context: projects/*/_context.md whose frontmatter `keywords: [a, b]` appear in the prompt.
  on('prompt.submit', async ($, e, next) => {
    if (!vault || e.command) return next(e)
    try {
      const words = new Set(e.text.toLowerCase().match(/[a-z0-9_-]+/g) ?? [])
      const hits: string[] = []
      for (const d of await $.fs.list(`${vault}/projects`)) {
        const f = `${vault}/projects/${d.name}/_context.md`
        if (d.kind !== 'dir' || !(await $.fs.exists(f))) continue
        const t = await $.fs.read(f)
        const kws = noteMeta(t.split('---')[1] ?? '', 'keywords').replace(/[\[\]'"]/g, '').split(/[,\s]+/).filter(Boolean)
        if (kws.some(k => words.has(k.toLowerCase()))) hits.push(`### ${d.name}\n${t.replace(/^---[\s\S]*?---\s*/, '').split('\n').slice(0, 60).join('\n')}`)
      }
      if (hits.length) return next({ ...e, text: `${e.text}\n\n<vault-domain-context>\n${hits.join('\n\n')}\n</vault-domain-context>` })
    } catch {}
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    if (vault) await ensureNote($, vault).catch(() => {})
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (!vault) return next(e)
    try {
      const notes = ((await $.store.get('notes')) ?? {}) as Record<string, string>
      const path = notes[e.sessionId]
      if (!path || !(await $.fs.exists(path))) return next(e)
      let text = await $.fs.read(path)
      if (/^status: archived$/m.test(text)) return next(e)

      const r = await $.model.fork({ prompt: SUMMARY_PROMPT, effort: 'low' }).catch(() => undefined)
      if (r?.isAnswered) {
        for (const h of ['Log', 'Key Decisions', 'Open Questions']) {
          const body = section(r.text, h).trim()
          if (body && !/^[-*]\s*none\s*$/i.test(body)) text = fillSection(text, h, body)
        }
      }
      text = text.replace(/^status: active$/m, 'status: archived')
      await $.fs.write(path, text)

      const { date } = stamp(new Date(await $.clock.now()))
      const name = base(path).replace(/\.md$/, '')
      const daily = `${vault}/daily/${date}.md`
      if (noteMeta(text, 'type') !== 'scratch' && (await $.fs.exists(daily))) {
        let d = await $.fs.read(daily)
        const ds = bullets(section(text, 'Key Decisions')).map(x => `- ${x} ([[${name}]])`)
        if (ds.length) d = insertUnder(d, 'Key Decisions', ds.join('\n'))
        await $.fs.write(daily, d)
      }
      const repo = noteMeta(text, 'repo')
      if (indexScript && repo) await $.process.run([indexScript, repo], { timeoutMs: 20_000 }).catch(() => {})
    } catch {}
    return next(e)
  })
}

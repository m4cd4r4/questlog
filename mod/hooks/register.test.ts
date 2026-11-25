/**
 * The pane toggle in register.tsx, run against the engine: claude plugin test mod
 * The flag file the extension writes, the session and git are faked beneath the plugin.
 */
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const FLAG = 'C:/cfg/questlog/panes/sess-1.json'

type World = {
  flag?: string, files?: Record<string, string>, open: string[], closed: string[], writes: { path: string, text: string }[], statuses: (string | undefined)[], misses: string[],
  /** What a `node` run answers (the worktree CLI); none means it fails like every other run here. */
  node?: { exitCode: number, stdout: string },
  /** Every `node` run the mod made, as argv. */
  nodeRuns?: string[][],
}

function world(on: On, w: World) {
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:/cfg' })
  const shown = new Set<string>()
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.root', async () => ({ value: 'C:/work/repo' }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'node') w.nodeRuns?.push([...e.argv])
    if (e.argv[0] === 'node' && w.node) return { value: { ...w.node, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.read', async (_$, e) => {
    const path = e.path.split(String.fromCharCode(92)).join('/')
    if (path === FLAG && w.flag !== undefined) return { value: w.flag }
    if (w.files?.[path] !== undefined) return { value: w.files[path] }
    w.misses.push(path)
    return { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', async (_$, e) => {
    const path = e.path.split(String.fromCharCode(92)).join('/')
    return { value: (path === FLAG && w.flag !== undefined) || w.files?.[path] !== undefined }
  })
  on('fs.write', async (_$, e) => {
    const path = e.path.split(String.fromCharCode(92)).join('/')
    w.writes.push({ path, text: e.text })
    if (path === FLAG) w.flag = e.text
    if (w.files) w.files[path] = e.text
    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    const dir = `${e.path.split(String.fromCharCode(92)).join('/')}/`
    const names = Object.keys(w.files ?? {}).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')).map(p => p.slice(dir.length))
    return { value: names.map(name => ({ name })) } as never
  })
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.status', async (_$, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.panes', async () => ({ value: [...shown].map(id => ({ id, title: 'Questlog', isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('ui.open', async (_$, e) => { shown.add(e.id); w.open.push(e.id); return { value: { isPlaced: true } } as never })
  on('ui.close', async (_$, e) => { shown.delete(e.id); w.closed.push(e.id); return { value: undefined } as never })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }) as never)
}

const fresh = (): World => ({ open: [], closed: [], writes: [], statuses: [], misses: [] })
const start = { cwd: 'C:/work/repo', surface: 'terminal', isInteractive: true } as const

test('no flag: the pane stays closed, at start and on the poll', async ($, on) => {
  const w = fresh()
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  await clock.advance(10_000)
  expect(w.open).toEqual([])
})

test('no flag: the poll never fails a read, so it logs no ENOENT line', async ($, on) => {
  const w = fresh()
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  w.misses.length = 0
  await clock.advance(10_000)
  expect(w.misses).toEqual([])
})

test('/clear keeps the poll running, so the flag still opens the pane with no prompt', async ($, on) => {
  const w = fresh()
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as never)
  w.flag = JSON.stringify({ open: true })
  await clock.advance(2_000)
  expect(w.open).toEqual(['questlog'])
})

test('the flag turned on opens the pane on the next poll; turned off closes it', async ($, on) => {
  const w = fresh()
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  w.flag = '{"open":true}'
  await clock.advance(2_000)
  expect(w.open).toEqual(['questlog'])
  await clock.advance(4_000)
  expect(w.open).toEqual(['questlog'])
  w.flag = '{"open":false}'
  await clock.advance(2_000)
  expect(w.closed).toEqual(['questlog'])
})

test('status_line off: no status line from a questlog update', { options: { status_line: false } }, async ($, on) => {
  const w = fresh()
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't1', plan: 'P', steps: [{ text: 'a', status: 'now' }] } as never)
  expect(w.statuses).toEqual([])
})

test('status_line on (default): a questlog update writes the status line', async ($, on) => {
  const w = fresh()
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't1', plan: 'P', steps: [{ text: 'a', status: 'now' }] } as never)
  expect(w.statuses.length).toBeGreaterThan(0)
})

test('questlog_close: writes who and what proves it beside the row, leaves the row alone, and refuses a second close', async ($, on) => {
  const A = 'aaaaaa00-0'
  const row = JSON.stringify({ id: A, repo: 'repo', where: '', plan: 'Add checkout', done: 4, total: 5, now: '', updatedAt: 7, cwd: 'C:/work/repo' })
  const w = { ...fresh(), files: { [`C:/cfg/questlog/${A}.json`]: row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't1', plan: 'Tidy worktrees', steps: [{ text: 'a', status: 'now' }] } as never)
  const call = (session: string, evidence: string) => $.tool.call({ tool: 'mcp__questlog__questlog_close', tool_use_id: 't2', session, evidence } as never)

  await call('aaaaaa', '  ')
  expect(w.files[`C:/cfg/questlog/${A}.close`]).toBeUndefined()
  await call('aaaaaa', 'git worktree list no longer shows it')
  const close = JSON.parse(w.files[`C:/cfg/questlog/${A}.close`])
  expect(close.by).toBe('sess-1')
  expect(close.byPlan).toBe('Tidy worktrees')
  expect(close.evidence).toBe('git worktree list no longer shows it')
  expect(close.rowReportedAt).toBe(7)
  expect(w.files[`C:/cfg/questlog/${A}.json`]).toBe(row)
  await call('aaaaaa', 'a later claim')
  expect(JSON.parse(w.files[`C:/cfg/questlog/${A}.close`]).evidence).toBe('git worktree list no longer shows it')
})

test('questlog_close on a card with steps: refused until every open step is finished or not needed with why, then the close carries them', async ($, on) => {
  const A = 'aaaaaa00-0'
  const steps = [{ text: 'Write it', status: 'done' }, { text: 'Test it', status: 'now' }, { text: 'Tell the team', status: 'todo' }]
  const row = JSON.stringify({ id: A, repo: 'repo', where: '', plan: 'Add checkout', done: 1, total: 3, now: 'Test it', steps, updatedAt: 7, cwd: 'C:/work/repo' })
  const w = { ...fresh(), files: { [`C:/cfg/questlog/${A}.json`]: row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't1', plan: 'Tidy worktrees', steps: [{ text: 'a', status: 'now' }] } as never)
  const call = (steps: unknown, evidence?: string) => $.tool.call({ tool: 'mcp__questlog__questlog_close', tool_use_id: 't2', session: 'aaaaaa', steps, evidence } as never)

  const partial = await call([{ text: 'Test it', outcome: 'finished', why: 'npm test passes' }], 'all done')
  expect(String((partial as { result?: string }).result ?? JSON.stringify(partial))).toContain('Tell the team')
  expect(w.files[`C:/cfg/questlog/${A}.close`]).toBeUndefined()

  await call([{ text: 'Test it', outcome: 'finished', why: 'npm test passes' }, { text: 'Tell the team', outcome: 'not needed', why: 'they were on the call' }])
  const close = JSON.parse(w.files[`C:/cfg/questlog/${A}.close`])
  expect(close.steps).toEqual([{ text: 'Test it', outcome: 'finished', why: 'npm test passes' }, { text: 'Tell the team', outcome: 'not needed', why: 'they were on the call' }])
  expect(close.evidence).toBe('npm test passes; Tell the team: they were on the call')
})

test('reopening a session keeps its report stamp, so a close against it holds; a new report moves the stamp', async ($, on) => {
  const row = JSON.stringify({ id: 'sess-1', repo: 'repo', where: '', plan: 'Add checkout', done: 1, total: 2, now: 'b', steps: [{ text: 'a', status: 'done' }, { text: 'b', status: 'now' }], updatedAt: 7, ended: true })
  const w = { ...fresh(), files: { 'C:/cfg/questlog/sess-1.json': row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(JSON.parse(w.files['C:/cfg/questlog/sess-1.json']).reportedAt).toBe(7)
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't1', plan: 'Add checkout', steps: [{ text: 'a', status: 'done' }, { text: 'b', status: 'done' }] } as never)
  expect(JSON.parse(w.files['C:/cfg/questlog/sess-1.json']).reportedAt).not.toBe(7)
})

test('restating the same list after reopening is no report: a close another session made against the row holds', async ($, on) => {
  const steps = [{ text: 'a', status: 'done' }, { text: 'b', status: 'now' }]
  const row = JSON.stringify({ id: 'sess-1', repo: 'repo', where: '', plan: 'Add checkout', done: 1, total: 2, now: 'b', steps, updatedAt: 7, reportedAt: 7, ended: true })
  const close = JSON.stringify({ by: 'bbbbbbbb-0000-4000-8000-000000000000', byPlan: 'Other', evidence: 'npm test passes', at: 9, rowReportedAt: 7, steps: [{ text: 'b', outcome: 'finished', why: 'npm test passes' }] })
  const w = { ...fresh(), files: { 'C:/cfg/questlog/sess-1.json': row, 'C:/cfg/questlog/sess-1.close': close } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  // The Stop nudge after a Grep: the model restates the list it has
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't1', plan: 'Add checkout', steps } as never)
  expect(JSON.parse(w.files['C:/cfg/questlog/sess-1.json']).reportedAt).toBe(7)
  // A step moved: that is news, and the close lapses
  await $.tool.call({ tool: 'mcp__questlog__questlog', tool_use_id: 't2', plan: 'Add checkout', steps: [steps[0], { text: 'b', status: 'done' }] } as never)
  expect(JSON.parse(w.files['C:/cfg/questlog/sess-1.json']).reportedAt).not.toBe(7)
})

test('a turn of reads alone is not stopped for a report; one that edited is, once', async ($, on) => {
  const row = JSON.stringify({ id: 'sess-1', repo: 'repo', where: '', plan: 'Add checkout', done: 1, total: 2, now: 'b', steps: [{ text: 'a', status: 'done' }, { text: 'b', status: 'now' }], updatedAt: 7, reportedAt: 7, ended: true })
  const w = { ...fresh(), files: { 'C:/cfg/questlog/sess-1.json': row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('classic.Stop', () => ({}) as never)
  await $.session.start(start)
  await clock.settle()
  const stop = async (active: boolean) => ((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? ''
  await $.tool.call({ tool: 'Grep', tool_use_id: 't1', pattern: 'x' } as never)
  expect(await stop(false)).toBe('')
  await $.tool.call({ tool: 'Edit', tool_use_id: 't2', file_path: 'C:/work/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(await stop(false)).toContain('questlog')
  expect(await stop(true)).toBe('')
})

test('a plan name taken from a written plan file is bookkeeping, not a report: the stamp stays', async ($, on) => {
  // A row with a plan and no steps restores as a topic, with its stamp; the written heading then names the plan
  const row = JSON.stringify({ id: 'sess-1', repo: 'repo', where: '', plan: 'First prompt', done: 0, total: 0, now: '', steps: [], updatedAt: 7, ended: true })
  const w = { ...fresh(), files: { 'C:/cfg/questlog/sess-1.json': row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  on('tool.call', async () => ({ result: 'written' }) as never)
  await $.session.start(start)
  await clock.settle()
  await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: 'C:/cfg/.claude/plans/x.md', content: '# Add checkout\n' } as never)
  const saved = JSON.parse(w.files['C:/cfg/questlog/sess-1.json'])
  expect([saved.plan, saved.reportedAt]).toEqual(['Add checkout', 7])
})

const OLD = 'C:/cfg/session-compass'
const NEW = 'C:/cfg/questlog'
const savedRow = JSON.stringify({ id: 'sess-1', repo: 'repo', branch: 'main', where: '', plan: 'Old plan', topic: '', done: 0, total: 1, now: 'a', steps: [{ text: 'a', status: 'now' }], updatedAt: 1, ended: false })

test('first run copies the old rows and note across, and the session keeps its plan', async ($, on) => {
  const w = { ...fresh(), files: { [`${OLD}/sess-1.json`]: savedRow, [`${OLD}/dismissed.json`]: '{}', [`${OLD}/restart-note.md`]: 'start here', [`${OLD}/live.cache`]: 'x' } }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(JSON.parse(w.files[`${NEW}/sess-1.json`]).plan).toBe('Old plan')
  expect(w.files[`${NEW}/dismissed.json`]).toBe('{}')
  expect(w.files[`${NEW}/restart-note.md`]).toBe('start here')
  expect(w.files[`${NEW}/live.cache`]).toBeUndefined()
  expect(w.files[`${OLD}/sess-1.json`]).toBe(savedRow)
})

test('a file already in the new folder is kept', async ($, on) => {
  const w = { ...fresh(), files: { [`${OLD}/restart-note.md`]: 'old note', [`${NEW}/restart-note.md`]: 'new note' } }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${NEW}/restart-note.md`]).toBe('new note')
})

test('it runs once: a note deleted from the new folder does not come back', async ($, on) => {
  const w = { ...fresh(), files: { [`${OLD}/restart-note.md`]: 'old note' } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${NEW}/restart-note.md`]).toBe('old note')
  delete w.files[`${NEW}/restart-note.md`]
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${NEW}/restart-note.md`]).toBeUndefined()
})

test('no old folder: nothing is copied and no marker is written', async ($, on) => {
  const w = { ...fresh(), files: {} as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(Object.keys(w.files).filter(p => p.includes('migrated'))).toEqual([])
})

test('/questlog-stats: the month\'s ledger and the rows still on disk, each session once by its newest entry; the .prev copy and a torn line are not read', async ($, on) => {
  const NOV = new Date(2026, 10, 6, 12).getTime()
  const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003'
  const rowOf = (id: string, over: Record<string, unknown>) => JSON.stringify({ id, repo: 'repo', where: '', plan: 'P', done: 3, total: 3, now: '', updatedAt: NOV - 60_000, ...over })
  const lineOf = (id: string, over: Record<string, unknown>) => JSON.stringify({ id, plan: 'P', done: 3, total: 3, repo: 'repo', firstAt: null, lastAt: NOV - 86_400_000, ended: 'finished', ...over })
  const w = { ...fresh(), files: {
    [`C:/cfg/questlog/${A}.json`]: rowOf(A, {}),
    [`C:/cfg/questlog/${B}.json`]: rowOf(B, { done: 2, total: 5 }),
    [`C:/cfg/questlog/${B}.close`]: JSON.stringify({ by: C, byPlan: 'Other', evidence: 'merged', at: NOV, rowReportedAt: NOV - 60_000 }),
    'C:/cfg/questlog/ledger/2026-11.jsonl': [lineOf(A, { done: 1, ended: 'unfinished' }), lineOf(C, { repo: 'blog', done: 4, total: 4 }), '{"id":"torn'].join('\n'),
    'C:/cfg/questlog/ledger/.2026-11.jsonl.prev': lineOf('dddddddd-0000-4000-8000-000000000004', {}),
  } as Record<string, string> }
  const clock = mock.clock(on, { now: NOV })
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  const { text } = await $.command.run({ command: 'questlog-stats' })
  expect(text).toBe([
    'November 2026: 3 sessions',
    '  2 finished · 1 closed',
    '  9 of 12 steps done',
    '',
    'By repo',
    '  repo · 2 sessions · 1 finished · 5 of 8 steps',
    '  blog · 1 session · 1 finished · 4 of 4 steps',
  ].join('\n'))
})

test('/clear: the session that follows takes on the cleared session\'s plan and steps, is told to keep the plan name, and the old row names it', async ($, on) => {
  const OLD = 'aaaaaaaa-0000-4000-8000-000000000001'
  const steps = [{ text: 'Add totals', status: 'done' }, { text: 'Wire form', status: 'now' }, { text: 'Open PR', status: 'todo' }]
  const row = JSON.stringify({ id: OLD, repo: 'repo', where: 'feat', plan: 'Checkout flow', done: 1, total: 3, now: 'Wire form', updatedAt: 7, cwd: 'C:/work/repo', steps })
  const w = { ...fresh(), files: { [`C:/cfg/questlog/${OLD}.json`]: row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  // The host's own answer to the event, beneath the plugin: it adds nothing
  on('classic.SessionStart', async () => ({}) as never)
  await $.session.start(start)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: OLD } as never)
  const r = await $.classic.SessionStart({ source: 'clear' } as never) as { additionalContext?: string[] }
  await clock.settle()

  expect(JSON.parse(w.files[`C:/cfg/questlog/${OLD}.json`]).continuedIn).toBe('sess-1')
  const next = JSON.parse(w.files['C:/cfg/questlog/sess-1.json'])
  expect([next.plan, next.done, next.total, next.continuedFrom]).toEqual(['Checkout flow', 1, 3, OLD])
  expect(next.steps.map((s: { status: string }) => s.status)).toEqual(['done', 'now', 'todo'])
  const told = (r.additionalContext ?? []).join('\n')
  expect(told).toContain('"Checkout flow"')
  expect(told).toContain('Keep this plan name')
})

test('/clear after a finished plan carries nothing: the next session starts empty and is told nothing', async ($, on) => {
  const OLD = 'aaaaaaaa-0000-4000-8000-000000000001'
  const row = JSON.stringify({ id: OLD, repo: 'repo', where: 'feat', plan: 'Checkout flow', done: 1, total: 1, now: '', updatedAt: 7, cwd: 'C:/work/repo', steps: [{ text: 'Add totals', status: 'done' }] })
  const w = { ...fresh(), files: { [`C:/cfg/questlog/${OLD}.json`]: row } as Record<string, string> }
  const clock = mock.clock(on)
  world(on, w)
  // The host's own answer to the event, beneath the plugin: it adds nothing
  on('classic.SessionStart', async () => ({}) as never)
  await $.session.start(start)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: OLD } as never)
  const r = await $.classic.SessionStart({ source: 'clear' } as never) as { additionalContext?: string[] }
  await clock.settle()
  expect(JSON.parse(w.files[`C:/cfg/questlog/${OLD}.json`]).continuedIn).toBe('sess-1')
  expect((r.additionalContext ?? []).join('\n')).not.toContain('Checkout flow')
  expect(w.files['C:/cfg/questlog/sess-1.json'] ? JSON.parse(w.files['C:/cfg/questlog/sess-1.json']).plan : '').toBe('')
})

// ---------- the worktree line at session start ----------

const CLI_JSON = 'C:/cfg/questlog/worktrees/cli.json'
const CLI = 'C:/ext/acme/dist/questlog-wt.mjs'
const NOTE = 'C:/cfg/questlog/restart-note.md'
const LINE = "Worktrees: this worktree is closable (PR #12 merged, clean); 3 of repo's 9 worktrees can be closed"

type Brief = {
  /** cli.json's text; none when the extension never wrote it. */
  cli?: string
  note?: string
  /** What the CLI does: its answer, or 'reject' when the run cannot start or times out. */
  run: { exitCode: number, stdout: string } | 'reject'
  /** Every node run the mod made, as argv. */
  runs: string[][]
}

function briefWorld(on: On, b: Brief) {
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:/cfg' })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.root', async () => ({ value: 'C:/work/repo' }))
  on('process.run', async (_$, e) => {
    // git, from the session start, is not what these cases are about
    if (e.argv[0] !== 'node') return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    b.runs.push([...e.argv])
    if (b.run === 'reject') throw new Error('spawn node ENOENT')
    return { value: { ...b.run, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.read', async (_$, e) => {
    const path = e.path.split(String.fromCharCode(92)).join('/')
    if (path === CLI_JSON && b.cli !== undefined) return { value: b.cli }
    if (path === NOTE && b.note !== undefined) return { value: b.note }
    return { deny: `ENOENT ${e.path}` }
  })
  on('classic.SessionStart', async () => ({}) as never)
}

const withLine = (over: Partial<Brief> = {}): Brief => ({ cli: JSON.stringify({ path: CLI }), run: { exitCode: 0, stdout: `${LINE}\n` }, runs: [], ...over })
const contextOf = (r: unknown) => (r as { additionalContext?: string[] } | undefined)?.additionalContext ?? []
const hasLine = (r: unknown) => contextOf(r).some(c => c.startsWith(LINE))
const hasNote = (r: unknown) => contextOf(r).some(c => c.startsWith('Restart note'))

test('worktree line: a fresh session with a restart note gets both, the line told as information only', async ($, on) => {
  const b = withLine({ note: '- test the tab switch\n' })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(hasNote(r)).toBe(true)
  expect(hasLine(r)).toBe(true)
  const told = contextOf(r).find(c => c.startsWith(LINE)) ?? ''
  expect(told.split('\n').length).toBe(3)
  expect(told).toContain('information only')
  expect(told).toContain('Never remove or prune a worktree')
})

test('worktree line: the run is node, the CLI, brief, the session folder, --cache and the cache beside cli.json, nothing else', async ($, on) => {
  const b = withLine()
  briefWorld(on, b)
  await $.classic.SessionStart({ source: 'startup' } as never)
  expect(b.runs).toEqual([['node', CLI, 'brief', 'C:/work/repo', '--cache', 'C:/cfg/questlog/worktrees/scan.cache']])
})

test('worktree line: after /clear the line is given and the restart note is not', async ($, on) => {
  const b = withLine({ note: '- test the tab switch\n' })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'clear' } as never)
  expect(hasLine(r)).toBe(true)
  expect(hasNote(r)).toBe(false)
})

for (const source of ['compact', 'resume', 'fork'] as const) {
  test(`worktree line: a ${source} gets no line and runs nothing`, async ($, on) => {
    const b = withLine()
    briefWorld(on, b)
    const r = await $.classic.SessionStart({ source } as never)
    expect(hasLine(r)).toBe(false)
    expect(b.runs).toEqual([])
  })
}

test('worktree line: no cli.json means no run and no line', async ($, on) => {
  const b = withLine({ cli: undefined })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(contextOf(r)).toEqual([])
  expect(b.runs).toEqual([])
})

test('worktree line: a cli.json naming another file, or a network share, is never run', async ($, on) => {
  const b = withLine({ cli: JSON.stringify({ path: 'C:/ext/acme/dist/other.mjs' }) })
  briefWorld(on, b)
  expect(contextOf(await $.classic.SessionStart({ source: 'startup' } as never))).toEqual([])
  b.cli = JSON.stringify({ path: '//host/share/dist/questlog-wt.mjs' })
  expect(contextOf(await $.classic.SessionStart({ source: 'startup' } as never))).toEqual([])
  expect(b.runs).toEqual([])
})

test('worktree line: a run that cannot start gives no line and still delivers the restart note', async ($, on) => {
  const b = withLine({ run: 'reject', note: '- test the tab switch\n' })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(b.runs.length).toBe(1)
  expect(hasLine(r)).toBe(false)
  expect(hasNote(r)).toBe(true)
})

test('worktree line: a run that exits non-zero gives no line, whatever it printed', async ($, on) => {
  const b = withLine({ run: { exitCode: 1, stdout: `${LINE}\n` } })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(contextOf(r)).toEqual([])
})

test('worktree line: an empty answer gives no line', async ($, on) => {
  const b = withLine({ run: { exitCode: 0, stdout: '' } })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(contextOf(r)).toEqual([])
})

test('worktree_line off: nothing is run and no line is given; the restart note still arrives', { options: { worktree_line: false } }, async ($, on) => {
  const b = withLine({ note: '- test the tab switch\n' })
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(b.runs).toEqual([])
  expect(hasLine(r)).toBe(false)
  expect(hasNote(r)).toBe(true)
})

test('worktree_line off: after /clear nothing is run either', { options: { worktree_line: false } }, async ($, on) => {
  const b = withLine()
  briefWorld(on, b)
  const r = await $.classic.SessionStart({ source: 'clear' } as never)
  expect(b.runs).toEqual([])
  expect(hasLine(r)).toBe(false)
})

// The carry after /clear and the worktree line together: the carry is told first and whole, the line after it
const carryWorld = (node?: World['node']) => {
  const OLD = 'aaaaaaaa-0000-4000-8000-000000000001'
  const steps = [{ text: 'Add totals', status: 'done' }, { text: 'Wire form', status: 'now' }, { text: 'Open PR', status: 'todo' }]
  const row = JSON.stringify({ id: OLD, repo: 'repo', where: 'feat', plan: 'Checkout flow', done: 1, total: 3, now: 'Wire form', updatedAt: 7, cwd: 'C:/work/repo', steps })
  const files: Record<string, string> = { [`C:/cfg/questlog/${OLD}.json`]: row, [CLI_JSON]: JSON.stringify({ path: CLI }) }
  return { OLD, w: { ...fresh(), files, nodeRuns: [], ...(node ? { node } : {}) } as World }
}

test('/clear with the worktree line: the carried plan is told first and unchanged, the line after it', async ($, on) => {
  const { OLD, w } = carryWorld({ exitCode: 0, stdout: `${LINE}\n` })
  const clock = mock.clock(on)
  world(on, w)
  on('classic.SessionStart', async () => ({}) as never)
  await $.session.start(start)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: OLD } as never)
  const r = await $.classic.SessionStart({ source: 'clear' } as never)
  await clock.settle()

  const told = contextOf(r)
  expect(told.length).toBe(2)
  expect(told[0]).toContain('"Checkout flow"')
  expect(told[0]).toContain('Keep this plan name')
  expect(told[1].startsWith(LINE)).toBe(true)
  const next = JSON.parse(w.files!['C:/cfg/questlog/sess-1.json'])
  expect([next.plan, next.done, next.total, next.continuedFrom]).toEqual(['Checkout flow', 1, 3, OLD])
  expect(w.nodeRuns).toEqual([['node', CLI, 'brief', 'C:/work/repo', '--cache', 'C:/cfg/questlog/worktrees/scan.cache']])
})

test('/clear with a failing worktree CLI: the carry is still told, whole, and nothing else', async ($, on) => {
  const { w } = carryWorld({ exitCode: 2, stdout: `${LINE}\n` })
  const clock = mock.clock(on)
  world(on, w)
  on('classic.SessionStart', async () => ({}) as never)
  await $.session.start(start)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'aaaaaaaa-0000-4000-8000-000000000001' } as never)
  const r = await $.classic.SessionStart({ source: 'clear' } as never)
  await clock.settle()
  const told = contextOf(r)
  expect(told.length).toBe(1)
  expect(told[0]).toContain('"Checkout flow"')
  expect(w.nodeRuns!.length).toBe(1)
})

test('/clear with worktree_line off: the carry is told and no node run is made', { options: { worktree_line: false } }, async ($, on) => {
  const { w } = carryWorld({ exitCode: 0, stdout: `${LINE}\n` })
  const clock = mock.clock(on)
  world(on, w)
  on('classic.SessionStart', async () => ({}) as never)
  await $.session.start(start)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'aaaaaaaa-0000-4000-8000-000000000001' } as never)
  const r = await $.classic.SessionStart({ source: 'clear' } as never)
  await clock.settle()
  const told = contextOf(r)
  expect(told.length).toBe(1)
  expect(told[0]).toContain('"Checkout flow"')
  expect(w.nodeRuns).toEqual([])
})

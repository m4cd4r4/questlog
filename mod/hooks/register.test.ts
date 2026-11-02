/**
 * The pane toggle in register.tsx, run against the engine: claude plugin test mod
 * The flag file the extension writes, the session and git are faked beneath the plugin.
 */
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const FLAG = 'C:/cfg/questlog/panes/sess-1.json'

type World = { flag?: string, files?: Record<string, string>, open: string[], closed: string[], writes: { path: string, text: string }[], statuses: (string | undefined)[], misses: string[] }

function world(on: On, w: World) {
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:/cfg' })
  const shown = new Set<string>()
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.root', async () => ({ value: 'C:/work/repo' }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
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

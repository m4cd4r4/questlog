/**
 * The retention job, run from session.start against the engine: claude plugin test mod
 * The rows folder is a map in memory; the delete is a faked process.run. No real folder is touched.
 */
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DAY_MS, LEDGER_DIR, RETENTION_MARKER } from './retention'

const DIR = 'C:/cfg/questlog'
const NOW = 200 * DAY_MS
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (n: number, ageDays: number, done: number, total = 3) =>
  JSON.stringify({ id: id(n), repo: 'shop', where: '', plan: `Plan ${n}`, done, total, now: '', updatedAt: NOW - ageDays * DAY_MS, startedAt: NOW - (ageDays + 1) * DAY_MS })

type World = { files: Record<string, string>, runs: { argv: readonly string[], cwd?: string }[], failWrite?: (path: string) => boolean, dropWrite?: (path: string) => boolean, rmMissing?: boolean, holdMarker?: Promise<void>, onLedger?: () => void }

const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')

function world(on: On, w: World) {
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:/cfg' })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.root', async () => ({ value: 'C:/work/repo' }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    w.runs.push({ argv: e.argv, cwd: e.init?.cwd })
    if (e.argv[0] === 'rm' && w.rmMissing) return { deny: 'ENOENT rm' } as never
    const names = e.argv[0] === 'rm' ? e.argv.slice(3) : e.argv.slice(6)
    for (const n of names) delete w.files[`${norm(e.init?.cwd ?? '')}/${n}`]
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.read', async (_$, e) => {
    const path = norm(e.path)
    if (path === `${DIR}/${RETENTION_MARKER}` && w.holdMarker) await w.holdMarker
    return w.files[path] !== undefined ? { value: w.files[path] } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', async (_$, e) => ({ value: w.files[norm(e.path)] !== undefined }))
  on('fs.write', async (_$, e) => {
    const path = norm(e.path)
    if (w.failWrite?.(path)) return { deny: `EACCES ${e.path}` }
    if (w.dropWrite?.(path)) return { value: undefined }
    w.files[path] = e.text
    if (path.includes(`/${LEDGER_DIR}/`)) w.onLedger?.()
    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    const dir = `${norm(e.path)}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')).map(p => p.slice(dir.length))
    return { value: names.map(name => ({ name, kind: 'file', size: w.files[dir + name]!.length, mtimeMs: 0, isLink: false })) } as never
  })
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.status', async () => ({ value: undefined }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.panes', async () => ({ value: [] }) as never)
  on('ui.log', async () => ({ value: undefined }) as never)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
}

const start = { cwd: 'C:/work/repo', surface: 'terminal', isInteractive: true } as const
const ledgerOf = (w: World) => Object.entries(w.files).filter(([p]) => p.startsWith(`${DIR}/${LEDGER_DIR}/`)).flatMap(([, t]) => t.trim().split('\n').map(l => JSON.parse(l)))

test('old finished and old unfinished rows are ledgered, then deleted with their close; fresh rows and foreign files stay', async ($, on) => {
  const w: World = {
    runs: [],
    files: {
      [`${DIR}/${id(1)}.json`]: row(1, 8, 3), // finished, 8 days: goes
      [`${DIR}/${id(1)}.close`]: '{}',
      [`${DIR}/${id(2)}.json`]: row(2, 31, 1), // unfinished, 31 days: goes
      [`${DIR}/${id(3)}.json`]: row(3, 6, 3), // finished, 6 days: stays
      [`${DIR}/${id(4)}.json`]: row(4, 20, 1), // unfinished, 20 days: stays
      [`${DIR}/restart-note.md`]: 'note',
      [`${DIR}/dismissed.json`]: '{}',
      [`${DIR}/.migrated-from-session-compass`]: '',
      [`${DIR}/mystery.json`]: JSON.stringify({ id: 'mystery', updatedAt: 0, done: 0, total: 0 }),
    },
  }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(ledgerOf(w).map(l => [l.id, l.ended]).sort()).toEqual([[id(1), 'finished'], [id(2), 'unfinished']])
  for (const gone of [`${id(1)}.json`, `${id(1)}.close`, `${id(2)}.json`]) expect(w.files[`${DIR}/${gone}`]).toBeUndefined()
  for (const kept of [`${id(3)}.json`, `${id(4)}.json`, 'restart-note.md', 'dismissed.json', '.migrated-from-session-compass', 'mystery.json']) expect(w.files[`${DIR}/${kept}`]).toBeDefined()
  expect(w.files[`${DIR}/${RETENTION_MARKER}`]).toBe(String(NOW))
})

test('a second session start within a day does not run the job; one a day later does', async ($, on) => {
  const w: World = { runs: [], files: { [`${DIR}/${RETENTION_MARKER}`]: String(NOW - DAY_MS + 60_000), [`${DIR}/${id(1)}.json`]: row(1, 8, 3) } }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeDefined()
  expect(ledgerOf(w)).toEqual([])
  expect(w.runs).toEqual([])
  expect(w.files[`${DIR}/${RETENTION_MARKER}`]).toBe(String(NOW - DAY_MS + 60_000))
  await clock.advance(60_000)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeUndefined()
})

test('a ledger write that fails leaves its rows where they are, and runs no delete', async ($, on) => {
  const w: World = { runs: [], files: { [`${DIR}/${id(1)}.json`]: row(1, 8, 3), [`${DIR}/${id(1)}.close`]: '{}' }, failWrite: p => p.includes(`/${LEDGER_DIR}/`) }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeDefined()
  expect(w.files[`${DIR}/${id(1)}.close`]).toBeDefined()
  expect(w.runs).toEqual([])
})

test('a ledger write that reports success but is not on disk when read back deletes nothing', async ($, on) => {
  const w: World = { runs: [], files: { [`${DIR}/${id(1)}.json`]: row(1, 8, 3) }, dropWrite: p => p.includes(`/${LEDGER_DIR}/`) }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeDefined()
  expect(w.runs).toEqual([])
})

test('a run that died after its ledger line: the next run deletes the row without a second line', async ($, on) => {
  const month = `${DIR}/${LEDGER_DIR}/${new Date(NOW - 8 * DAY_MS).getFullYear()}-${String(new Date(NOW - 8 * DAY_MS).getMonth() + 1).padStart(2, '0')}.jsonl`
  const earlier = `{"id":"${id(1)}","plan":"Plan 1","done":3,"total":3,"repo":"shop","firstAt":0,"lastAt":0,"ended":"finished"}\n{"id":"aaaa`
  const w: World = { runs: [], files: { [`${DIR}/${id(1)}.json`]: row(1, 8, 3), [month]: earlier } }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeUndefined()
  expect(w.files[month]).toBe(earlier)
})

test('session.start returns while the job is still waiting on its first read; the job finishes after', async ($, on) => {
  let release = () => {}
  const w: World = { runs: [], files: { [`${DIR}/${id(1)}.json`]: row(1, 8, 3) }, holdMarker: new Promise<void>(r => { release = r }) }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  let started = false
  const done = $.session.start(start).then(() => { started = true })
  await clock.settle()
  expect(started).toBe(true)
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeDefined()
  release()
  await done
  await clock.settle()
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeUndefined()
})

test('no rm on the host: the delete falls back to del, run in the rows folder with bare file names', async ($, on) => {
  const w: World = { runs: [], files: { [`${DIR}/${id(1)}.json`]: row(1, 8, 3) }, rmMissing: true }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(w.runs.map(r => r.argv[0])).toEqual(['rm', 'cmd'])
  expect(w.runs[1]).toEqual({ argv: ['cmd', '/d', '/c', 'del', '/f', '/q', `${id(1)}.json`], cwd: DIR })
  expect(w.files[`${DIR}/${id(1)}.json`]).toBeUndefined()
})

test('a row its session rewrote while the job ran is not deleted', async ($, on) => {
  const w: World = { runs: [], files: { [`${DIR}/${id(1)}.json`]: row(1, 8, 3), [`${DIR}/${id(2)}.json`]: row(2, 8, 3) } }
  w.onLedger = () => { w.files[`${DIR}/${id(1)}.json`] = row(1, 0, 3) }
  const clock = mock.clock(on)
  await clock.set(NOW)
  world(on, w)
  await $.session.start(start)
  await clock.settle()
  expect(JSON.parse(w.files[`${DIR}/${id(1)}.json`]!).updatedAt).toBe(NOW)
  expect(w.files[`${DIR}/${id(2)}.json`]).toBeUndefined()
})

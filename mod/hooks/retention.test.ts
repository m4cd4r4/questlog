import { expect, test } from 'claude-code/testing'

import { DAY_MS, FINISHED_KEEP_MS, UNFINISHED_KEEP_MS, appendLedger, endingOf, idsInLedger, isExpired, ledgerLine, ledgerMonth, rowFileId, rowFrom, shouldRun } from './retention'
import type { Close, Row } from './lib'

const ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const row = (over: Partial<Row> = {}): Row => ({ id: ID, repo: 'shop', where: 'feat', plan: 'Ship it', done: 3, total: 3, now: '', updatedAt: 1_000, ...over })
const close = (r: Row): Close => ({ by: 'bbbbbbbb-0000-4000-8000-000000000002', byPlan: 'Other', evidence: 'merged', at: 2_000, rowReportedAt: r.reportedAt ?? r.updatedAt })

test('rowFileId: only <session uuid>.json is a row file; the note, markers, dismissed state and anything unknown are not', () => {
  expect(rowFileId(`${ID}.json`)).toBe(ID)
  for (const name of [`${ID}.close`, 'restart-note.md', '.migrated-from-session-compass', 'dismissed.json', 'notes.json', `${ID}.json.tmp`, `x${ID}.json`, '.retention-ran', 'ledger'])
    expect(rowFileId(name)).toBeUndefined()
})

test('rowFrom: a file is a row only when it parses and its id is the file name; a half-written or foreign file is none', () => {
  expect(rowFrom(JSON.stringify(row()), ID)?.id).toBe(ID)
  expect(rowFrom(JSON.stringify(row({ id: 'aaaaaaaa-0000-4000-8000-000000000009' })), ID)).toBeUndefined()
  expect(rowFrom('{"id":"aaaaaaaa-0000-4000-8000-0000', ID)).toBeUndefined()
  expect(rowFrom(JSON.stringify({ id: ID }), ID)).toBeUndefined()
  expect(rowFrom('null', ID)).toBeUndefined()
})

test('endingOf: the extension\'s meaning (hasWorkLeft): work left and no close holding is unfinished, every other row is finished', () => {
  expect(endingOf(row())).toBe('finished')
  expect(endingOf(row({ done: 1 }))).toBe('unfinished')
  expect(endingOf(row({ done: 0, total: 0 }))).toBe('no steps')
  const open = row({ done: 1 })
  expect(endingOf(open, close(open))).toBe('closed')
  // A close against an older report has lapsed: the session reported again, so the work is open
  expect(endingOf(open, { ...close(open), rowReportedAt: 1 })).toBe('unfinished')
  expect(endingOf(open, { ...close(open), undone: true })).toBe('unfinished')
})

test('isExpired: finished keeps 7 days, unfinished 30, counted from the last update', () => {
  expect(FINISHED_KEEP_MS).toBe(7 * DAY_MS)
  expect(UNFINISHED_KEEP_MS).toBe(30 * DAY_MS)
  const done = row({ updatedAt: 0 })
  expect(isExpired(done, undefined, FINISHED_KEEP_MS - 1)).toBe(false)
  expect(isExpired(done, undefined, FINISHED_KEEP_MS)).toBe(true)
  const open = row({ updatedAt: 0, done: 1 })
  expect(isExpired(open, undefined, FINISHED_KEEP_MS)).toBe(false)
  expect(isExpired(open, undefined, UNFINISHED_KEEP_MS - 1)).toBe(false)
  expect(isExpired(open, undefined, UNFINISHED_KEEP_MS)).toBe(true)
  // Closed counts as finished
  expect(isExpired(open, close(open), FINISHED_KEEP_MS)).toBe(true)
  // A row from the future (clock skew) is never expired
  expect(isExpired(row({ updatedAt: 10 * UNFINISHED_KEEP_MS }), undefined, 0)).toBe(false)
})

test('ledgerLine: plan, steps done of total, repo, first and last update, how it ended; one JSON line', () => {
  const r = row({ done: 2, total: 5, startedAt: 500, updatedAt: 1_000 })
  const line = ledgerLine(r)
  expect(line).not.toContain('\n')
  expect(JSON.parse(line)).toEqual({ id: ID, plan: 'Ship it', done: 2, total: 5, repo: 'shop', firstAt: 500, lastAt: 1_000, ended: 'unfinished' })
  // A row from before startedAt says nothing about its first update rather than guessing
  expect(JSON.parse(ledgerLine(row())).firstAt).toBeNull()
  expect(JSON.parse(ledgerLine(r, close(r))).ended).toBe('closed')
})

test('ledgerMonth: the month of the last update, YYYY-MM', () => {
  expect(ledgerMonth(new Date(2026, 0, 15, 12).getTime())).toBe('2026-01')
  expect(ledgerMonth(new Date(2026, 10, 6, 12).getTime())).toBe('2026-11')
})

test('idsInLedger and appendLedger: lines already there are kept, a torn last line is skipped and closed off', () => {
  const a = ledgerLine(row())
  const b = ledgerLine(row({ id: 'aaaaaaaa-0000-4000-8000-000000000002' }))
  const torn = `${a}\n{"id":"aaaaaaaa-00`
  expect([...idsInLedger(torn)]).toEqual([ID])
  const text = appendLedger(torn, [b])
  expect(text.startsWith(torn + '\n')).toBe(true)
  expect(text.endsWith('\n')).toBe(true)
  expect([...idsInLedger(text)].sort()).toEqual([ID, 'aaaaaaaa-0000-4000-8000-000000000002'])
  expect(appendLedger('', [a])).toBe(`${a}\n`)
  expect(appendLedger(`${a}\n`, [b])).toBe(`${a}\n${b}\n`)
})

test('shouldRun: once a day; no marker, a bad one or one from the future runs', () => {
  const now = 100 * DAY_MS
  expect(shouldRun('', now)).toBe(true)
  expect(shouldRun('garbage', now)).toBe(true)
  expect(shouldRun(String(now - DAY_MS + 1), now)).toBe(false)
  expect(shouldRun(String(now - DAY_MS), now)).toBe(true)
  expect(shouldRun(String(now + DAY_MS), now)).toBe(true)
})

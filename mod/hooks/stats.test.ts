import { expect, test } from 'claude-code/testing'

import { entriesFromLedger, monthSummary, statsText, type StatEntry } from './stats'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: A, plan: 'Ship it', done: 3, total: 3, repo: 'shop', firstAt: 500, lastAt: 1_000, ended: 'finished', ...over })

test('entriesFromLedger: whole lines are read; a torn, blank or wrong-shaped line is skipped, never thrown on', () => {
  const text = [line(), '', '{"id":"x","plan":"to', line({ ended: 'sideways' }), line({ lastAt: 'soon' }), 'null', line({ id: 'b', firstAt: null })].join('\n')
  expect(entriesFromLedger(text)).toEqual([
    { id: A, plan: 'Ship it', done: 3, total: 3, repo: 'shop', firstAt: 500, lastAt: 1_000, ended: 'finished' },
    { id: 'b', plan: 'Ship it', done: 3, total: 3, repo: 'shop', firstAt: null, lastAt: 1_000, ended: 'finished' },
  ])
  expect(entriesFromLedger('')).toEqual([])
})

const NOV = new Date(2026, 10, 6, 12).getTime()
const OCT = new Date(2026, 9, 20, 12).getTime()
const entry = (over: Partial<StatEntry> = {}): StatEntry => ({ id: A, plan: 'Ship it', done: 3, total: 3, repo: 'shop', firstAt: null, lastAt: NOV, ended: 'finished', ...over })

test('monthSummary: each session once, by its newest entry; only sessions whose newest entry is in the month; counts by ending, steps and repo', () => {
  const s = monthSummary([
    entry({ id: 'a', done: 1, lastAt: NOV - 1000, ended: 'unfinished' }), entry({ id: 'a', lastAt: NOV }),
    entry({ id: 'b', repo: 'blog', done: 2, total: 5, ended: 'closed' }),
    entry({ id: 'c', done: 1, total: 4, ended: 'unfinished' }),
    entry({ id: 'd', done: 0, total: 0, ended: 'no steps' }),
    entry({ id: 'e', lastAt: OCT }),
    entry({ id: 'f', lastAt: OCT }), entry({ id: 'f', repo: 'blog', lastAt: NOV + 1000 }),
  ], '2026-11')
  expect(s).toEqual({
    month: '2026-11', sessions: 5, finished: 2, closed: 1, unfinished: 1, noSteps: 1, done: 9, total: 15,
    repos: [
      { repo: 'shop', sessions: 3, finished: 1, done: 4, total: 7 },
      { repo: 'blog', sessions: 2, finished: 1, done: 5, total: 8 },
    ],
  })
})

test('statsText: outcome first, every count with its N, endings with none left out, one line per repo; an empty month says 0', () => {
  const s = monthSummary([
    entry({ id: 'a' }), entry({ id: 'b', done: 1, total: 4, ended: 'unfinished' }), entry({ id: 'c', repo: 'blog', done: 2, total: 2 }),
  ], '2026-11')
  expect(statsText(s)).toBe([
    'November 2026: 3 sessions',
    '  2 finished · 1 unfinished',
    '  6 of 9 steps done',
    '',
    'By repo',
    '  shop · 2 sessions · 1 finished · 4 of 7 steps',
    '  blog · 1 session · 1 finished · 2 of 2 steps',
  ].join('\n'))
  expect(statsText(monthSummary([], '2026-01'))).toBe('January 2026: 0 sessions')
})

test('monthSummary: a session with no plan and no steps (a window opened and left, as the panel hides it) is not counted', () => {
  const s = monthSummary([entry({ id: 'a', plan: '', done: 0, total: 0, ended: 'no steps' }), entry({ id: 'b', plan: 'Asked a question', done: 0, total: 0, ended: 'no steps' })], '2026-11')
  expect([s.sessions, s.noSteps]).toEqual([1, 1])
})

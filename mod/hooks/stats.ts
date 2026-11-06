// What /questlog-stats and the panel's "This month" section count, as plain functions. The ledger
// (retention.ts ledgerLine) holds a line per deleted row; rows still on disk are counted beside it, one entry per
// session, so the current month is whole before its rows expire. No imports, so both builds take it as is
// (the extension imports it the way it imports close.ts).

export type Ending = 'finished' | 'closed' | 'unfinished' | 'no steps'

/** One ledger line, or one row still on disk in the same shape. `firstAt` is null for rows from before startedAt: unknown, not zero. */
export type StatEntry = { id: string; plan: string; done: number; total: number; repo: string; firstAt: number | null; lastAt: number; ended: Ending }

const ENDINGS: readonly string[] = ['finished', 'closed', 'unfinished', 'no steps']
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** The whole lines of a month's ledger; a torn line from a crash, or one of the wrong shape, is skipped. */
export const entriesFromLedger = (text: string): StatEntry[] => {
  const out: StatEntry[] = []
  for (const line of text.split('\n')) {
    let v: Record<string, unknown> | null
    try { v = JSON.parse(line) } catch { continue }
    if (!v || typeof v.id !== 'string' || !num(v.lastAt) || !num(v.done) || !num(v.total) || !ENDINGS.includes(v.ended as string)) continue
    out.push({
      id: v.id, plan: typeof v.plan === 'string' ? v.plan : '', done: v.done as number, total: v.total as number,
      repo: typeof v.repo === 'string' ? v.repo : '', firstAt: num(v.firstAt) ? v.firstAt as number : null, lastAt: v.lastAt as number, ended: v.ended as Ending,
    })
  }
  return out
}

export type RepoSummary = { repo: string; sessions: number; finished: number; done: number; total: number }
export type MonthSummary = { month: string; sessions: number; finished: number; closed: number; unfinished: number; noSteps: number; done: number; total: number; repos: RepoSummary[] }

/** The month a time falls in, local time, YYYY-MM: the same as retention.ts ledgerMonth, which names the ledger file. */
export const monthOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * The month's sums. A session counts once, by its newest entry (a row spared mid-run can leave an early ledger line,
 * and a row still on disk is newer than any line about it), and only when that newest entry falls in `month`.
 * Repos come most sessions first.
 */
export const monthSummary = (entries: readonly StatEntry[], month: string): MonthSummary => {
  const newest = new Map<string, StatEntry>()
  for (const e of entries) {
    const had = newest.get(e.id)
    if (!had || e.lastAt > had.lastAt) newest.set(e.id, e)
  }
  const s: MonthSummary = { month, sessions: 0, finished: 0, closed: 0, unfinished: 0, noSteps: 0, done: 0, total: 0, repos: [] }
  const repos = new Map<string, RepoSummary>()
  for (const e of newest.values()) {
    // No plan and no steps: a window opened and left, which the panel hides too (rows.ts visibleRows)
    if (monthOf(e.lastAt) !== month || (!e.plan && e.total === 0)) continue
    s.sessions++
    if (e.ended === 'finished') s.finished++
    else if (e.ended === 'closed') s.closed++
    else if (e.ended === 'unfinished') s.unfinished++
    else s.noSteps++
    s.done += e.done
    s.total += e.total
    const name = e.repo || '?'
    const r = repos.get(name) ?? { repo: name, sessions: 0, finished: 0, done: 0, total: 0 }
    r.sessions++
    if (e.ended === 'finished') r.finished++
    r.done += e.done
    r.total += e.total
    repos.set(name, r)
  }
  s.repos = [...repos.values()].sort((a, b) => b.sessions - a.sessions || a.repo.localeCompare(b.repo))
  return s
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The wording Macdara picked (rule 6, 2026-11-06): the headline, the outcome lines and one line per repo. The panel draws the same strings. */
export const statsLines = (s: MonthSummary) => {
  const [y, m] = s.month.split('-')
  const head = `${MONTHS[Number(m) - 1] ?? s.month} ${y}: ${plural(s.sessions, 'session')}`
  if (s.sessions === 0) return { head, lines: [] as string[], repos: [] as string[] }
  const endings = ([[s.finished, 'finished'], [s.closed, 'closed'], [s.unfinished, 'unfinished'], [s.noSteps, 'no steps']] as const)
    .filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`).join(' · ')
  return {
    head,
    lines: [endings, `${s.done} of ${s.total} steps done`],
    repos: s.repos.map(r => `${r.repo} · ${plural(r.sessions, 'session')} · ${r.finished} finished · ${r.done} of ${r.total} steps`),
  }
}

/** What /questlog-stats prints. */
export const statsText = (s: MonthSummary) => {
  const { head, lines, repos } = statsLines(s)
  return [head, ...lines.map(l => `  ${l}`), ...(repos.length ? ['', 'By repo', ...repos.map(r => `  ${r}`)] : [])].join('\n')
}

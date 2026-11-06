// Seed for the wave 3 sandbox run: node ~/.claude/scripts/plugin-dev.mjs mod --seed docs/no-bloat/stats-seed.mjs -- -p "/questlog-stats"
// Writes rows and this month's ledger into the SANDBOX config dir only. Expected output:
//   <Month> <year>: 4 sessions
//     2 finished · 1 closed · 1 unfinished
//     10 of 16 steps done
//   By repo
//     sample-repo · 3 sessions · 1 finished · 7 of 12 steps
//     other-repo · 1 session · 1 finished · 3 of 4 steps
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export default (configDir) => {
  if (resolve(configDir).toLowerCase() === resolve(homedir(), '.claude').toLowerCase()) throw new Error('refusing to seed the live config')
  const dir = join(configDir, 'questlog')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'ledger'), { recursive: true })
  const now = Date.now()
  const d = new Date(now)
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const early = new Date(d.getFullYear(), d.getMonth(), 1, 1).getTime() // the 1st of this month, 01:00 local
  const id = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
  // The retention job ran an hour ago, so it leaves these rows alone
  writeFileSync(join(dir, '.retention-ran'), `${now - 3_600_000} seed`)
  const row = (n, plan, done, total, extra = {}) => writeFileSync(join(dir, `${id(n)}.json`), JSON.stringify({
    id: id(n), repo: 'sample-repo', where: '', plan, done, total, now: '', updatedAt: now - 60_000, ...extra,
  }))
  row(1, 'Fresh finished', 3, 3, { startedAt: now - 3_600_000 })
  row(2, 'Fresh unfinished', 1, 4) // no startedAt: a row from before wave 2
  row(3, 'Closed by another session', 3, 5)
  writeFileSync(join(dir, `${id(3)}.close`), JSON.stringify({ by: id(9), byPlan: 'Other', evidence: 'merged', at: now, rowReportedAt: now - 60_000 }))
  row(8, '', 0, 0) // a window opened and left: not counted
  const line = (n, over) => JSON.stringify({ id: id(n), plan: 'P', done: 3, total: 3, repo: 'sample-repo', firstAt: null, lastAt: early, ended: 'finished', ...over })
  writeFileSync(join(dir, 'ledger', `${month}.jsonl`), [
    line(2, { done: 0, total: 4, ended: 'unfinished' }), // an early line for row 2, which is newer on disk: counted once
    line(4, { repo: 'other-repo', done: 3, total: 4, firstAt: early - 3_600_000 }),
    '{"id":"torn', // a crash mid-write
  ].join('\n'))
  writeFileSync(join(dir, 'ledger', `.${month}.jsonl.prev`), line(7, {})) // the crash copy: not read
}

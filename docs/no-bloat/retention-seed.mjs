// Seed for the wave 2 sandbox run: node ~/.claude/scripts/plugin-dev.mjs mod --seed docs/no-bloat/retention-seed.mjs -- -p "say ok"
// Writes a rows folder into the SANDBOX config dir only: old finished, old unfinished, fresh rows and foreign files.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DAY = 24 * 60 * 60 * 1000

export default (configDir) => {
  if (resolve(configDir).toLowerCase() === resolve(homedir(), '.claude').toLowerCase()) throw new Error('refusing to seed the live config')
  const dir = join(configDir, 'questlog')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  const id = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
  const row = (n, plan, ageDays, done, total) => writeFileSync(join(dir, `${id(n)}.json`), JSON.stringify({
    id: id(n), repo: 'sample-repo', where: '', plan, done, total, now: '', updatedAt: now - ageDays * DAY, startedAt: now - (ageDays + 2) * DAY, ended: true,
  }))
  row(1, 'Old finished', 9, 4, 4) // goes: finished past 7 days
  row(2, 'Old unfinished', 35, 1, 5) // goes: unfinished past 30 days
  row(3, 'Old closed by another session', 10, 1, 3) // goes: a close holds, so finished
  writeFileSync(join(dir, `${id(3)}.close`), JSON.stringify({ by: id(9), byPlan: 'Other', evidence: 'merged', at: now - 10 * DAY, rowReportedAt: now - 10 * DAY }))
  row(4, 'Fresh finished', 2, 3, 3) // stays
  row(5, 'Unfinished, 20 days', 20, 2, 6) // stays: inside 30 days
  writeFileSync(join(dir, 'restart-note.md'), '') // foreign to the job: stays
  writeFileSync(join(dir, 'dismissed.json'), '{}')
  writeFileSync(join(dir, 'unknown.json'), JSON.stringify({ id: 'unknown', updatedAt: 0, done: 0, total: 0 }))
}

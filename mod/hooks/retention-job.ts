// The retention job (docs/no-bloat/PROJECT-PLAN.md, rules 1-4), started unawaited from session.start.
// Order is the guard: the ledger line is written and read back before its row is deleted, so a crash or a
// failed write leaves at worst a row not yet deleted, and a rerun skips ids the ledger already holds.
// The engine has no delete, so the job runs `rm` (or `del` where there is none) in the rows folder, naming
// only `<uuid>.json` and `<uuid>.close` files: no path, nothing to quote, nothing outside the folder.
import type { EngineInterface } from 'claude-code'

import { CLOSE_EXT, type Close } from './close'
import type { Row } from './lib'
import { LEDGER_DIR, RETENTION_MARKER, appendLedger, idsInLedger, isExpired, ledgerLine, ledgerMonth, rowFileId, rowFrom, shouldRun } from './retention'

export type RetentionReport = { ran: boolean; ledgered: number; deleted: number; kept: number }

const CHUNK = 100

const closeFrom = (text: string): Close | undefined => {
  try {
    const c = JSON.parse(text) as Partial<Close> | null
    return c && typeof c.by === 'string' && typeof c.rowReportedAt === 'number' ? c as Close : undefined
  } catch { return undefined }
}

async function remove($: EngineInterface, dir: string, names: readonly string[]) {
  for (let i = 0; i < names.length; i += CHUNK) {
    const part = names.slice(i, i + CHUNK)
    // `rm` where it starts; Windows without one on PATH falls back to cmd's del
    await $.process.run(['rm', '-f', '--', ...part], { cwd: dir, timeoutMs: 30_000 })
      .catch(() => $.process.run(['cmd', '/d', '/c', 'del', '/f', '/q', ...part], { cwd: dir, timeoutMs: 30_000 }))
      .catch(() => undefined)
  }
}

/** One run over `dir` (the questlog rows folder). Skipped when the marker says it ran in the last day. */
export async function runRetention($: EngineInterface, dir: string, nowMs: number): Promise<RetentionReport> {
  const report: RetentionReport = { ran: false, ledgered: 0, deleted: 0, kept: 0 }
  const marker = `${dir}/${RETENTION_MARKER}`
  if (!shouldRun(String((await $.fs.read(marker).catch(() => '')) ?? ''), nowMs)) return report
  // Claimed before any reading, so a session starting meanwhile skips; a run that dies retries tomorrow
  await $.fs.write(marker, String(nowMs))
  report.ran = true
  const entries = await $.fs.list(dir)
  const names = new Set(entries.filter(f => f.kind === 'file').map(f => f.name))
  const byMonth = new Map<string, { row: Row; text: string; close?: Close }[]>()
  for (const name of names) {
    const id = rowFileId(name)
    if (!id) continue
    const text = String((await $.fs.read(`${dir}/${name}`).catch(() => '')) ?? '')
    const row = rowFrom(text, id)
    if (!row) continue
    const close = names.has(`${id}${CLOSE_EXT}`) ? closeFrom(String((await $.fs.read(`${dir}/${id}${CLOSE_EXT}`).catch(() => '')) ?? '')) : undefined
    if (!isExpired(row, close, nowMs)) { report.kept++; continue }
    const month = ledgerMonth(row.updatedAt)
    byMonth.set(month, [...(byMonth.get(month) ?? []), { row, text, close }])
  }
  for (const [month, due] of byMonth) {
    const path = `${dir}/${LEDGER_DIR}/${month}.jsonl`
    const before = String((await $.fs.read(path).catch(() => '')) ?? '')
    const have = idsInLedger(before)
    const fresh = due.filter(d => !have.has(d.row.id))
    if (fresh.length > 0) {
      const wrote = await $.fs.write(path, appendLedger(before, fresh.map(d => ledgerLine(d.row, d.close)))).then(() => true, () => false)
      if (!wrote) continue
    }
    // Read back: only a row whose line is on disk now is deleted
    const onDisk = idsInLedger(String((await $.fs.read(path).catch(() => '')) ?? ''))
    const ledgered = due.filter(d => onDisk.has(d.row.id))
    report.ledgered += ledgered.filter(d => !have.has(d.row.id)).length
    // A session resumed meanwhile has rewritten its row: that row is live again and stays
    const confirmed: typeof due = []
    for (const d of ledgered) if (String((await $.fs.read(`${dir}/${d.row.id}.json`).catch(() => '')) ?? '') === d.text) confirmed.push(d)
    const doomed = confirmed.flatMap(d => [`${d.row.id}.json`, ...(names.has(`${d.row.id}${CLOSE_EXT}`) ? [`${d.row.id}${CLOSE_EXT}`] : [])])
    await remove($, dir, doomed)
    for (const d of confirmed) if (!(await $.fs.exists(`${dir}/${d.row.id}.json`).catch(() => true))) report.deleted++
  }
  return report
}

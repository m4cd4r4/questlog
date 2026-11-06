// The retention job (docs/no-bloat/PROJECT-PLAN.md, rules 1-4), started unawaited from session.start.
// Order is the guard: the ledger line is written and read back before its row is deleted, so a crash or a
// failed write leaves at worst a row not yet deleted, and a rerun skips ids the ledger already holds.
// The engine has no delete, so the job runs `rm` (or `del` where there is none) in the rows folder, naming
// only `<uuid>.json` and `<uuid>.close` files: no path, nothing to quote, nothing outside the folder.
import type { EngineInterface } from 'claude-code'

import { CLOSE_EXT, closeFrom, type Close } from './close'
import type { Row } from './lib'
import { CLAIM_SETTLE_MS, LEDGER_DIR, RETENTION_MARKER, markerText, appendLedger, keysInLedger, ledgerKey, mergeLedger, isExpired, ledgerLine, ledgerMonth, rowFileId, rowFrom, shouldRun } from './retention'

export type RetentionReport = { ran: boolean; ledgered: number; deleted: number; kept: number }

const CHUNK = 100
const keyOf = (r: Row) => ledgerKey(r.id, r.updatedAt)

async function remove($: EngineInterface, dir: string, names: readonly string[]) {
  for (let i = 0; i < names.length; i += CHUNK) {
    const part = names.slice(i, i + CHUNK)
    // `rm` where it starts; Windows without one on PATH falls back to cmd's del
    await $.process.run(['rm', '-f', '--', ...part], { cwd: dir, timeoutMs: 30_000 })
      .catch(() => $.process.run(['cmd', '/d', '/c', 'del', '/f', '/q', ...part], { cwd: dir, timeoutMs: 30_000 }))
      .catch(() => undefined)
  }
}

/** A file's text, '' when there is no file, undefined when there is one that cannot be read. */
// Asked first: a read that misses logs a line, and this runs at every session start
async function readIfThere($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path).catch(() => true))) return ''
  try { return String((await $.fs.read(path)) ?? '') } catch { return undefined }
}

/** One run over `dir` (the questlog rows folder). Skipped when the marker says it ran in the last day. */
export async function runRetention($: EngineInterface, dir: string, nowMs: number, owner: string): Promise<RetentionReport> {
  const report: RetentionReport = { ran: false, ledgered: 0, deleted: 0, kept: 0 }
  const marker = `${dir}/${RETENTION_MARKER}`
  if (!shouldRun((await readIfThere($, marker)) ?? '', nowMs)) return report
  // Claimed before any reading, so a session starting meanwhile skips; a run that dies retries tomorrow
  // Two sessions starting together both see an old marker: each writes its claim, waits, and only the one whose
  // claim is still there goes on, so two runs never rewrite one ledger at once
  const claim = markerText(nowMs, owner)
  await $.fs.write(marker, claim)
  await $.clock.sleep(CLAIM_SETTLE_MS)
  if (((await readIfThere($, marker)) ?? '').trim() !== claim) return report
  report.ran = true
  const entries = await $.fs.list(dir)
  const names = new Set(entries.filter(f => f.kind === 'file').map(f => f.name))
  const byMonth = new Map<string, { row: Row; text: string; closeText: string; close?: Close }[]>()
  for (const name of names) {
    const id = rowFileId(name)
    if (!id) continue
    const text = String((await $.fs.read(`${dir}/${name}`).catch(() => '')) ?? '')
    const row = rowFrom(text, id)
    if (!row) continue
    const closeText = names.has(`${id}${CLOSE_EXT}`) ? String((await $.fs.read(`${dir}/${id}${CLOSE_EXT}`).catch(() => '')) ?? '') : ''
    const close = closeFrom(closeText)
    if (!isExpired(row, close, nowMs)) { report.kept++; continue }
    const month = ledgerMonth(row.updatedAt)
    byMonth.set(month, [...(byMonth.get(month) ?? []), { row, text, closeText, close }])
  }
  for (const [month, due] of byMonth) {
    const path = `${dir}/${LEDGER_DIR}/${month}.jsonl`
    const prevPath = `${dir}/${LEDGER_DIR}/.${month}.jsonl.prev`
    const [main, prev] = [await readIfThere($, path), await readIfThere($, prevPath)]
    // There but unreadable (locked, no access): rewriting it would drop every line already in it
    if (main === undefined || prev === undefined) continue
    const before = mergeLedger(prev, main)
    const have = keysInLedger(before)
    const fresh = due.filter(d => !have.has(keyOf(d.row)))
    if (fresh.length > 0) {
      // The whole file is rewritten (the engine has no append): the copy goes first, so a crash in either write
      // leaves every earlier line in the other, and the next run merges them back (retention.ts mergeLedger)
      const write = (p: string, text: string) => $.fs.write(p, text).then(() => true, () => false)
      if (!(await write(prevPath, before)) || !(await write(path, appendLedger(before, fresh.map(d => ledgerLine(d.row, d.close)))))) continue
    }
    // Read back: only a row whose line is on disk now is deleted
    const onDisk = keysInLedger(String((await $.fs.read(path).catch(() => '')) ?? ''))
    const ledgered = due.filter(d => onDisk.has(keyOf(d.row)))
    report.ledgered += ledgered.filter(d => !have.has(keyOf(d.row))).length
    // A row or close changed meanwhile (the session resumed, a close was made or undone): what was judged is gone, so it stays
    const confirmed: typeof due = []
    for (const d of ledgered) {
      const [rowNow, closeNow] = [await readIfThere($, `${dir}/${d.row.id}.json`), await readIfThere($, `${dir}/${d.row.id}${CLOSE_EXT}`)]
      if (rowNow === d.text && closeNow === d.closeText) confirmed.push(d)
    }
    const doomed = confirmed.flatMap(d => [`${d.row.id}.json`, ...(d.closeText ? [`${d.row.id}${CLOSE_EXT}`] : [])])
    await remove($, dir, doomed)
    for (const d of confirmed) if (!(await $.fs.exists(`${dir}/${d.row.id}.json`).catch(() => true))) report.deleted++
  }
  return report
}

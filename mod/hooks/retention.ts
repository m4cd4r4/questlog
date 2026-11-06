// What the retention job decides, as plain functions: which files are rows, how a row ended, when it is past
// retention and the ledger line it leaves behind. Rules in docs/no-bloat/PROJECT-PLAN.md (1, 2 and 4).
import { closeHolds, type Close } from './close'
import type { Row } from './lib'

export const DAY_MS = 24 * 60 * 60 * 1000
/** Rule 4: finished (all steps done, closed, or no steps) is kept this long after its last update... */
export const FINISHED_KEEP_MS = 7 * DAY_MS
/** ...and a row with work left this long. */
export const UNFINISHED_KEEP_MS = 30 * DAY_MS
/** Rule 3: the job runs at most once a day; this file beside the rows holds when it last started. */
export const RUN_EVERY_MS = DAY_MS
export const RETENTION_MARKER = '.retention-ran'
/** How long a run waits after claiming the marker before it reads it back: a session that claimed it after this one wins. */
export const CLAIM_SETTLE_MS = 2000
/** The marker's text: when the run started, then who started it. */
export const markerText = (nowMs: number, owner: string) => `${nowMs} ${owner}`
export const LEDGER_DIR = 'ledger'

const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** Rule 1: a row file is `<session uuid>.json`, the only name the mod writes a row under; anything else is not ours. */
export const rowFileId = (name: string) => {
  if (!name.endsWith('.json')) return undefined
  const id = name.slice(0, -'.json'.length)
  return SESSION_ID.test(id) ? id : undefined
}

/** The row in a row file, or none: a half-written file, or one whose id is not its name, is left alone. */
export const rowFrom = (text: string, id: string): Row | undefined => {
  try {
    const r = JSON.parse(text) as Row | null
    return r && r.id === id && typeof r.updatedAt === 'number' && typeof r.done === 'number' && typeof r.total === 'number' ? r : undefined
  } catch { return undefined }
}

export type Ending = 'finished' | 'closed' | 'unfinished' | 'no steps'

/** The extension's meaning (rows.ts hasWorkLeft): only work left with no close holding is unfinished. */
export const endingOf = (r: Row, close?: Close): Ending =>
  closeHolds(close, r) ? 'closed' : r.total === 0 ? 'no steps' : r.done >= r.total ? 'finished' : 'unfinished'

export const isExpired = (r: Row, close: Close | undefined, nowMs: number) =>
  nowMs - r.updatedAt >= (endingOf(r, close) === 'unfinished' ? UNFINISHED_KEEP_MS : FINISHED_KEEP_MS)

/** Rule 2: one line per deleted row. `firstAt` is null for rows written before startedAt existed. */
export const ledgerLine = (r: Row, close?: Close) => JSON.stringify({
  id: r.id, plan: r.plan, done: r.done, total: r.total, repo: r.repo,
  firstAt: r.startedAt ?? null, lastAt: r.updatedAt, ended: endingOf(r, close),
})

/** The ledger file a row goes to: the month of its last update, local time. */
export const ledgerMonth = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** What names one ending of a session: its id and its last update. A session resumed after its row went ends again later. */
export const ledgerKey = (id: string, lastAt: number) => `${id}@${lastAt}`

/** The keys of the lines that parse; a torn last line from a crash is skipped. */
export const keysInLedger = (text: string) => {
  const keys = new Set<string>()
  for (const line of text.split('\n')) {
    try {
      const v = JSON.parse(line) as { id?: unknown; lastAt?: unknown } | null
      if (v && typeof v.id === 'string' && typeof v.lastAt === 'number') keys.add(ledgerKey(v.id, v.lastAt))
    } catch { /* torn or blank line */ }
  }
  return keys
}

/**
 * The month's ledger from its two copies: every whole line of `main`, then each line of `prev` (the copy written
 * before the last rewrite) that `main` lacks. A crash that tore either copy loses no line the other holds.
 */
export const mergeLedger = (prev: string, main: string) => {
  const whole = (text: string) => text.split('\n').filter(l => keysInLedger(l).size > 0)
  const inMain = whole(main)
  const have = keysInLedger(inMain.join('\n'))
  return [...inMain, ...whole(prev).filter(l => !have.has([...keysInLedger(l)][0]!))].map(l => `${l}\n`).join('')
}

/** The ledger with `lines` added: what was there is kept as is, and a torn last line is ended so the next line stands alone. */
export const appendLedger = (existing: string, lines: readonly string[]) =>
  `${existing && !existing.endsWith('\n') ? `${existing}\n` : existing}${lines.map(l => `${l}\n`).join('')}`

/** Whether the job is due: no marker, a bad one, or one from the future (clock moved back) runs it. */
export const shouldRun = (markerText: string, nowMs: number) => {
  const last = Number(markerText.trim().split(/\s+/)[0])
  return !markerText.trim() || !Number.isFinite(last) || last > nowMs || nowMs - last >= RUN_EVERY_MS
}

// The shape of a close and the two rules every writer and reader of one shares, in ONE place. It lives in the mod
// (a plugin may only import files inside its own folder) and the extension imports it from here: hooks/lib.ts,
// extension/src/rows.ts and extension/src/model.ts all read this file. No imports, so both builds take it as is.

/** What a close says of one step that was open: finished, or not needed and why. */
export type CloseStep = { text: string; outcome: "finished" | "not needed"; why: string };

/**
 * Written by the session that closed the card, by the panel (closed by hand) or by a step check. The row's owner
 * never writes it, so neither can overwrite the other. `steps` accounts for every step that was open; closes from
 * before it have the evidence line alone. `undone` keeps an undone close from closing the card again until its
 * session reports.
 */
export type Close = { by: string; byPlan: string; evidence: string; at: number; rowReportedAt: number; steps?: CloseStep[]; undone?: boolean };

/** `<session id>.close` beside the rows: not a .json file, so nothing reads one as a row. */
export const CLOSE_EXT = ".close";

/** The evidence line and each reason are cut here, whoever wrote them. */
export const EVIDENCE_MAX = 400;

/** Steps are matched to a close by their text as the card shows it. */
export const stepKey = (text: string) => text.trim().toLowerCase();

/** The evidence line a close carries: each step's reason, finished ones bare, not-needed ones with the step named. */
export const evidenceOf = (steps: readonly CloseStep[]) =>
  steps.filter((s) => s.why).map((s) => (s.outcome === "finished" ? s.why : `${s.text}: ${s.why}`)).join("; ").slice(0, EVIDENCE_MAX);

/** A close holds until the session reports again: it is keyed to the row's report stamp. An undone close never holds. */
export const closeHolds = (c: Close | undefined, row: { reportedAt?: number; updatedAt: number }): c is Close =>
  !!c && !c.undone && c.rowReportedAt === (row.reportedAt ?? row.updatedAt);

// The scan as the sidebar shows it: one block per repo, one row per linked worktree, and the guard the host
// checks a path from the page against. Pure, no vscode import, and never an import of cli.ts.
import { ago, norm } from "../rows.ts";
import type { ParentPlan } from "../plans.ts";
import { byName, countText, isLinked, lastCommitText, notARepo, plural, prText, ROW_ORDER, rowVerdict, select, sizeFact, sizeText, type ListedRepo, type ListedWorktree, type RowVerdict } from "./listing.ts";
import { labelOf, repoNameOf, slugOf } from "./names.ts";
import type { ScanFile, ScannedWorktree } from "./scan.ts";
import { sequencesOf, slugName, type Sequence } from "./sequence.ts";

/** One linked worktree in the sidebar. Its id is `path`, never the slug: two repos can hold one slug. */
export type WorktreeRow = {
  /** The folder as git printed it. The page sends it back to open or copy; the host checks it with `isOfferedByScan`. */
  path: string;
  slug: string;
  /** The slug with the repo's name dropped from the front ("acme-app-pricing-table" reads "pricing-table"): what the row shows. The tooltip keeps the whole slug. */
  short: string;
  verdict: RowVerdict;
  /** The verdict in words: "needs you", "closable", "not read yet". */
  label: string;
  /** The scanner's one-line reason; empty when it gave none. Shown first on expand, above `facts`. */
  reason: string;
  /** The pull request number, when GitHub gave one. */
  pr?: number;
  /** Age of the last commit ("3d"); empty when it could not be read. */
  age: string;
  /** Size on disk ("1.2 GB"); empty when it was not measured. */
  size: string;
  /** The other lines shown on expand, each left out when the scan does not hold it. The reason is not repeated here. */
  facts: string[];
  /** False for a Missing row: its folder is gone, so there is nothing to open. */
  canOpen: boolean;
};

/** One scanned repo's worktrees. */
export type WorktreeBlock = {
  /** The main checkout: names the block when two repos of one name share a group. */
  repoPath: string;
  /** The count line: "32 worktrees: 21 closable, 4 need you", or "could not read: <error>" when there are no rows. */
  count: string;
  /** Sorted Needs you, Busy, In flight, Orphan, Closable, Missing, not read yet, then by slug. */
  rows: WorktreeRow[];
  /**
   * Worktrees no plan names that are steps of one piece of work ("pricing-s1", "pricing-s2"), in step order.
   * Left out when there are none. Each step is one of `rows`, by path: the rows themselves are not regrouped.
   */
  sequences?: Sequence[];
};

/** The count line leads with what can be closed: "32 worktrees: 21 closable, 4 need you". */
const COUNT_ORDER: readonly RowVerdict[] = ["closable", "needs-you", "busy", "in-flight", "orphan", "missing", "unread"];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** "32 worktrees: 21 closable, 4 need you": the shared count line, closable first. */
export const countLine = (rows: readonly { verdict: RowVerdict }[], timedOut = false): string =>
  countText(rows.map((r) => r.verdict), COUNT_ORDER, timedOut);

/** "plan <name>, <label or wave>" for the slice whose worktree is this path; nothing when no plan names it. */
const planFact = (path: string, plans: readonly ParentPlan[]): string | undefined => {
  const key = norm(path);
  for (const p of plans) {
    const s = (p.slices ?? []).find((x) => typeof x.worktree === "string" && x.worktree !== "" && norm(x.worktree) === key);
    if (!s) continue;
    const step = s.label || (s.wave ? `wave ${s.wave}` : "");
    return `plan ${p.name}${step ? `, ${step}` : ""}`;
  }
  return undefined;
};

const factsOf = (w: ListedWorktree, plans: readonly ParentPlan[], now: number, sequence?: string): string[] => {
  const out: string[] = [];
  if (w.detached) out.push("detached HEAD");
  else if (w.branch) out.push(`branch ${w.branch}`);
  const pr = w.pr?.state === "none" ? "no PR" : prText(w.pr, "PR #");
  if (pr) out.push(pr);
  const commit = lastCommitText(w.lastCommitAt, now);
  if (commit) out.push(`last commit ${commit}`);
  const size = sizeFact(w.size);
  if (size) out.push(`size ${size}`);
  if (w.server !== undefined && w.server !== "unknown") out.push(`dev server on port ${w.server.port}`);
  if (w.brief === "lost" || w.brief === "recoverable") out.push(`brief ${w.brief}`);
  for (const o of w.overlaps ?? []) out.push(`shares ${plural(o.count, "file", "files")} with ${slugOf(o.path)}`);
  const plan = planFact(w.path, plans);
  if (plan) out.push(plan);
  if (sequence) out.push(sequence);
  return out;
};

const rowOf = (w: ListedWorktree, repoName: string, plans: readonly ParentPlan[], now: number, sequence?: string): WorktreeRow => ({
  path: w.path,
  slug: w.slug,
  short: slugName(w.slug, repoName),
  verdict: rowVerdict(w),
  label: labelOf(w),
  reason: w.verdict?.reason ?? "",
  ...(w.pr?.number == null ? {} : { pr: w.pr.number }),
  age: typeof w.lastCommitAt === "number" ? ago(now - w.lastCommitAt) : "",
  size: w.size === undefined || w.size === "unknown" ? "" : sizeText(w.size.bytes),
  facts: factsOf(w, plans, now, sequence),
  canOpen: !w.prunable,
});

/** The sequences among a repo's worktrees that no plan names. Worked out here, each time the view is built; never stored. */
const sequencesIn = (r: ListedRepo, plans: readonly ParentPlan[]): Sequence[] =>
  sequencesOf(
    r.worktrees
      .filter((w) => planFact(w.path, plans) === undefined)
      .map((w) => ({ path: w.path, slug: w.slug, branch: w.branch, detached: w.detached, verdict: rowVerdict(w), label: labelOf(w) })),
    repoNameOf(r.path),
  );

const blockOf = (r: ListedRepo, plans: readonly ParentPlan[], now: number): WorktreeBlock => {
  const repoName = repoNameOf(r.path);
  const sequences = sequencesIn(r, plans);
  // "sequence pricing, s2" on the member's own row, keyed by path
  const stepLine = new Map<string, string>();
  for (const s of sequences) for (const x of s.steps) stepLine.set(x.path, `sequence ${s.name}, ${x.step}`);
  const rows = r.worktrees
    .map((w) => rowOf(w, repoName, plans, now, stepLine.get(w.path)))
    .sort((a, b) => ROW_ORDER.indexOf(a.verdict) - ROW_ORDER.indexOf(b.verdict) || byName(a.slug, b.slug));
  return {
    repoPath: r.path,
    count: rows.length === 0 && r.error !== undefined ? `could not read: ${r.error}` : countLine(rows, r.timedOut === true),
    rows,
    ...(sequences.length > 0 ? { sequences } : {}),
  };
};

/**
 * One block per scanned repo that has linked worktrees or an error, in the scan's order. The main checkout
 * and bare entries are never rows; a repo with no linked worktrees and no error has no block; a folder
 * that is no repo at all has none either.
 */
export const worktreeBlocks = (scan: ScanFile | undefined, plans: readonly ParentPlan[], now: number): WorktreeBlock[] =>
  scan ? select(scan).repos.map((r) => blockOf(r, plans, now)) : [];

/**
 * The linked worktree of the last scan at `path` (either slash, any letter case), or nothing: never a main
 * checkout, a bare entry, a folder that is no repo, or a path the scan does not hold.
 */
export const offeredWorktree = (scan: ScanFile | undefined, path: string): ScannedWorktree | undefined => {
  if (!scan || typeof path !== "string" || path === "") return undefined;
  const key = norm(path);
  for (const r of scan.repos) {
    if (notARepo(r)) continue;
    const w = (r.worktrees ?? []).find((x) => isLinked(x) && norm(x.path) === key);
    if (w) return w;
  }
  return undefined;
};

/** True only for a path the last scan showed as a row, so the page cannot make the host act on anything else. */
export const isOfferedByScan = (scan: ScanFile | undefined, path: string): boolean => offeredWorktree(scan, path) !== undefined;

/** True when the last scan showed `path` as a row and its folder is there: a Missing row is never opened. */
export const isOpenableByScan = (scan: ScanFile | undefined, path: string): boolean => {
  const w = offeredWorktree(scan, path);
  return w !== undefined && !w.prunable;
};

/** One line above the groups, or empty: a first scan in progress, or a scan more than 24 hours old. */
export const worktreeNote = (scan: ScanFile | undefined, scanning: boolean, now: number): string => {
  if (!scan) return scanning ? "Reading worktrees for the first time" : "";
  const age = now - scan.scannedAt;
  return age > DAY_MS ? `Worktree scan is ${Math.floor(age / HOUR_MS)} hours old` : "";
};

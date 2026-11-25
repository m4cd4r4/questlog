// What the CLI and the panel both need to turn a scan into a list: which repos and worktrees are shown, in
// what order, and how a size and a count read. Pure, no vscode import and no entry-point code, so the
// extension bundle can import it (it must never import cli.ts, which runs code on import).
import { ago } from "../rows.ts";
import { repoNameOf, slugOf, UNREAD, VERDICT_LABEL } from "./names.ts";
import { FOLDER_NOT_FOUND } from "./run.ts";
import type { ScanFile, ScannedRepo, ScannedWorktree } from "./scan.ts";
import type { PrFacts, SizeFigure, Verdict } from "./verdict.ts";

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Sort order for names and slugs: by letter, without regard to case. */
export const byName = (a: string, b: string): number => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Entry = { main?: boolean; bare?: boolean; prunable?: boolean };

/** A linked worktree: not the main checkout and not a bare entry. Its folder may be gone. */
export const isLinked = (w: Entry): boolean => !w.main && !w.bare;

/** A linked worktree whose folder is there: the ones a scan enters. */
export const isEntered = (w: Entry): boolean => isLinked(w) && !w.prunable;

export type ListedWorktree = ScannedWorktree & { slug: string };
export type ListedRepo = Omit<ScannedRepo, "worktrees"> & { worktrees: ListedWorktree[] };

/** The order rows are listed in: Needs you, Busy, In flight, Orphan, Closable, Missing. */
export const ORDER: readonly Verdict[] = ["needs-you", "busy", "in-flight", "orphan", "closable", "missing"];

/** A worktree's place in ORDER; one with no verdict sorts last. */
export const rank = (w: ScannedWorktree) => {
  const i = w.verdict ? ORDER.indexOf(w.verdict.verdict) : -1;
  return i === -1 ? ORDER.length : i;
};

/** A row's verdict: the scanner's, or "unread" for a worktree the scan did not reach. */
export type RowVerdict = Verdict | "unread";

/** ORDER, then the worktrees the scan did not reach. */
export const ROW_ORDER: readonly RowVerdict[] = [...ORDER, "unread"];

export const rowVerdict = (w: ScannedWorktree): RowVerdict => (w.unread || !w.verdict ? "unread" : w.verdict.verdict);

const countWord = (v: RowVerdict, n: number) =>
  v === "needs-you" ? (n === 1 ? "needs you" : "need you") : v === "unread" ? UNREAD : VERDICT_LABEL[v];

/**
 * A repo's count line, "32 worktrees: 21 closable, 4 need you", with the verdicts counted in `order`. A zero
 * is left out, and a timed-out repo's line ends "(timed out)". The CLI's heading and the panel's block share it.
 */
export const countText = (verdicts: readonly RowVerdict[], order: readonly RowVerdict[], timedOut = false): string => {
  const parts: string[] = [];
  for (const v of order) {
    const n = verdicts.filter((x) => x === v).length;
    if (n > 0) parts.push(`${n} ${countWord(v, n)}`);
  }
  return `${plural(verdicts.length, "worktree", "worktrees")}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}${timedOut ? " (timed out)" : ""}`;
};

/** "#12 open", or "PR open" when GitHub gave no number; `lead` is what the number follows. Nothing for no PR or an unknown state. */
export const prText = (pr: PrFacts | undefined, lead = "#"): string | undefined =>
  !pr || pr.state === "none" || pr.state === "unknown" ? undefined : `${pr.number == null ? "PR" : `${lead}${pr.number}`} ${pr.state}`;

/** "just now" or "3d ago" for the last commit; nothing when its time was not read. */
export const lastCommitText = (at: unknown, now: number): string | undefined => {
  if (typeof at !== "number") return undefined;
  const age = ago(now - at);
  return age === "now" ? "just now" : `${age} ago`;
};

/** "1.2 GB" or "1.2 GB, shares node_modules"; nothing when the size was not measured or is unknown. */
export const sizeFact = (size: SizeFigure | "unknown" | undefined): string | undefined =>
  size === undefined || size === "unknown" ? undefined : `${sizeText(size.bytes)}${size.sharesNodeModules ? ", shares node_modules" : ""}`;

export type Filters = { closable?: boolean; repo?: string };

/**
 * A scanned folder that is no repo at all: it is gone, or git says it is not a repository. Session rows
 * name many such folders (100 gone and 39 plain ones on 2026-11-25), so they are counted, not listed.
 */
export const notARepo = (r: { error?: string }): boolean =>
  r.error === FOLDER_NOT_FOUND || /^fatal: not a git repository/i.test(r.error ?? "");

/**
 * What a list shows: per repo its linked worktrees (never the main checkout or a bare entry), sorted Needs
 * you, Busy, In flight, Orphan, Closable, Missing, then by slug. A repo with nothing left to show is dropped
 * unless it carries an error. `named` is how many scanned repos carry the name asked for with `repo`.
 */
export const select = (scan: ScanFile, filters: Filters = {}): { repos: ListedRepo[]; named: number; skipped: number } => {
  const wanted = filters.repo;
  const real = scan.repos.filter((r) => !notARepo(r));
  const skipped = scan.repos.length - real.length;
  const picked = wanted === undefined ? real : real.filter((r) => sameName(repoNameOf(r.path), wanted));
  const repos: ListedRepo[] = [];
  for (const r of picked) {
    const worktrees = (r.worktrees ?? [])
      .filter(isLinked)
      .filter((w) => !filters.closable || w.verdict?.verdict === "closable")
      .map((w): ListedWorktree => ({ ...w, slug: slugOf(w.path) }))
      .sort((a, b) => rank(a) - rank(b) || byName(a.slug, b.slug));
    if (worktrees.length === 0 && r.error === undefined) continue;
    repos.push({ ...r, worktrees });
  }
  return { repos, named: picked.length, skipped };
};

/** Bytes in the largest unit that keeps the number under 1024: "512 B", "1.2 GB", "340 MB". */
export const sizeText = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Math.max(0, bytes);
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${u === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
};

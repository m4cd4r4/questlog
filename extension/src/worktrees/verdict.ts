// One verdict per worktree from facts already gathered: pure logic, no vscode import, so node --test runs it directly.
import type { WorktreeRecord } from "./parse.ts";

/** What GitHub says about the branch's pull request. "none": asked, and there is none. "unknown": could not ask. */
export type PrState = "open" | "merged" | "closed" | "none" | "unknown";

export type PrFacts = { state: PrState; number?: number; headRefOid?: string };

/** A count that could not be worked out reads "unknown", and an unknown is never treated as zero. */
export type Count = number | "unknown";

/** Everything the verdict reads about one worktree. `collect` fills it; the server field arrives in phase 2. */
export type Facts = WorktreeRecord & {
  /** Uncommitted files, untracked ones included, because `git worktree remove` refuses on them. "unknown": the working tree could not be read. */
  dirty: Count;
  /** Tracked files modified, staged, deleted, renamed or conflicted. collect leaves it out for entries it never enters (the main checkout, bare and prunable ones); when absent, all of `dirty` counts as changed. */
  changed?: number;
  /** Untracked entries; a whole untracked folder is one entry. */
  untracked?: number;
  /** The first few dirty paths as git prints them, so a row can say what they are. */
  dirtySample?: string[];
  /** The scan stopped before this worktree was read; nothing else is known about it. */
  unread?: boolean;
  /** Commits on HEAD reachable from neither the upstream ref nor the pull request's head commit. */
  unpushed: Count;
  /** Stashes made on this branch. "unknown": the repo's stash list could not be read. */
  stashes: Count;
  /** Commits the branch has that the default branch does not. */
  ownCommits: Count;
  /** Time of the last commit, in ms; undefined when it could not be read. */
  lastCommitAt?: number;
  pr: PrFacts;
  /** A dev server listening from this folder. "unknown": no way to list servers. Undefined: none found, or not checked yet. */
  server?: { port: number } | "unknown";
  /** The brief the worktree registry names for this worktree; left out when the registry knows none. Never changes the verdict. */
  brief?: Brief;
  /** Other open worktrees of the repo that changed the same files; empty: none; left out: not compared, or its diff could not be read. Never changes the verdict. */
  overlaps?: Overlap[];
  /** Bytes on disk, links not followed. "unknown": not measured in time, or the folder could not be read. Left out: sizes were not asked for. Never changes the verdict. */
  size?: SizeFigure | "unknown";
};

/** A measured size. `key` is the folder's modified time plus its HEAD: while it is unchanged the figure is reused until it is too old. */
export type SizeFigure = { bytes: number; sharesNodeModules?: true; measuredAt: number; key: string };

/** One other worktree sharing changed files: its path, how many files, and the first few names. */
export type Overlap = { path: string; count: number; files: string[] };

/** "present": the brief file is on disk. "recoverable": the file is gone, the registry still holds its text. "lost": neither. */
export type Brief = "present" | "lost" | "recoverable";

export type Verdict = "missing" | "needs-you" | "busy" | "orphan" | "closable" | "in-flight";

export type VerdictResult = {
  verdict: Verdict;
  /** Why, in one line a sidebar can show. */
  reason: string;
  /** A Close button may be shown for this worktree. */
  closeOffered: boolean;
  /** It may be part of "Close all safe": closable, and its pull request was merged. */
  safeForBulk: boolean;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const prName = (pr: PrFacts) => (pr.number == null ? "PR" : `PR #${pr.number}`);
const CANNOT_TELL = "cannot tell whether everything was pushed";

const result = (verdict: Verdict, reason: string, closeOffered = false, safeForBulk = false): VerdictResult =>
  ({ verdict, reason, closeOffered, safeForBulk });

/**
 * The verdict for one worktree; the first row that matches wins, in the order of the plan's table:
 * missing, needs you, busy, orphan, closable, in flight. The main checkout and a bare entry get none,
 * so nothing can ever offer to close them. Closable needs a known zero of unpushed commits: when the
 * count is unknown the worktree stays in flight.
 */
export const verdictOf = (f: Facts): VerdictResult | undefined => {
  if (f.main || f.bare) return undefined;
  if (f.prunable) return result("missing", "folder is gone: run git worktree prune");

  if (f.unread) return result("in-flight", "not read yet");

  const unsaved: string[] = [];
  const untracked = f.untracked ?? 0;
  const changed = f.changed ?? (typeof f.dirty === "number" ? Math.max(0, f.dirty - untracked) : 0);
  if (changed > 0) unsaved.push(count(changed, "changed file", "changed files"));
  if (untracked > 0) unsaved.push(count(untracked, "untracked file", "untracked files"));
  if (typeof f.unpushed === "number" && f.unpushed > 0) unsaved.push(count(f.unpushed, "commit not pushed", "commits not pushed"));
  if (typeof f.stashes === "number" && f.stashes > 0) unsaved.push(count(f.stashes, "stash", "stashes"));
  if (unsaved.length > 0) return result("needs-you", unsaved.join(", "));

  if (f.server && f.server !== "unknown") return result("busy", `dev server on port ${f.server.port}`);
  if (f.locked) return result("busy", f.lockedReason ? `locked: ${f.lockedReason}` : "locked");

  // What could not be read is not clean: neither an orphan nor closable can be said of it.
  if (f.dirty === "unknown") return result("in-flight", "could not read the working tree");
  if (f.stashes === "unknown") return result("in-flight", "could not read the stash list");

  if (f.detached) {
    // Commits on a detached HEAD may be reachable from nowhere else, so orphan needs a known zero
    if (f.unpushed !== 0) return result("in-flight", "detached HEAD, cannot tell whether its commits are kept elsewhere");
    return result("orphan", "detached HEAD, clean", true);
  }

  const { pr } = f;
  if (pr.state === "unknown") return result("in-flight", "could not ask GitHub");
  if (pr.state === "open") return result("in-flight", `${prName(pr)} open`);
  if (pr.state === "merged" || pr.state === "closed") {
    const what = pr.state === "merged" ? "merged" : "closed without merging";
    if (f.unpushed !== 0) return result("in-flight", `${prName(pr)} ${what}, ${CANNOT_TELL}`);
    return result("closable", `${prName(pr)} ${what}, clean`, true, pr.state === "merged");
  }
  if (f.ownCommits === 0) return result("in-flight", "not started");
  if (f.unpushed !== 0) return result("in-flight", `no PR, ${CANNOT_TELL}`);
  return result("in-flight", "pushed, no PR yet");
};

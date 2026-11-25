// A plan's slices with the live facts of their worktrees: what the last scan says wins over what the registry
// last wrote. Pure, no vscode import. Nothing here changes a plan or the guard's input: it is a view.
import type { ParentPlan, Slice } from "../plans.ts";
import { labelOf } from "./names.ts";
import type { ScanFile } from "./scan.ts";
import type { Verdict } from "./verdict.ts";
import { offeredWorktree } from "./view.ts";

export type LiveFacts = {
  verdict: Verdict;
  /** Closable and the pull request merged: the work is in, and the folder can go. */
  done: boolean;
  /** The verdict's own reason when done ("PR #12 merged, clean"), else "<verdict in words>: <reason>". */
  why: string;
};

/**
 * What the last scan says of a slice's worktree. Nothing when there is nothing live to say: no scan, no
 * worktree on disk, the repo errored, the worktree is not in the scan, was not read yet, or has no verdict.
 */
export const liveFacts = (slice: Slice, scan: ScanFile | undefined): LiveFacts | undefined => {
  if (typeof slice.worktree !== "string" || slice.worktree === "") return undefined;
  const w = offeredWorktree(scan, slice.worktree);
  if (!w || w.unread || !w.verdict) return undefined;
  const { verdict, reason } = w.verdict;
  const done = verdict === "closable" && w.pr?.state === "merged";
  return { verdict, done, why: done ? reason : `${labelOf(w)}: ${reason}` };
};

/** A done slice is listed again only while its worktree still has work in it. */
const STILL_OPEN: ReadonlySet<Verdict> = new Set<Verdict>(["needs-you", "busy", "in-flight"]);

export type SliceView = {
  slice: Slice;
  /** Done by the registry, or by live facts; false for a registry-done slice that is listed again. */
  done: boolean;
  /** Shown on the plan card: open by the registry, or listed again. */
  listed: boolean;
  /** The registry calls it done, and its worktree on disk reads Needs you, Busy or In flight. */
  relisted: boolean;
  /** The line under the slice: the live reason when there is one, else the registry's. */
  why: string;
  /** The scanner's verdict for the slice's worktree, when there are live facts. */
  verdict?: Verdict;
};

/** Every slice of a plan, in the plan's order, as its card shows it. With no scan it is the registry's view. */
export const sliceViews = (p: ParentPlan, scan?: ScanFile): SliceView[] =>
  p.slices.map((slice): SliceView => {
    const live = liveFacts(slice, scan);
    if (slice.state === "done") {
      const relisted = live !== undefined && STILL_OPEN.has(live.verdict);
      return { slice, done: !relisted, listed: relisted, relisted, why: relisted ? `registry says ${slice.why}; ${live.why}` : slice.why, ...(live ? { verdict: live.verdict } : {}) };
    }
    return { slice, done: live?.done === true, listed: true, relisted: false, why: live ? live.why : slice.why, ...(live ? { verdict: live.verdict } : {}) };
  });

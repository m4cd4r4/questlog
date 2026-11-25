// `git worktree list --porcelain` into records: pure logic, no vscode import, so node --test runs it directly.
import { norm } from "../rows.ts";

/** One entry of `git worktree list --porcelain`. */
export type WorktreeRecord = {
  /** The folder, as git printed it. Compare two with `samePath`, or key a Set or Map by `norm` as scan.ts and repos.ts do; never `===`. */
  path: string;
  /** Branch name without `refs/heads/`; empty when detached or bare. */
  branch: string;
  /** The commit checked out; empty for a bare entry. */
  head: string;
  /** The repo's main checkout: the first entry git lists. It is never offered for closing. */
  main: boolean;
  detached: boolean;
  locked: boolean;
  /** Why it is locked, when git gave a reason. */
  lockedReason: string;
  bare: boolean;
  /** Git lists it but its folder is gone. */
  prunable: boolean;
  /** Why git calls it prunable, when it gave a reason. */
  prunableReason: string;
};

const HEADS = "refs/heads/";

/** Two spellings of one folder: either slash, any letter case, a trailing slash or not. */
export const samePath = (a: string, b: string) => norm(a) === norm(b);

/**
 * The records in the order git lists them, the main checkout first. Entries are separated by a blank
 * line; a block with no `worktree` line is dropped, and a line this does not know is ignored, so a
 * newer git that adds an attribute still parses.
 */
export const parseWorktreeList = (text: string): WorktreeRecord[] => {
  const records: WorktreeRecord[] = [];
  for (const block of text.split(/\r?\n(?:[ \t]*\r?\n)+/)) {
    let rec: WorktreeRecord | undefined;
    for (const line of block.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const space = line.indexOf(" ");
      const key = space === -1 ? line : line.slice(0, space);
      const value = space === -1 ? "" : line.slice(space + 1);
      if (key === "worktree") {
        if (!value) break;
        rec = {
          path: value, branch: "", head: "", main: records.length === 0,
          detached: false, locked: false, lockedReason: "", bare: false, prunable: false, prunableReason: "",
        };
        continue;
      }
      if (!rec) continue;
      if (key === "HEAD") rec.head = value;
      else if (key === "branch") rec.branch = value.startsWith(HEADS) ? value.slice(HEADS.length) : value;
      else if (key === "detached") rec.detached = true;
      else if (key === "bare") rec.bare = true;
      else if (key === "locked") { rec.locked = true; rec.lockedReason = value; }
      else if (key === "prunable") { rec.prunable = true; rec.prunableReason = value; }
    }
    if (rec) records.push(rec);
  }
  return records;
};

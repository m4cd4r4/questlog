// Which open worktrees of one repo changed the same files: pure logic, no vscode import, no git call of its own.
import type { Facts, Overlap, VerdictResult } from "./verdict.ts";

/** How many shared file names a pair carries; the count is always the whole number. */
export const OVERLAP_NAMES = 5;

/**
 * For every item, the other items it shares file names with: the other's path, how many names are shared and
 * the first `cap` of them in sorted order. Names are compared exactly as given, so two that differ only in
 * case are two files. Every item gets an entry, an empty list when it shares nothing; the lists are sorted
 * by the other item's path.
 */
export const findOverlaps = (items: readonly { path: string; files: readonly string[] }[], cap = OVERLAP_NAMES): Map<string, Overlap[]> => {
  const sets = items.map((it) => ({ path: it.path, files: new Set(it.files) }));
  const out = new Map<string, Overlap[]>(sets.map((s) => [s.path, []]));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const [small, large] = sets[i].files.size <= sets[j].files.size ? [sets[i], sets[j]] : [sets[j], sets[i]];
      const shared: string[] = [];
      for (const f of small.files) if (large.files.has(f)) shared.push(f);
      if (shared.length === 0) continue;
      // Code-unit order, not the machine's locale: the same names on every machine.
      shared.sort();
      const files = shared.slice(0, Math.max(0, cap));
      out.get(sets[i].path)!.push({ path: sets[j].path, count: shared.length, files });
      out.get(sets[j].path)!.push({ path: sets[i].path, count: shared.length, files: [...files] });
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
};

type Judged = Facts & { verdict?: VerdictResult };

/** Work still open: read, and needs you, in flight or busy, whatever its pull request says. */
const compared = (w: Judged): boolean => {
  const v = w.verdict?.verdict;
  return !w.unread && (v === "needs-you" || v === "in-flight" || v === "busy");
};

/**
 * The worktrees of one repo with `overlaps` set on each one that is compared and whose changed files are
 * known (`changedFiles`, keyed by worktree path as git listed it). Every other worktree is returned without
 * the field. The input is not changed and no verdict is read into or out of the result.
 */
export const markOverlaps = <T extends Judged>(worktrees: readonly T[], changedFiles: ReadonlyMap<string, readonly string[]>, cap = OVERLAP_NAMES): T[] => {
  const items = worktrees.filter((w) => compared(w) && changedFiles.has(w.path)).map((w) => ({ path: w.path, files: changedFiles.get(w.path)! }));
  const found = findOverlaps(items, cap);
  return worktrees.map((w) => {
    const overlaps = found.get(w.path);
    return overlaps ? { ...w, overlaps } : { ...w };
  });
};

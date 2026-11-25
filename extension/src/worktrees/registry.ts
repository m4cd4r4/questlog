// What the worktree registry says about a worktree's brief. Pure: no vscode, no fs; whether a file is there comes in as `exists`.
import { norm } from "../rows.ts";
import type { RegistryEntry } from "../plans.ts";
import type { Brief, Facts } from "./verdict.ts";

/** A registry date in ms; one that is missing or cannot be read ranks below every real date. */
const when = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** 1 when date `a` is newer than `b`, -1 when older, 0 when level (two unreadable dates are level). */
const newer = (a: unknown, b: unknown): number => {
  const x = when(a);
  const y = when(b);
  return x > y ? 1 : x < y ? -1 : 0;
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The registry entry that speaks for a worktree path. Two entries on one path: the newest `materialised_at`
 * wins, then the newest `created_at`, then the later one in the file.
 */
const entryFor = (worktreePath: string, entries: readonly RegistryEntry[]): RegistryEntry | undefined => {
  const key = norm(worktreePath);
  if (!key) return undefined;
  let best: RegistryEntry | undefined;
  for (const e of entries) {
    if (!e || typeof e.worktree_path !== "string" || norm(e.worktree_path) !== key) continue;
    if (!best) { best = e; continue; }
    // Not below on either date means newer or level, and level goes to the later one in the file.
    const order = newer(e.materialised_at, best.materialised_at) || newer(e.created_at, best.created_at);
    if (order >= 0) best = e;
  }
  return best;
};

/**
 * The state of a worktree's brief: "present" when its file is on disk, "recoverable" when the file is gone
 * but the registry still holds its text, "lost" when neither. Undefined when the registry does not know the
 * worktree or its entry names no brief file. An `exists` that throws counts as not there.
 */
export const briefOf = (worktreePath: string, entries: readonly RegistryEntry[], exists: (path: string) => boolean): Brief | undefined => {
  const e = entryFor(worktreePath, entries);
  if (!e) return undefined;
  const file = typeof e.brief_local_path === "string" ? e.brief_local_path : "";
  if (!file.trim()) return undefined;
  let there = false;
  try { there = exists(file) === true; } catch { /* not there */ }
  if (there) return "present";
  return text(e.brief_full_text) ? "recoverable" : "lost";
};

/** Each worktree with its `brief`, where the registry has one to report. The main checkout, bare and prunable entries get none. */
export const markBriefs = <T extends Facts>(worktrees: readonly T[], entries: readonly RegistryEntry[], exists: (path: string) => boolean): T[] =>
  worktrees.map((w) => {
    if (w.main || w.bare || w.prunable) return w;
    const brief = briefOf(w.path, entries, exists);
    return brief ? { ...w, brief } : w;
  });

// How much disk each worktree takes. No vscode import; the file system comes in through `SizeFs`.
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { norm } from "../rows.ts";
import type { Facts, SizeFigure } from "./verdict.ts";

/** One entry of a folder, as `readdir` with entry types gives it. */
export type SizeEntry = { name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean };

/** The parts of the file system the size walk needs, so a test can pass its own. `lstat` never follows a link. */
export type SizeFs = {
  readdir: (path: string) => Promise<SizeEntry[]>;
  lstat: (path: string) => Promise<{ size: number; mtimeMs: number }>;
};

export const realSizeFs: SizeFs = {
  readdir: (path) => readdir(path, { withFileTypes: true }),
  lstat: (path) => lstat(path),
};

export type WalkResult = {
  bytes: number;
  /** A `node_modules` that is a junction or symlink was met: it is counted as zero. */
  sharesNodeModules?: true;
  /** `shouldStop` said to stop before every folder was read; `bytes` is then only part of the total. */
  cutShort?: true;
  /** How many junctions and symlinks were met, at any depth and of any name; left out when there were none. None is followed. */
  links?: number;
  /** A folder could not be read and was skipped, so `bytes` and `links` may be short. */
  skipped?: true;
};

/** How many files of one folder are asked for their size at once. */
const BATCH = 64;

/**
 * The bytes of every regular file under `folder`. A junction or symlink is never followed and counts as
 * zero (node reports a Windows junction as a symbolic link). The `.git` file of a linked worktree is a
 * file like any other. A folder or file that cannot be read is skipped; nothing here throws.
 * `shouldStop` is asked before each folder is read. `onLink` is given the path of each link met.
 */
export const walkSize = async (folder: string, fs: SizeFs = realSizeFs, shouldStop: () => boolean = () => false, onLink?: (path: string) => void): Promise<WalkResult> => {
  let bytes = 0;
  let shares = false;
  let links = 0;
  let skipped = false;
  const seen = () => ({ ...(shares ? { sharesNodeModules: true as const } : {}), ...(links > 0 ? { links } : {}), ...(skipped ? { skipped: true as const } : {}) });
  const todo = [folder];
  while (todo.length > 0) {
    if (shouldStop()) return { bytes, ...seen(), cutShort: true };
    const dir = todo.pop()!;
    let entries: SizeEntry[];
    try { entries = await fs.readdir(dir); } catch { skipped = true; continue; }
    const files: string[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) {
        links++;
        onLink?.(join(dir, e.name));
        if (e.name === "node_modules") shares = true;
        continue;
      }
      if (e.isDirectory()) todo.push(join(dir, e.name));
      else if (e.isFile()) files.push(join(dir, e.name));
    }
    for (let i = 0; i < files.length; i += BATCH) {
      const sizes = await Promise.all(files.slice(i, i + BATCH).map((f) => fs.lstat(f).then((s) => s.size, () => 0)));
      for (const n of sizes) bytes += n;
    }
  }
  return { bytes, ...seen() };
};

/** What a figure is good for: the folder's own modified time and the commit checked out. */
export const sizeKey = (rootMtimeMs: number, head: string): string => `${Math.floor(rootMtimeMs)}:${head}`;

/** A figure from the last scan may stand in when its key is unchanged and it is younger than `maxAgeMs`. */
export const reusable = (previous: SizeFigure | "unknown" | undefined, key: string, now: number, maxAgeMs: number): previous is SizeFigure =>
  typeof previous === "object" && previous !== null && previous.key === key
  && typeof previous.measuredAt === "number" && now - previous.measuredAt < maxAgeMs && now - previous.measuredAt >= 0;

/** The last scan, as far as sizes need it. */
export type PreviousSizes = { repos: readonly { worktrees: readonly { path: string; size?: SizeFigure | "unknown" }[] }[] };

export type SizeOptions = {
  /** The last scan: its figures are reused where they still hold. */
  previous?: PreviousSizes;
  /** Time for all the walks of one scan together (default 15 seconds). Reuse is free and is not counted. */
  budgetMs?: number;
  /** A figure older than this is measured again whatever its key (default 24 hours). */
  maxAgeMs?: number;
  fs?: SizeFs;
  now?: () => number;
};

export const SIZE_BUDGET_MS = 15_000;
export const SIZE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * `size` for every worktree that has a folder of its own; the main checkout, a bare entry and one whose
 * folder is gone get none. Every worktree is first tried against the last scan, so a reused figure never
 * waits behind a walk; then the rest are walked one at a time until the budget runs out. What was not
 * reached, was cut short, or has a root that cannot be read reads "unknown". Returns new objects.
 */
export const measureSizes = async <T extends Facts>(worktrees: readonly T[], opts: SizeOptions = {}): Promise<T[]> => {
  const { previous, budgetMs = SIZE_BUDGET_MS, maxAgeMs = SIZE_MAX_AGE_MS, fs = realSizeFs, now = Date.now } = opts;
  const started = now();
  const spent = () => now() - started >= budgetMs;

  const before = new Map<string, SizeFigure | "unknown">();
  for (const r of previous?.repos ?? []) {
    for (const w of r.worktrees ?? []) if (w && typeof w.path === "string" && w.size !== undefined) before.set(norm(w.path), w.size);
  }

  const out = worktrees.map((w) => ({ ...w }));
  const toWalk: { i: number; key: string }[] = [];
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w.main || w.bare || w.prunable) continue;
    let key: string;
    try { key = sizeKey((await fs.lstat(w.path)).mtimeMs, w.head); } catch { w.size = "unknown"; continue; }
    const old = before.get(norm(w.path));
    if (reusable(old, key, now(), maxAgeMs)) w.size = { ...old };
    else toWalk.push({ i, key });
  }

  for (const { i, key } of toWalk) {
    if (spent()) { out[i].size = "unknown"; continue; }
    const walked = await walkSize(out[i].path, fs, spent);
    out[i].size = walked.cutShort
      ? "unknown"
      : { bytes: walked.bytes, ...(walked.sharesNodeModules ? { sharesNodeModules: true as const } : {}), measuredAt: now(), key };
  }
  return out;
};

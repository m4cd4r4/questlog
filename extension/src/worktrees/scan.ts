// Scan many repos and keep the result in one file. No vscode import; the outside world comes in through `run`.
import * as fsp from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { norm } from "../rows.ts";
import { collectRepo } from "./collect.ts";
import { parseWorktreeList } from "./parse.ts";
import { pool } from "./pool.ts";
import { verdictOf, type Facts, type VerdictResult } from "./verdict.ts";
import { failedText, ok, type Run } from "./run.ts";
import { markServers, type Listener, type ListServers } from "./servers.ts";
import { markBriefs } from "./registry.ts";
import { markOverlaps } from "./overlap.ts";
import { measureSizes, type SizeFs } from "./size.ts";
import { questlogDir } from "./sources.ts";
import type { RegistryEntry } from "../plans.ts";

export type ScannedWorktree = Facts & { verdict?: VerdictResult };

export type ScannedRepo = {
  /** The main checkout. */
  path: string;
  defaultBranch: string;
  /** The repo could not be read; `worktrees` is then empty. */
  error?: string;
  /** The time limit ran out; worktrees not reached are marked unread and read in flight. */
  timedOut?: boolean;
  /** How long the repo took to read. */
  tookMs: number;
  worktrees: ScannedWorktree[];
};

/** The cache file. No top-level `id` or `updatedAt`: nothing may mistake it for a session row. */
export type ScanFile = { version: 1; scannedAt: number; repos: ScannedRepo[] };

export type ScanOptions = {
  /** Time limit for one repo (default 20 seconds, as the plan states). */
  perRepoMs?: number;
  /** How many repos are read at once. */
  parallel?: number;
  /** Passed to collectRepo: how many worktrees of one repo are read at once (its default is 1). */
  worktreeParallel?: number;
  /**
   * Lists the dev servers running on this machine, given every worktree and main checkout folder of the scan.
   * Asked once per scan. Not passed: no `server` field is written. Nothing back, or a throw: every worktree
   * reads "unknown" and no verdict changes.
   */
  listServers?: ListServers;
  /** How long the lister may take (default 10 seconds). Past it the scan carries on as if it had returned nothing. */
  listServersMs?: number;
  /**
   * The worktree registry's entries and a way to ask whether a brief file is on disk. Passed: each worktree the
   * registry knows carries `brief` (the flag, never the text). Not passed: no `brief` field is written.
   */
  registry?: { entries: readonly RegistryEntry[]; exists: (path: string) => boolean };
  /**
   * Also say which open worktrees of a repo changed the same files (`overlaps`). Costs two more git calls per
   * open worktree. The file lists are held only while the scan runs and never reach the result.
   */
  overlap?: boolean;
  /**
   * Also measure each worktree's size on disk (`size`), after everything else is in, for the whole scan under
   * one time budget. `previous` is the last scan: a figure whose key still holds is reused without a walk.
   * Defaults: 15 seconds and 24 hours. Not passed: no `size` field is written.
   */
  size?: { previous?: ScanFile; budgetMs?: number; maxAgeMs?: number; fs?: SizeFs };
  now?: () => number;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || "scan failed";

/**
 * Every worktree of every repo reachable from `folders`, each repo read once. A repo named by its main
 * checkout and by two of its worktrees is one entry: each folder is first asked for its main checkout (one
 * git call), and the full read runs once per main checkout. A repo that fails or throws keeps its place
 * with an `error` and never loses the others. Past `perRepoMs` a repo stops reading: what it gathered is
 * kept, it is marked `timedOut`, and the worktrees it did not reach carry unknown facts.
 */
export const scanRepos = async (folders: readonly string[], run: Run, opts: ScanOptions = {}): Promise<ScanFile> => {
  const { perRepoMs = 20_000, parallel = 4, worktreeParallel, listServers, listServersMs = 10_000, registry, overlap = false, size, now = Date.now } = opts;

  // Which main checkout each folder belongs to.
  type Found = { folder: string; main?: string; error?: string };
  const found = await pool(folders, parallel, async (folder): Promise<Found> => {
    try {
      const listed = await run("git", ["worktree", "list", "--porcelain"], { cwd: folder, timeoutMs: 10_000 });
      if (!ok(listed)) {
        return { folder, error: failedText("git worktree list", listed) };
      }
      return { folder, main: parseWorktreeList(listed.stdout)[0]?.path ?? folder };
    } catch (e) {
      return { folder, error: message(e) };
    }
  });

  const seen = new Set<string>();
  const targets: Found[] = [];
  for (const f of found) {
    const key = norm(f.main ?? f.folder);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(f);
  }

  // The facts first, for every repo; verdicts wait until the servers are known, because busy reads them.
  type Read = Omit<ScannedRepo, "worktrees"> & { worktrees: Facts[] };
  // The files each open worktree changed, per repo: held here and never put on a repo that is returned.
  const changed = new Map<string, Map<string, string[]>>();
  const read = await pool(targets, parallel, async (t): Promise<Read> => {
    const started = now();
    const path = t.main ?? t.folder;
    if (t.error !== undefined) return { path, defaultBranch: "", error: t.error, tookMs: now() - started, worktrees: [] };
    try {
      const r = await collectRepo(path, run, {
        stop: () => now() - started > perRepoMs,
        ...(worktreeParallel === undefined ? {} : { worktreeParallel }),
        ...(overlap ? { changedFiles: true } : {}),
      });
      const mainPath = r.worktrees.find((w) => w.main)?.path ?? path;
      if (r.changedFiles && !changed.has(norm(mainPath))) changed.set(norm(mainPath), r.changedFiles);
      return {
        path: mainPath,
        defaultBranch: r.defaultBranch,
        ...(r.error !== undefined ? { error: r.error } : {}),
        ...(r.stopped ? { timedOut: true } : {}),
        tookMs: now() - started,
        worktrees: r.worktrees,
      };
    } catch (e) {
      return { path, defaultBranch: "", error: message(e), tookMs: now() - started, worktrees: [] };
    }
  });

  // Belt and braces: two folders that named different main paths for one repo still give one entry.
  const byMain = new Map<string, Read>();
  for (const r of read) if (!byMain.has(norm(r.path))) byMain.set(norm(r.path), r);
  const kept = [...byMain.values()];

  // One look at the machine's listening ports for the whole scan. A lister that fails is "could not look".
  let listeners: Listener[] | undefined;
  if (listServers) {
    // The lister is the caller's and may never answer: past its limit the scan goes on without it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), Math.max(0, listServersMs)); });
      const asked = listServers(kept.flatMap((r) => r.worktrees.filter((w) => !w.bare && !w.prunable).map((w) => w.path)));
      const got = await Promise.race([asked, late]);
      if (Array.isArray(got)) listeners = got;
    } catch { /* stays undefined */ } finally {
      clearTimeout(timer);
    }
  }

  const repos = kept.map((r): ScannedRepo => {
    const judged = (listServers ? markServers(r.worktrees, listeners) : r.worktrees).map((w): ScannedWorktree => {
      const verdict = verdictOf(w);
      return verdict ? { ...w, verdict } : { ...w };
    });
    // After the verdicts: the brief and the overlaps are facts for the row and never change one.
    const briefed = registry ? markBriefs(judged, registry.entries, registry.exists) : judged;
    const files = overlap ? changed.get(norm(r.path)) : undefined;
    return { ...r, worktrees: files ? markOverlaps(briefed, files) : briefed };
  });
  if (size) {
    // Last of all, and for every repo together: one budget, and reuse before any walk.
    const sized = await measureSizes(repos.flatMap((r) => r.worktrees), { ...size, now });
    let at = 0;
    for (const r of repos) r.worktrees = sized.slice(at, (at += r.worktrees.length));
  }
  return { version: 1, scannedAt: now(), repos };
};

/** The parts of node:fs/promises the cache needs, so a test can pass its own. */
export type FsLike = {
  mkdir: (path: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (path: string, data: string) => Promise<unknown>;
  rename: (from: string, to: string) => Promise<unknown>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
};

const nodeFs: FsLike = {
  mkdir: (p, o) => fsp.mkdir(p, o),
  writeFile: (p, d) => fsp.writeFile(p, d),
  rename: (a, b) => fsp.rename(a, b),
  readFile: (p, e) => fsp.readFile(p, e),
};

/** The cache file's name, inside the `worktrees` subfolder of Questlog's folder. */
export const SCAN_CACHE_FILE = "scan.cache";

/** `worktrees/scan.cache` in Questlog's folder: a subfolder and not a `.json` name, so the session-row readers never parse it. */
export const defaultScanPath = (env: Record<string, string | undefined> = process.env, home: string = homedir()): string =>
  join(questlogDir(env, home), "worktrees", SCAN_CACHE_FILE);

/**
 * Write the whole file or none of it: a temp file beside it, then a rename. `tag` keeps two writers' temp
 * files apart. Nothing here blocks, so the extension host can call it.
 */
export const writeWhole = async (file: string, text: string, fs: FsLike = nodeFs, tag: string = `${process.pid}.${Date.now()}`): Promise<void> => {
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${tag}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
};

export const writeScan = (file: string, data: ScanFile, fs: FsLike = nodeFs): Promise<void> => writeWhole(file, JSON.stringify(data), fs);

/** The cache parsed, or undefined when it is damaged or from another version. */
export const parseScan = (text: string): ScanFile | undefined => {
  try {
    const v = JSON.parse(text) as Partial<ScanFile> | null;
    if (!v || typeof v !== "object" || v.version !== 1 || typeof v.scannedAt !== "number" || !Array.isArray(v.repos)) return undefined;
    return v as ScanFile;
  } catch {
    return undefined;
  }
};

/** The cache, or undefined when it is missing, damaged or from another version. */
export const readScan = async (file: string, fs: Pick<FsLike, "readFile"> = nodeFs): Promise<ScanFile | undefined> => {
  try {
    return parseScan(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** The parts of node:fs/promises the cached reader needs. */
export type ScanReadFs = Pick<FsLike, "readFile"> & { stat: (path: string) => Promise<{ mtimeMs: number; size: number }> };

const nodeReadFs: ScanReadFs = { readFile: nodeFs.readFile, stat: (p) => fsp.stat(p) };

/**
 * A reader for the cache that parses it again only when the file's modified time or size changes, as
 * Refresher does for the registry: the sidebar asks on every refresh. No file: nothing, and nothing is kept.
 */
export const scanReader = (fs: ScanReadFs = nodeReadFs): ((file: string) => Promise<ScanFile | undefined>) => {
  let cache: { file: string; mtimeMs: number; size: number; scan: ScanFile | undefined } | undefined;
  return async (file) => {
    let mtimeMs: number;
    let size: number;
    try {
      ({ mtimeMs, size } = await fs.stat(file));
    } catch {
      cache = undefined;
      return undefined;
    }
    if (cache?.file === file && cache.mtimeMs === mtimeMs && cache.size === size) return cache.scan;
    const scan = await readScan(file, fs);
    cache = { file, mtimeMs, size, scan };
    return scan;
  };
};

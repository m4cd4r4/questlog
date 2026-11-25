// One full scan from the two lists to the cache file: what `questlog-wt scan` runs, and what the sidebar's
// timer will run. No vscode import and no blocking call: the extension host runs this too. The caller hands
// in the session folders and the registry entries; the CLI reads them itself, the extension passes what its
// Refresher already holds.
import { access } from "node:fs/promises";
import { norm } from "../rows.ts";
import type { RegistryEntry } from "../plans.ts";
import { repoList } from "./repos.ts";
import type { Run } from "./run.ts";
import { readScan, scanRepos, writeScan, type FsLike, type ScanFile } from "./scan.ts";
import type { ListServers } from "./servers.ts";
import type { SizeFs } from "./size.ts";

export type RefreshOptions = {
  /** Each session row's `cwd`: folders to scan. */
  sessionCwds: readonly (string | undefined)[];
  /** The worktree registry's entries: their `repo_path` values are folders to scan, and they give the briefs. */
  entries: readonly RegistryEntry[];
  /** The cache file: read for the last sizes, then written whole. */
  cachePath: string;
  run: Run;
  /** Lists the dev servers of this machine; the CLI passes the real lister. */
  listServers: ListServers;
  /** Passed to the scan when given; its defaults are the plan's values. */
  worktreeParallel?: number;
  perRepoMs?: number;
  now?: () => number;
  /** Reads and writes the cache. */
  fs?: FsLike;
  /** Walks folders for their size. */
  sizeFs?: SizeFs;
  /** Whether a file is on disk; asked once per brief file the registry names, before the scan. */
  exists?: (path: string) => Promise<boolean>;
};

const there = (p: string) => access(p).then(() => true, () => false);

/**
 * Scan every repo the session folders and the registry name, with all four extra facts (dev server, brief,
 * file overlap, size), and write the result to `cachePath`. Sizes from the cache already there are reused
 * where they still hold. Returns what it wrote. A write that fails rejects; nothing else here does.
 */
export const refreshScan = async (opts: RefreshOptions): Promise<ScanFile> => {
  const { sessionCwds, entries, cachePath, run, listServers, worktreeParallel, perRepoMs, now = Date.now, fs, sizeFs, exists = there } = opts;

  const folders = repoList({ sessionCwds: [...sessionCwds], registryRepoPaths: entries.map((e) => e?.repo_path) });
  // Which brief files are on disk, asked here without blocking; the scan then looks the answer up.
  const briefFiles = [...new Set(entries.map((e) => e?.brief_local_path).filter((p): p is string => typeof p === "string" && p !== ""))];
  const found = new Set<string>();
  // An `exists` that throws or rejects counts as not there, as the scan's own check does.
  await Promise.all(briefFiles.map(async (p) => { if (await Promise.resolve().then(() => exists(p)).catch(() => false)) found.add(norm(p)); }));
  const previous = await readScan(cachePath, fs);

  const scan = await scanRepos(folders, run, {
    listServers,
    registry: { entries, exists: (p) => found.has(norm(p)) },
    overlap: true,
    size: { ...(previous ? { previous } : {}), ...(sizeFs ? { fs: sizeFs } : {}) },
    ...(worktreeParallel === undefined ? {} : { worktreeParallel }),
    ...(perRepoMs === undefined ? {} : { perRepoMs }),
    now,
  });
  await writeScan(cachePath, scan, fs);
  return scan;
};

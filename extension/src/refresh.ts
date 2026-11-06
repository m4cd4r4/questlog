// What one refresh of the panel reads from disk: the session rows and closes, the note, the dismissed list and the
// plans. No vscode import, so node --test can time it.
//
// The rows folder held 1,063 files on 2026-11-04. Reading them all synchronously on every watcher burst and every
// 30 s tick blocked the shared extension host (VS Code's profiler blamed Questlog; 40 host profiles put 5.4 s in
// `update`). Now the folder is held in memory: the first refresh reads it whole, later ones reread only the files
// the watcher named, and every read is async. A full rescan happens only when the watcher could not say what changed.
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { LiveState } from "./live.ts";
import { plansFromRegistry, type ParentPlan, type RegistryEntry } from "./plans.ts";
import {
  checkClose, CLOSE_EXT, closeFrom, dismissedFrom, hasWorkLeft, isCheckablePath, isRow, isStale, NOTE_FILE, noteLines, PARKED_MS, stepsOf, withCloses,
  type Close, type Dismissed, type Row,
} from "./rows.ts";

export type RefreshInput = { now: number; live: ReadonlyMap<string, LiveState> | undefined; registryPath: string; resumeCommand: string };
export type Snapshot = { rows: Row[]; note: string[]; dismissed: Dismissed; plans: ParentPlan[] };

export const DISMISSED_FILE = "dismissed.json";
// Open at most this many files at once: a first read of 1,000 would otherwise ask for 1,000 handles
const BATCH = 32;
// Freshness is size plus mtime, which misses a same-length rewrite inside one mtime tick (1-2 s on FAT, SMB, some WSL
// mounts). A rescan rereads every row updated this recently regardless; longer than the 5-minute rescan, so none slips between two.
export const RECENT_MS = 10 * 60 * 1000;

type Entry = { mtimeMs: number; size: number; row?: Row; close?: Close; text?: string };

const accept = (n: string) => n.endsWith(".json") || n.endsWith(CLOSE_EXT) || n === NOTE_FILE;

/** True when the path is there. Async, so a slow or missing drive never holds the host. */
export const pathThere = (p: string) => access(p).then(() => true, () => false);

/** Run `fn` over `items`, BATCH at a time. */
async function batched<T, R>(items: readonly T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(...(await Promise.all(items.slice(i, i + BATCH).map(fn))));
  return out;
}

/** A step check path resolved for one row: absolute as given, else inside the session's folder. Undefined when it may not be looked at. */
const checkPath = (r: Row, p: string) => (!isCheckablePath(p) ? undefined : isAbsolute(p) ? p : r.cwd ? join(r.cwd, p) : undefined);

export class Refresher {
  private entries = new Map<string, Entry>();
  private dirty = new Set<string>();
  private full = true;
  private seenDir = "";
  private loading: Promise<void> | null = null;
  private registryCache: { path: string; mtimeMs: number; size: number; entries: RegistryEntry[] } | undefined;
  private readonly dir: () => string;
  private readonly onWriteError: (e: unknown) => void;

  constructor(dir: () => string, onWriteError: (e: unknown) => void = () => undefined) {
    this.dir = dir;
    this.onWriteError = onWriteError;
  }

  /** The watcher saw `name` change. With no name (the watcher errored, restarted or could not say), the next refresh rescans the folder. */
  changed(name?: string | null) {
    if (name) this.dirty.add(basename(name));
    else this.full = true;
  }

  /** Bring the in-memory folder up to date. A change that lands while a read runs is taken by the next one, not dropped. */
  private async sync(now: number) {
    for (;;) {
      if (this.loading) await this.loading;
      else if (this.full || this.dirty.size || this.dir() !== this.seenDir) this.loading = this.load(now).finally(() => (this.loading = null));
      else return;
    }
  }

  private async load(now: number) {
    const dir = this.dir();
    if (dir !== this.seenDir) {
      this.entries.clear();
      this.full = true;
      this.seenDir = dir;
    }
    let names: string[];
    const rescan = this.full;
    if (this.full) {
      this.full = false;
      this.dirty.clear();
      names = (await readdir(dir).catch(() => [] as string[])).filter(accept);
      const listed = new Set(names);
      for (const n of this.entries.keys()) if (!listed.has(n)) this.entries.delete(n);
    } else {
      names = [...this.dirty].filter(accept);
      this.dirty.clear();
    }
    const recent = (n: string) => { const r = this.entries.get(n)?.row; return r !== undefined && now - r.updatedAt < RECENT_MS; };
    await batched(names, (n) => this.reread(n, rescan && recent(n)));
  }

  /** Read one file again if its size or mtime moved, or always when `force`. */
  private async reread(name: string, force: boolean) {
    const path = join(this.seenDir, name);
    let s;
    try {
      s = await stat(path);
    } catch {
      this.entries.delete(name);
      return;
    }
    const hit = this.entries.get(name);
    if (!force && hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return;
    const e: Entry = { mtimeMs: s.mtimeMs, size: s.size };
    try {
      const text = await readFile(path, "utf8");
      if (name.endsWith(CLOSE_EXT)) e.close = closeFrom(text);
      else if (name === NOTE_FILE || name === DISMISSED_FILE) e.text = text;
      else {
        const v: unknown = JSON.parse(text);
        if (isRow(v)) e.row = v;
      }
    } catch {
      // Half-written, or held by another process: not remembered, so the next change event or rescan reads it again
      this.entries.delete(name);
      return;
    }
    this.entries.set(name, e);
  }

  /** The rows and the closes beside them, not yet joined, as of the last sync. */
  private current() {
    const rows: Row[] = [];
    const closes = new Map<string, Close>();
    for (const [n, e] of this.entries) {
      if (e.row) rows.push(e.row);
      else if (e.close) closes.set(n.slice(0, -CLOSE_EXT.length), e.close);
    }
    return { rows, closes };
  }

  /** One session's row and close read from disk now, not from memory: the hand-close checks them after its prompts. */
  async fresh(id: string): Promise<{ row: Row | undefined; close: Close | undefined }> {
    await this.sync(Date.now());
    await Promise.all([this.reread(`${id}.json`, true), this.reread(`${id}${CLOSE_EXT}`, true)]);
    return { row: this.entries.get(`${id}.json`)?.row, close: this.entries.get(`${id}${CLOSE_EXT}`)?.close };
  }

  async refresh({ now, live, registryPath, resumeCommand }: RefreshInput): Promise<Snapshot> {
    await this.sync(now);
    const { rows, closes } = this.current();
    await this.runChecks(rows, closes, now, live);
    const text = (n: string) => this.entries.get(n)?.text;
    const note = noteLines(text(NOTE_FILE) ?? "");
    const dismissed = dismissedFrom(text(DISMISSED_FILE) ?? "");
    return { rows: withCloses(rows, closes), note, dismissed, plans: await this.readPlans(registryPath, now, resumeCommand) };
  }

  /** Cards whose session is gone close themselves once every open step's path checks out; a close already on disk, undone or not, holds. */
  private async runChecks(rows: readonly Row[], closes: Map<string, Close>, now: number, live: ReadonlyMap<string, LiveState> | undefined) {
    // The same rows checkClose would look at: only their step paths are checked, all at once and async
    const candidates = rows.filter((r) => {
      const gone = r.ended || isStale(r, now) || (live !== undefined && !live.has(r.id));
      const prior = closes.get(r.id);
      return gone && hasWorkLeft(r) && !r.continuedIn && now - r.updatedAt < PARKED_MS && prior?.rowReportedAt !== (r.reportedAt ?? r.updatedAt);
    });
    if (candidates.length === 0) return;
    const paths = new Set<string>();
    for (const r of candidates) {
      for (const s of stepsOf(r)) {
        const c = s.status !== "done" ? s.check : undefined;
        const p = c && ("exists" in c ? c.exists : c.gone);
        const at = typeof p === "string" && p ? checkPath(r, p) : undefined;
        if (at) paths.add(at);
      }
    }
    const list = [...paths];
    const found = await batched(list, pathThere);
    const there = new Map(list.map((p, i) => [p, found[i]]));
    for (const r of candidates) {
      const c = checkClose(r, now, (p) => { const at = checkPath(r, p); return at === undefined ? undefined : there.get(at); }, closes.get(r.id));
      if (!c) continue;
      try {
        await writeFile(join(this.seenDir, `${r.id}${CLOSE_EXT}`), JSON.stringify(c));
        // So a refresh before the watcher's event does not write the same close again
        this.changed(`${r.id}${CLOSE_EXT}`);
      } catch (e) {
        this.onWriteError(e);
      }
      closes.set(r.id, c);
    }
  }

  /** The registry runs to megabytes: it is read and parsed again only when its size or mtime moves. */
  private async readRegistry(path: string): Promise<RegistryEntry[]> {
    try {
      const { mtimeMs, size } = await stat(path);
      const hit = this.registryCache;
      if (hit?.path === path && hit.mtimeMs === mtimeMs && hit.size === size) return hit.entries;
      const v = JSON.parse(await readFile(path, "utf8")) as { entries?: unknown };
      const entries = Array.isArray(v.entries) ? (v.entries as RegistryEntry[]) : [];
      this.registryCache = { path, mtimeMs, size, entries };
      return entries;
    } catch {
      // no registry (plans are optional), or one being rewritten: keep what was read last
      return this.registryCache?.path === path ? this.registryCache.entries : [];
    }
  }

  private async readPlans(registryPath: string, now: number, resumeCommand: string) {
    const entries = await this.readRegistry(registryPath);
    // plansFromRegistry asks whether worktrees exist: look them all up first, async, then answer from the list
    const wanted = [...new Set(entries.filter((e) => e?.slug && e.plan && e.worktree_path).map((e) => e.worktree_path!))];
    const found = new Set<string>();
    (await batched(wanted, pathThere)).forEach((v, i) => v && found.add(wanted[i]));
    return plansFromRegistry(entries, { now, exists: (p) => found.has(p), resumeCommand });
  }
}

/** The live cache, swapped in whole by whichever window asked last. Not a .json file, so it is never read as a row. */
export const LIVE_CACHE_FILE = "live.cache";

export const readText = (path: string) => readFile(path, "utf8").catch(() => undefined);

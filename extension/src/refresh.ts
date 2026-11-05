// What one refresh of the panel reads from disk: the session rows and closes, the note, the dismissed list and the
// plans. No vscode import, so node --test can time it.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { LiveState } from "./live.ts";
import { plansFromRegistry, type ParentPlan, type RegistryEntry } from "./plans.ts";
import { checkClose, CLOSE_EXT, closeFrom, dismissedFrom, isCheckablePath, isRow, isStale, NOTE_FILE, noteLines, withCloses, type Close, type Dismissed, type Row } from "./rows.ts";

export type RefreshInput = { now: number; live: ReadonlyMap<string, LiveState> | undefined; registryPath: string; resumeCommand: string };
export type Snapshot = { rows: Row[]; note: string[]; dismissed: Dismissed; plans: ParentPlan[] };

export class Refresher {
  private registryCache: { path: string; mtimeMs: number; entries: RegistryEntry[] } | undefined;

  private readonly dir: () => string;
  private readonly onWriteError: (e: unknown) => void;

  constructor(dir: () => string, onWriteError: (e: unknown) => void = () => undefined) {
    this.dir = dir;
    this.onWriteError = onWriteError;
  }

  /** The watcher saw `name` change; with no name anything may have. */
  changed(_name?: string) {}

  /** The rows and the closes beside them, not yet joined. */
  readRows(): { rows: Row[]; closes: Map<string, Close> } {
    const rows: Row[] = [];
    const closes = new Map<string, Close>();
    let names: string[];
    try {
      names = readdirSync(this.dir());
    } catch {
      return { rows, closes };
    }
    for (const n of names) {
      try {
        const text = n.endsWith(".json") || n.endsWith(CLOSE_EXT) ? readFileSync(join(this.dir(), n), "utf8") : "";
        if (n.endsWith(CLOSE_EXT)) {
          const c = closeFrom(text);
          if (c) closes.set(n.slice(0, -CLOSE_EXT.length), c);
        } else if (text) {
          const v: unknown = JSON.parse(text);
          if (isRow(v)) rows.push(v);
        }
      } catch {
        // half-written file; the next change event reads it whole
      }
    }
    return { rows, closes };
  }

  async refresh({ now, live, registryPath, resumeCommand }: RefreshInput): Promise<Snapshot> {
    const { rows, closes } = this.readRows();
    for (const r of rows) {
      const gone = r.ended || isStale(r, now) || (live !== undefined && !live.has(r.id));
      if (!gone) continue;
      const exists = (p: string) => (!isCheckablePath(p) ? undefined : isAbsolute(p) ? existsSync(p) : r.cwd ? existsSync(join(r.cwd, p)) : undefined);
      const c = checkClose(r, now, exists, closes.get(r.id));
      if (!c) continue;
      try {
        writeFileSync(join(this.dir(), `${r.id}${CLOSE_EXT}`), JSON.stringify(c));
      } catch (e) {
        this.onWriteError(e);
      }
      closes.set(r.id, c);
    }
    let note: string[] = [];
    try {
      note = noteLines(readFileSync(join(this.dir(), NOTE_FILE), "utf8"));
    } catch {}
    let dismissed: Dismissed = {};
    try {
      dismissed = dismissedFrom(readFileSync(join(this.dir(), "dismissed.json"), "utf8"));
    } catch {}
    return { rows: withCloses(rows, closes), note, dismissed, plans: plansFromRegistry(this.readRegistry(registryPath), { now, exists: existsSync, resumeCommand }) };
  }

  private readRegistry(path: string): RegistryEntry[] {
    try {
      const { mtimeMs } = statSync(path);
      if (this.registryCache?.path === path && this.registryCache.mtimeMs === mtimeMs) return this.registryCache.entries;
      const v = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown };
      const entries = Array.isArray(v.entries) ? (v.entries as RegistryEntry[]) : [];
      this.registryCache = { path, mtimeMs, entries };
      return entries;
    } catch {
      return this.registryCache?.path === path ? this.registryCache.entries : [];
    }
  }
}

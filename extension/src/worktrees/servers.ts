// Which worktree a dev server is running in: pure logic, no vscode import, nothing read from the machine here.
// The lists come in from outside (servers-real.ts reads them); this file only decides what they mean.
import { inside, norm } from "../rows.ts";
import { isEntered } from "./listing.ts";
import type { Facts } from "./verdict.ts";

/** A port something is listening on, and the folder that process runs in. */
export type Listener = { port: number; folder: string };

/** Given every folder the scan knows, every listener that could be tied to one, or nothing when there was no way to look. */
export type ListServers = (knownFolders: string[]) => Promise<Listener[] | undefined>;

/** One row of the OS port table. */
export type PortRow = { port: number; pid: number };

/** One process: its parent and the command line it was started with. */
export type Proc = { pid: number; ppid: number; commandLine: string };

/** Of `folders`, the one with the longest path that holds `path`; undefined when none does. */
export const holderOf = (path: string, folders: readonly string[]): string | undefined => {
  let best: string | undefined;
  for (const f of folders) {
    if (!f || !inside(path, f)) continue;
    if (best === undefined || norm(f).length > norm(best).length) best = f;
  }
  return best;
};

/**
 * The worktrees of one repo with `server` filled in. With no list (there was no way to look) every
 * entered worktree reads "unknown". Otherwise a listener belongs to the entry with the longest path that
 * holds its folder, the main checkout included, so a server in the main checkout marks no worktree and a
 * worktree nested inside the main checkout still gets its own. The main checkout, a bare entry and a
 * worktree whose folder is gone never carry the field. Several listeners in one worktree: the lowest port.
 */
export const markServers = <T extends Facts>(worktrees: readonly T[], listeners: readonly Listener[] | undefined): T[] => {
  const entered = isEntered;
  const bare = (w: T): T => {
    const copy = { ...w };
    delete copy.server;
    return copy;
  };
  if (listeners === undefined) return worktrees.map((w) => (entered(w) ? { ...bare(w), server: "unknown" as const } : bare(w)));

  const paths = worktrees.map((w) => w.path);
  const portOf = new Map<string, number>();
  for (const l of listeners) {
    const owner = holderOf(l.folder, paths);
    if (owner === undefined) continue;
    const key = norm(owner);
    const had = portOf.get(key);
    if (had === undefined || l.port < had) portOf.set(key, l.port);
  }
  return worktrees.map((w) => {
    const port = entered(w) ? portOf.get(norm(w.path)) : undefined;
    return port === undefined ? bare(w) : { ...bare(w), server: { port } };
  });
};

const unique = (rows: PortRow[]): PortRow[] => {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.port}:${r.pid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The listening rows of `netstat -ano` on Windows, IPv4 (`0.0.0.0:3000`) and IPv6 (`[::]:3000`), each port and pid once. */
export const parseNetstat = (text: string): PortRow[] => {
  const rows: PortRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (m) rows.push({ port: Number(m[1]), pid: Number(m[2]) });
  }
  return unique(rows);
};

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn`: a `p<pid>` line, then an `n<address>:<port>` line for each of its sockets. */
export const parseLsofListen = (text: string): PortRow[] => {
  const rows: PortRow[] = [];
  let pid: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    const m = /^n.*:(\d+)$/.exec(line);
    if (m && pid !== undefined) rows.push({ port: Number(m[1]), pid });
  }
  return unique(rows);
};

/** `lsof -a -p <pid> -d cwd -Fn`: the folder the process runs in, on its `n` line. */
export const parseLsofCwd = (text: string): string | undefined => {
  const line = text.split(/\r?\n/).find((l) => l.startsWith("n") && l.length > 1);
  return line?.slice(1);
};

/** `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json`: a list, or one object when there is one process. */
export const parseProcessTable = (text: string): Proc[] => {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out: Proc[] = [];
  for (const p of list as Record<string, unknown>[]) {
    if (!p || typeof p !== "object" || typeof p.ProcessId !== "number") continue;
    out.push({
      pid: p.ProcessId,
      ppid: typeof p.ParentProcessId === "number" ? p.ParentProcessId : 0,
      commandLine: typeof p.CommandLine === "string" ? p.CommandLine : "",
    });
  }
  return out;
};

/** How far up the parent chain a folder is looked for. */
const MAX_LEVELS = 8;

type Named = {
  /** The known folder of the first path with no `node_modules` part. */
  plain?: string;
  /** The known folder of the first path that has a `node_modules` part. */
  viaModules?: string;
};

/**
 * The known folders one command line names, by the first place a path inside a known folder starts; of
 * the known folders that start at one place the longest wins. Paths with a `node_modules` part are kept
 * apart from the rest (`node_modules/.bin/../vite/bin/vite.js` counts as one), because through a junctioned
 * `node_modules` such a path names the main checkout and not the worktree the program was started in.
 */
const namedIn = (commandLine: string, known: readonly string[]): Named => {
  const text = commandLine.replace(/\\/g, "/").toLowerCase();
  type Hit = { at: number; length: number; folder: string };
  let plain: Hit | undefined;
  let viaModules: Hit | undefined;
  const better = (had: Hit | undefined, at: number, length: number) => !had || at < had.at || (at === had.at && length > had.length);
  for (const folder of known) {
    const k = norm(folder);
    if (!k) continue;
    let gotPlain = false;
    let gotModules = false;
    for (let at = text.indexOf(k); at >= 0 && !(gotPlain && gotModules); at = text.indexOf(k, at + 1)) {
      const before = at === 0 ? " " : text[at - 1];
      const after = at + k.length >= text.length ? " " : text[at + k.length];
      // The folder's name must be whole: `/work/acme-app` is not in `/work/acme-app-old` or `/x/work/acme-app`.
      if (!/[\s"'=]/.test(before) || !/[\s"'/]/.test(after)) continue;
      const close = before === '"' || before === "'" ? before : undefined;
      const rest = text.slice(at);
      const stop = close ? rest.indexOf(close) : rest.search(/[\s"']/);
      const path = stop < 0 ? rest : rest.slice(0, stop);
      if (/(^|\/)node_modules(\/|$)/.test(path)) {
        if (!gotModules && better(viaModules, at, k.length)) viaModules = { at, length: k.length, folder };
        gotModules = true;
      } else {
        if (!gotPlain && better(plain, at, k.length)) plain = { at, length: k.length, folder };
        gotPlain = true;
      }
    }
  }
  return { ...(plain ? { plain: plain.folder } : {}), ...(viaModules ? { viaModules: viaModules.folder } : {}) };
};

/**
 * The known folder a process runs in, worked out from command lines because Windows does not give
 * another process's working folder. First the process's own command line, then each parent's in turn, is
 * searched for a path with no `node_modules` part. Only when the whole chain has none does the first path
 * with a `node_modules` part count (the process first, then its parents): a server started as
 * `node <worktree>/node_modules/vite/bin/vite.js` names its folder nowhere else. It stops on a loop in
 * the parent chain and after eight levels.
 */
export const folderOfPid = (pid: number, procs: readonly Proc[], known: readonly string[]): string | undefined => {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const seen = new Set<number>();
  let fallback: string | undefined;
  let at = byPid.get(pid);
  for (let level = 0; at && level < MAX_LEVELS && !seen.has(at.pid); level++) {
    seen.add(at.pid);
    const named = namedIn(at.commandLine, known);
    if (named.plain !== undefined) return named.plain;
    fallback ??= named.viaModules;
    at = byPid.get(at.ppid);
  }
  return fallback;
};

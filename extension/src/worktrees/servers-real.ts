// The real server lister: asks the OS which ports are listened on and ties each to a folder. No vscode import.
// It only reads. Programs are run through the injected `run`, which never throws.
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "./pool.ts";
import { portpilotListeners, type ReadText } from "./portpilot.ts";
import { ok, type Run } from "./run.ts";
import { folderOfPid, holderOf, parseLsofCwd, parseLsofListen, parseNetstat, parseProcessTable, type Listener, type PortRow } from "./servers.ts";
import { norm } from "../rows.ts";

export type RealServersOptions = {
  /** `process.platform`; "win32" takes the netstat route, anything else lsof. */
  platform?: string;
  /** Where APPDATA is read from, for PortPilot's folder. */
  env?: Record<string, string | undefined>;
  /** Reads PortPilot's files. */
  read?: ReadText;
  /** The folder the programs are run in; it only has to exist. */
  cwd?: string;
  /** Time limit for the whole listing. */
  totalMs?: number;
  now?: () => number;
};

const PROCESS_TABLE = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";

/**
 * Every listening port that can be tied to one of `knownFolders` (the worktrees and main checkouts of the
 * scan), each with the known folder it runs in. Undefined when the OS port table could not be read at all;
 * a listener that maps to no known folder is dropped.
 *
 * Windows: `netstat` for ports and pids, then two sources for the folder. PortPilot's files name the
 * folder of each app it started. For the rest, one process-table call gives command lines and parents,
 * and `folderOfPid` reads the folder out of those, because Windows does not give another process's
 * working folder. Other systems: `lsof` for the ports and for each pid's working folder.
 */
export const realListServers = async (run: Run, knownFolders: readonly string[], opts: RealServersOptions = {}): Promise<Listener[] | undefined> => {
  const { platform = process.platform, env = process.env, read = (p: string) => readFile(p, "utf8"), cwd = tmpdir(), totalMs = 10_000, now = Date.now } = opts;
  const deadline = now() + totalMs;
  const left = () => Math.max(0, deadline - now());
  // A limit of 0 would mean no limit at all to the runner.
  const limit = () => Math.max(1, left());

  const out: Listener[] = [];
  const seen = new Set<string>();
  const add = (port: number, folder: string | undefined) => {
    const known = folder === undefined ? undefined : holderOf(folder, knownFolders);
    if (known === undefined) return;
    const key = `${port}|${norm(known)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ port, folder: known });
  };

  if (platform === "win32") {
    // `-p TCP` lists IPv4 only; a server bound to `::1` alone shows under TCPv6.
    const [v4, v6] = await Promise.all([
      run("netstat", ["-ano", "-p", "TCP"], { cwd, timeoutMs: limit() }),
      run("netstat", ["-ano", "-p", "TCPv6"], { cwd, timeoutMs: limit() }),
    ]);
    if (!ok(v4)) return undefined;
    const rows = parseNetstat(`${v4.stdout}\n${ok(v6) ? v6.stdout : ""}`);

    if (env.APPDATA) {
      for (const l of await portpilotListeners(join(env.APPDATA, "portpilot"), read, new Set(rows.map((r) => r.port)))) add(l.port, l.folder);
    }
    if (rows.length === 0 || knownFolders.length === 0 || left() === 0) return out;
    const table = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", PROCESS_TABLE], { cwd, timeoutMs: limit() });
    // No process table: what PortPilot named still stands.
    if (!ok(table)) return out;
    const procs = parseProcessTable(table.stdout);
    for (const r of rows) add(r.port, folderOfPid(r.pid, procs, knownFolders));
    return out;
  }

  const listed = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { cwd, timeoutMs: limit() });
  // lsof exits 1 when nothing listens, with nothing printed; only a missing program or a timeout is "could not look".
  if (listed.code === -1 || listed.timedOut) return undefined;
  const rows: PortRow[] = parseLsofListen(listed.stdout);
  const pids = [...new Set(rows.map((r) => r.pid))];
  const folders = new Map<number, string | undefined>();
  await pool(pids, 4, async (pid) => {
    if (left() === 0) return;
    const r = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { cwd, timeoutMs: limit() });
    if (ok(r)) folders.set(pid, parseLsofCwd(r.stdout));
  });
  for (const r of rows) add(r.port, folders.get(r.pid));
  return out;
};

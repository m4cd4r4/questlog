// What PortPilot knows about running dev servers, read from its two files. No vscode import; the files come in through `read`.
// PortPilot is a separate tool that may not be installed: with no files, or damaged ones, this gives nothing and never throws.
import { join } from "node:path";
import type { Listener } from "./servers.ts";

/** A file's text, or a throw or rejection when it cannot be read. */
export type ReadText = (path: string) => string | Promise<string>;

export const PORTPILOT_RUNTIME = "portpilot-runtime.json";
export const PORTPILOT_CONFIG = "portpilot-config.json";

const objectIn = async (read: ReadText, path: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const v: unknown = JSON.parse(await read(path));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/**
 * The apps PortPilot started that are still running, each with its port and folder. `dir` is PortPilot's
 * own folder (`%APPDATA%/portpilot`). The runtime file gives each app's pid and port, the config file
 * its folder (`worktreePath`, else `cwd`). An app counts as running when its entry has no `crashed` key, its
 * port is a number and that port is in `listening`, the ports the OS says something listens on. The pid
 * is not asked for: PortPilot writes null there for apps that are running.
 */
export const portpilotListeners = async (dir: string, read: ReadText, listening: ReadonlySet<number>): Promise<Listener[]> => {
  const [runtime, config] = await Promise.all([objectIn(read, join(dir, PORTPILOT_RUNTIME)), objectIn(read, join(dir, PORTPILOT_CONFIG))]);
  const running = runtime?.apps;
  const apps = config?.apps;
  if (!running || typeof running !== "object" || Array.isArray(running) || !Array.isArray(apps)) return [];

  const folderOf = new Map<string, string>();
  for (const a of apps as Record<string, unknown>[]) {
    if (!a || typeof a !== "object" || typeof a.id !== "string") continue;
    const folder = text(a.worktreePath) ?? text(a.cwd);
    if (folder) folderOf.set(a.id, folder);
  }

  const out: Listener[] = [];
  for (const [id, state] of Object.entries(running as Record<string, unknown>)) {
    if (!state || typeof state !== "object") continue;
    const { port } = state as { port?: unknown };
    if ("crashed" in state || typeof port !== "number" || !listening.has(port)) continue;
    const folder = folderOf.get(id);
    if (folder) out.push({ port, folder });
  }
  return out;
};

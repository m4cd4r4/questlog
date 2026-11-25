// Where Questlog keeps its files, and the CLI's readers for the two lists a scan starts from: session rows and
// the worktree registry. No vscode import. The extension never calls the readers: it passes the rows and
// registry entries its Refresher already holds, so a scan in the extension host reads no row file again.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRow, type Row } from "../rows.ts";
import type { RegistryEntry } from "../plans.ts";

type Env = Record<string, string | undefined>;

/** The Claude config folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
export const configDir = (env: Env = process.env, home: string = homedir()): string => env.CLAUDE_CONFIG_DIR || join(home, ".claude");

/** Questlog's folder, the one the mod writes session rows to. */
export const questlogDir = (env: Env = process.env, home: string = homedir()): string => join(configDir(env, home), "questlog");

/** The worktree registry when no setting or flag names another: workspaces/registry.json in the config folder. */
export const defaultRegistryPath = (env: Env = process.env, home: string = homedir()): string =>
  join(configDir(env, home), "workspaces", "registry.json");

/** The parts of node:fs/promises the two readers need, so a test can pass its own. */
export type SourcesFs = {
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
};

const nodeFs: SourcesFs = { readdir: (p) => readdir(p), readFile: (p, e) => readFile(p, e) };

/** Every session row in `dir`: one `.json` file each. A missing folder gives none; a half-written file is skipped. */
export const readRows = async (dir: string, fs: SourcesFs = nodeFs): Promise<Row[]> => {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const rows: Row[] = [];
  for (const n of names) {
    try {
      const v: unknown = JSON.parse(await fs.readFile(join(dir, n), "utf8"));
      if (isRow(v)) rows.push(v);
    } catch {
      // half-written file; the next read gets it whole
    }
  }
  return rows;
};

/** The registry's entries. No file (plans are optional), a damaged one or one with no entries list: none. */
export const readRegistry = async (path: string, fs: SourcesFs = nodeFs): Promise<RegistryEntry[]> => {
  try {
    const v = JSON.parse(await fs.readFile(path, "utf8")) as { entries?: unknown } | null;
    return v && Array.isArray(v.entries) ? (v.entries as RegistryEntry[]) : [];
  } catch {
    return [];
  }
};

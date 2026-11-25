// A fake git and gh for tests that run a whole scan: answers come from a table, nothing is spawned.
import { PR_LIST_LIMIT } from "../src/worktrees/collect.ts";
import type { Run, RunResult } from "../src/worktrees/run.ts";
import type { SizeFs } from "../src/worktrees/size.ts";
import type { ScannedRepo, ScannedWorktree } from "../src/worktrees/scan.ts";
import { verdictOf, type Facts } from "../src/worktrees/verdict.ts";

export const SHA = (n: number) => String(n).repeat(40).slice(0, 40);

export const good = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "", timedOut: false });
export const bad = (code = 1, stderr = ""): RunResult => ({ code, stdout: "", stderr, timedOut: false });

export type Wt = { path: string; branch: string; head?: string };
export const porcelain = (wts: Wt[]) =>
  wts.map((w) => [`worktree ${w.path}`, `HEAD ${w.head ?? SHA(1)}`, `branch refs/heads/${w.branch}`].join("\n")).join("\n\n") + "\n\n";

export const GH_ALL = `gh pr list --state all --limit ${PR_LIST_LIMIT} --json number,state,headRefName,headRefOid,updatedAt,isCrossRepository`;
export const DIFF_BASE = "git diff --name-only origin/main...HEAD";
export const DIFF_HEAD = "git diff --name-only HEAD";

export type Call = { cmd: string; args: string[]; cwd: string };
export type Table = Record<string, RunResult | undefined>;
export type Hook = (call: Call) => void | Promise<void>;

/**
 * A fake `run` over a table keyed "<cwd>|<cmd> <args>" or "<cmd> <args>"; no entry fails with code 1, the way
 * git does for a ref or object that is not there. `hook` runs before each answer and may throw or wait.
 */
export const fakeRun = (table: Table, hook?: Hook) => {
  const calls: Call[] = [];
  const run: Run = async (cmd, args, { cwd }) => {
    const call = { cmd, args: [...args], cwd };
    calls.push(call);
    if (hook) await hook(call);
    const line = `${cmd} ${args.join(" ")}`;
    return table[`${cwd}|${line}`] ?? table[line] ?? bad();
  };
  return { run, calls };
};

/** One repo's answers: listed from any of its folders, default branch main, no stashes, clean pushed worktrees, commits at `commitAt` seconds. */
export const repoTable = (wts: Wt[], prs: unknown[] = [], commitAt = 1767225600): Table => {
  const t: Table = {};
  for (const w of wts) {
    t[`${w.path}|git worktree list --porcelain`] = good(porcelain(wts));
    t[`${w.path}|git status --porcelain`] = good("");
    t[`${w.path}|git log -1 --format=%ct`] = good(`${commitAt}\n`);
    t[`${w.path}|git rev-list --count origin/main..HEAD`] = good("1\n");
    t[`${w.path}|git rev-parse --verify --quiet refs/remotes/origin/${w.branch}`] = good(SHA(1));
    t[`${w.path}|git rev-list --count HEAD --not refs/remotes/origin/${w.branch}`] = good("0\n");
  }
  const main = wts[0].path;
  t[`${main}|git symbolic-ref --short refs/remotes/origin/HEAD`] = good("origin/main\n");
  t[`${main}|git stash list`] = good("");
  t[`${main}|${GH_ALL}`] = good(JSON.stringify(prs));
  return t;
};

/** A file system that is all in memory: each named folder holds one file of the given size. `read` lists the folders walked. */
export const fakeSizeFs = (bytes: Record<string, number>) => {
  const read: string[] = [];
  const fs: SizeFs = {
    readdir: async (p) => {
      read.push(p);
      if (!(p in bytes)) throw new Error("ENOENT");
      return [{ name: "f.txt", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }];
    },
    lstat: async (p) => {
      if (p in bytes) return { size: 0, mtimeMs: 1000 };
      const flat = p.split(String.fromCharCode(92)).join("/");
      const dir = Object.keys(bytes).find((d) => flat === d + "/f.txt");
      if (!dir) throw new Error("ENOENT");
      return { size: bytes[dir], mtimeMs: 1000 };
    },
  };
  return { fs, read };
};

/** One worktree as the scan would hold it: the facts, and the verdict the real rule gives them. */
export const scannedWt = (path: string, branch: string, over: Partial<Facts> = {}): ScannedWorktree => {
  const f: Facts = {
    path, branch, head: SHA(1), main: false, detached: false, locked: false, lockedReason: "", bare: false, prunable: false, prunableReason: "",
    dirty: 0, changed: 0, untracked: 0, dirtySample: [], unpushed: 0, stashes: 0, ownCommits: 1, pr: { state: "none" }, ...over,
  };
  const verdict = verdictOf(f);
  return verdict ? { ...f, verdict } : { ...f };
};

/** One repo as the scan would hold it. */
export const scannedRepo = (path: string, worktrees: ScannedWorktree[], over: Partial<ScannedRepo> = {}): ScannedRepo =>
  ({ path, defaultBranch: "main", tookMs: 5, worktrees, ...over });

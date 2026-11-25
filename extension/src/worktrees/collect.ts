// The facts about every worktree of one repo, gathered through an injected `run`: no vscode, no fs, no child_process.
// It only reads: no fetch, no prune, no ls-remote. Whether a branch is on the remote comes from the local refs/remotes.
import { norm } from "../rows.ts";
import { isEntered } from "./listing.ts";
import { parseWorktreeList, type WorktreeRecord } from "./parse.ts";
import { pool } from "./pool.ts";
import { verdictOf, type Count, type Facts, type PrFacts, type PrState } from "./verdict.ts";
import { failedText, ok, type Run, type RunResult } from "./run.ts";

export type RepoFacts = {
  /** The folder that was asked about. */
  path: string;
  /** The default branch, without `origin/`; empty when it could not be worked out. */
  defaultBranch: string;
  /** Every entry git lists, the main checkout first. */
  worktrees: Facts[];
  /** Set when the worktree list itself could not be read; `worktrees` is then empty. */
  error?: string;
  /** `stop` said to stop before every worktree was read; the unread ones carry unknown counts. */
  stopped?: boolean;
  /**
   * Only with the `changedFiles` option: the files each open worktree changed, keyed by its path as git listed it.
   * A worktree whose diff could not be read is absent. Kept beside the facts, never on them, so it is never cached.
   */
  changedFiles?: Map<string, string[]>;
};

export type CollectOptions = {
  /** Time limit for one git call. */
  timeoutMs?: number;
  /** Time limit for one gh call. */
  ghTimeoutMs?: number;
  /** Asked before each worktree; true means stop reading and return what there is. */
  stop?: () => boolean;
  /** How many worktrees of the repo are read at once (default 1, as the plan states); the calls for one worktree stay in sequence. */
  worktreeParallel?: number;
  /** Also list the files each read worktree changed, unless it reads closable or orphan: two more git calls per worktree. */
  changedFiles?: boolean;
  /**
   * Enter only these worktrees (either slash, any letter case). The repo-wide reads run as before; every other
   * worktree comes back as one the scan did not reach (`unread`). What a close uses to get fresh facts for one folder.
   */
  only?: readonly string[];
};

const lines = (text: string) => text.split(/\r?\n/).filter((l) => l !== "");

/** One call asks for this many pull requests; a full page means older ones may be missing. */
export const PR_LIST_LIMIT = 500;
const PR_FIELDS = "number,state,headRefName,headRefOid,updatedAt,isCrossRepository";

type GhPr = { number: number; state: PrState; headRefName: string; headRefOid: string; updatedAt: number };

/** A full commit id. Anything else gh printed as a pull request's head is dropped before it can reach a git argument. */
const FULL_SHA = /^[0-9a-f]{40}$/i;

const PR_RANK: Partial<Record<PrState, number>> = { open: 0, merged: 1, closed: 2 };

/** gh's JSON into pull requests of this repo; forks are dropped. Undefined when the text is not the expected list. */
export const parsePrList = (text: string): GhPr[] | undefined => {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return undefined; }
  if (!Array.isArray(raw)) return undefined;
  const out: GhPr[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p !== "object" || p.isCrossRepository === true) continue;
    const state = String(p.state ?? "").toLowerCase();
    if (state !== "open" && state !== "merged" && state !== "closed") continue;
    if (typeof p.number !== "number" || typeof p.headRefName !== "string") continue;
    const at = Date.parse(String(p.updatedAt ?? ""));
    out.push({
      number: p.number, state, headRefName: p.headRefName,
      headRefOid: typeof p.headRefOid === "string" && FULL_SHA.test(p.headRefOid) ? p.headRefOid : "",
      updatedAt: Number.isFinite(at) ? at : 0,
    });
  }
  return out;
};

/** How many entries gh printed, forks and all: what tells a full page from a short one. Zero when it is not a list. */
export const prPageLength = (text: string): number => {
  try {
    const raw: unknown = JSON.parse(text);
    return Array.isArray(raw) ? raw.length : 0;
  } catch { return 0; }
};

/** The pull request that speaks for a branch: open first, then merged, then closed, the newest within each. */
export const pickPr = (prs: readonly GhPr[], branch: string): PrFacts => {
  const mine = prs.filter((p) => p.headRefName === branch)
    .sort((a, b) => (PR_RANK[a.state] ?? 9) - (PR_RANK[b.state] ?? 9) || b.updatedAt - a.updatedAt);
  const p = mine[0];
  if (!p) return { state: "none" };
  return { state: p.state, number: p.number, ...(p.headRefOid ? { headRefOid: p.headRefOid } : {}) };
};

/** Stashes per branch from `git stash list`; a stash made on a detached HEAD belongs to no branch. */
export const stashesByBranch = (text: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^stash@\{\d+\}: (?:WIP on|On) (.+?): /.exec(line);
    if (!m || m[1] === "(no branch)") continue;
    out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  }
  return out;
};

const countOf = (r: RunResult): Count => {
  const n = Number.parseInt(r.stdout.trim(), 10);
  return ok(r) && Number.isFinite(n) ? n : "unknown";
};

const unread = (rec: WorktreeRecord, pr: PrFacts): Facts =>
  ({ ...rec, dirty: 0, changed: 0, untracked: 0, dirtySample: [], unpushed: "unknown", stashes: 0, ownCommits: "unknown", pr, unread: true });

const SAMPLE = 5;

/** `git status --porcelain` into counts and the first few paths. An untracked folder is one line, so one entry. */
export const parseStatus = (text: string): { changed: number; untracked: number; sample: string[] } => {
  let changed = 0;
  let untracked = 0;
  const sample: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.startsWith("!!")) continue;
    if (line.startsWith("??")) untracked++;
    else changed++;
    if (sample.length >= SAMPLE) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    sample.push(path.split("\\").join("/"));
  }
  return { changed, untracked, sample };
};

/**
 * Every worktree of the repo at `repoPath` with its facts. The main checkout, a bare entry and a worktree
 * whose folder is gone are listed but never entered. A git call that fails for one worktree makes that
 * fact unknown and never throws; only a failed `git worktree list` gives `error`.
 */
export const collectRepo = async (repoPath: string, run: Run, opts: CollectOptions = {}): Promise<RepoFacts> => {
  const { timeoutMs = 10_000, ghTimeoutMs = 15_000, stop = () => false, worktreeParallel = 1, changedFiles = false, only } = opts;
  const wanted = only ? new Set(only.map(norm)) : undefined;
  const git = (cwd: string, ...args: string[]) => run("git", args, { cwd, timeoutMs });

  const listed = await git(repoPath, "worktree", "list", "--porcelain");
  if (!ok(listed)) {
    const why = failedText("git worktree list", listed);
    return { path: repoPath, defaultBranch: "", worktrees: [], error: why };
  }
  const records = parseWorktreeList(listed.stdout);
  const mainPath = records[0]?.path ?? repoPath;
  const enter = isEntered;

  let defaultBranch = "";
  const head = await git(mainPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (ok(head) && head.stdout.trim()) defaultBranch = head.stdout.trim().replace(/^origin\//, "");
  else {
    for (const name of ["main", "master"]) {
      if (ok(await git(mainPath, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`))) { defaultBranch = name; break; }
    }
  }

  // One gh call for the repo. If it fails, nothing is known about any branch's pull request.
  const prArgs = ["pr", "list", "--state", "all", "--limit", String(PR_LIST_LIMIT), "--json", PR_FIELDS];
  const all = await run("gh", prArgs, { cwd: mainPath, timeoutMs: ghTimeoutMs });
  const prs = ok(all) ? parsePrList(all.stdout) : undefined;
  // A page that is not full holds every pull request, so a branch missing from it has none.
  // Full is judged on what gh printed, not on what is left once fork pull requests are dropped.
  const mayBeCut = prs !== undefined && prPageLength(all.stdout) >= PR_LIST_LIMIT;
  const prCache = new Map<string, PrFacts>();
  const prOf = async (branch: string): Promise<PrFacts> => {
    if (!prs) return { state: "unknown" };
    const cached = prCache.get(branch);
    if (cached) return cached;
    let pr = pickPr(prs, branch);
    if (pr.state === "none" && mayBeCut) {
      const one = await run("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", PR_FIELDS], { cwd: mainPath, timeoutMs: ghTimeoutMs });
      const found = ok(one) ? parsePrList(one.stdout) : undefined;
      pr = found ? pickPr(found, branch) : { state: "unknown" };
    }
    prCache.set(branch, pr);
    return pr;
  };

  const stashList = await git(mainPath, "stash", "list");
  const stashesKnown = ok(stashList);
  const stashes = stashesKnown ? stashesByBranch(stashList.stdout) : new Map<string, number>();

  const filesOf = new Map<string, string[]>();

  const readOne = async (rec: WorktreeRecord): Promise<Facts> => {
    const pr: PrFacts = rec.detached || !rec.branch ? { state: "none" } : await prOf(rec.branch);

    const status = await git(rec.path, "status", "--porcelain");
    // An unreadable status proves nothing about the tree: the count is unknown, never a clean zero.
    const st = ok(status) ? parseStatus(status.stdout) : undefined;

    const log = await git(rec.path, "log", "-1", "--format=%ct");
    const secs = Number.parseInt(log.stdout.trim(), 10);
    const lastCommitAt = ok(log) && Number.isFinite(secs) ? secs * 1000 : undefined;

    const ownCommits: Count = defaultBranch ? countOf(await git(rec.path, "rev-list", "--count", `origin/${defaultBranch}..HEAD`)) : "unknown";

    let unpushed: Count;
    if (rec.detached || !rec.branch) {
      // Not `--all`: that includes this worktree's own HEAD and would always count zero.
      unpushed = countOf(await git(rec.path, "rev-list", "--count", "HEAD", "--not", "--branches", "--remotes", "--tags"));
    } else {
      const pushedAs: string[] = [];
      const upstream = `refs/remotes/origin/${rec.branch}`;
      if (ok(await git(rec.path, "rev-parse", "--verify", "--quiet", upstream))) pushedAs.push(upstream);
      if (pr.headRefOid && ok(await git(rec.path, "cat-file", "-e", `${pr.headRefOid}^{commit}`))) pushedAs.push(pr.headRefOid);
      if (pushedAs.length > 0) unpushed = countOf(await git(rec.path, "rev-list", "--count", "HEAD", "--not", ...pushedAs));
      // Never pushed and no pull request: every commit of its own is unpushed.
      else if (pr.state === "none") unpushed = ownCommits;
      else unpushed = "unknown";
    }
    // A stash belongs to a branch. When the list could not be read, a branch's count is unknown, not zero.
    const onBranch = !!rec.branch && !rec.detached;
    const stashCount: Count = !onBranch ? 0 : stashesKnown ? stashes.get(rec.branch) ?? 0 : "unknown";

    const facts: Facts = {
      ...rec,
      ...(st ? { dirty: st.changed + st.untracked, changed: st.changed, untracked: st.untracked, dirtySample: st.sample }
        : { dirty: "unknown" as const, dirtySample: [] }),
      unpushed, stashes: stashCount, ownCommits,
      ...(lastCommitAt === undefined ? {} : { lastCommitAt }), pr,
    };

    // The files of every worktree that still holds open work, whatever its pull request says: all but a
    // closable one and an orphan. Whether a dev server runs here is not known yet; it can only add busy.
    // Three dots: against the merge base, so what only changed on the default branch does not count.
    // Plus tracked files changed and not yet committed. Either call failing leaves the worktree out.
    const verdict = changedFiles && defaultBranch ? verdictOf(facts)?.verdict : undefined;
    if (verdict !== undefined && verdict !== "closable" && verdict !== "orphan") {
      const committed = await git(rec.path, "diff", "--name-only", `origin/${defaultBranch}...HEAD`);
      const working = ok(committed) ? await git(rec.path, "diff", "--name-only", "HEAD") : undefined;
      if (working && ok(working)) filesOf.set(rec.path, [...new Set([...lines(committed.stdout), ...lines(working.stdout)])]);
    }

    return facts;
  };

  // What is already known about an unread worktree's pull request, without another call.
  const knownPr = (rec: WorktreeRecord): PrFacts => {
    if (rec.detached || !rec.branch) return { state: "none" };
    if (!prs) return { state: "unknown" };
    const cached = prCache.get(rec.branch);
    if (cached) return cached;
    const pr = pickPr(prs, rec.branch);
    return pr.state === "none" && mayBeCut ? { state: "unknown" } : pr;
  };

  // `worktreeParallel` worktrees at a time, each written to its own slot so the order stays git's order.
  let stopped = false;
  const worktrees = await pool(records, worktreeParallel, async (rec): Promise<Facts> => {
    if (!enter(rec)) {
      return { ...rec, dirty: 0, unpushed: "unknown", stashes: 0, ownCommits: "unknown", pr: { state: rec.prunable ? "unknown" : "none" } };
    }
    // Not asked for: left as not read, and no call is made in its folder.
    if (wanted && !wanted.has(norm(rec.path))) return unread(rec, knownPr(rec));
    if (stopped || stop()) {
      stopped = true;
      return unread(rec, knownPr(rec));
    }
    return readOne(rec);
  });
  // In git's order whatever order the reads finished in.
  const inOrder = new Map(records.filter((r) => filesOf.has(r.path)).map((r) => [r.path, filesOf.get(r.path)!]));
  return { path: repoPath, defaultBranch, worktrees, ...(stopped ? { stopped: true } : {}), ...(changedFiles ? { changedFiles: inOrder } : {}) };
};

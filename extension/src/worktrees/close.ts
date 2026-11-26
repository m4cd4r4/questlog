// Removing one worktree: fresh facts at the moment of removing, the refusals, then the remove command.
// Pure, no vscode import: git, gh, the file system, the server lister and the "in use" test are passed in.
// The folder is never removed with `--force`, and a worktree the fresh facts do not clear is never touched.
// Nothing here makes a blocking file call: the extension host runs it.
import { access, lstat, rmdir, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { inside, norm } from "../rows.ts";
import { collectRepo } from "./collect.ts";
import { plural } from "./listing.ts";
import { repoNameOf, slugOf } from "./names.ts";
import { failedText, ok, type Run } from "./run.ts";
import type { ScanFile } from "./scan.ts";
import { isRemoveOfferedByScan, offeredEntry, safeWorktrees } from "./view.ts";
import { markServers, type ListServers } from "./servers.ts";
import type { WalkResult } from "./size.ts";
import { verdictOf, type Facts } from "./verdict.ts";

/** A removal of a large folder takes minutes; the scanner's 10 seconds would kill it part way. */
export const REMOVE_TIMEOUT_MS = 10 * 60 * 1000;

export const REASON = {
  notLinked: "not a linked worktree of this repo",
  changed: "changed since the last scan",
  noServerCheck: "could not check for dev servers",
  noUseCheck: "could not check whether the folder is in use",
  otherLink: "holds a linked folder other than node_modules",
  noLinkCheck: "could not check the folder for linked folders: set questlog.worktrees.removeCommand",
  notBulkSafe: "not safe to remove in a batch",
  afterMerge: "has commits after its merged pull request",
  noMergeCheck: "cannot tell whether its commits are in the merged pull request",
  stillThere: "the command finished and the folder is still there",
  partly: "may be partly removed",
  noIgnoredList: "could not list the ignored files",
  linkStillThere: "the node_modules link is still there after removing it",
} as const;

/** What the note of a removed worktree says, in the order it is joined. */
export const NOTE = {
  folder: "folder removed",
  folderAndBranch: "folder and branch removed",
  link: "node_modules link removed first",
  keptCommits: "branch kept because it has commits that are not on its upstream or its pull request",
  keptGit: "branch kept because git could not delete it",
} as const;

/** The setting's value as a command: a value that is not text reads as empty, which is the default command. */
export const removeCommandOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export type RemoveInput = {
  /** The repo's main checkout, or any folder of the repo: the commands run from the main checkout git lists. */
  repoPath: string;
  /** The worktree to remove, as the last scan held it. */
  path: string;
  /** What the last scan held for it: a removal is refused when either has changed since. */
  seen: { head: string; branch: string };
  /** `questlog.worktrees.removeCommand`. Empty: the default command. */
  command: string;
  /** Part of "Remove {n} safe": the pull request must be merged and HEAD must be its head commit or reachable from it. */
  bulk?: boolean;
};

/** The two things the link step asks of the file system. Neither follows a link. */
export type LinkFs = {
  lstat: (path: string) => Promise<{ isSymbolicLink: () => boolean }>;
  unlink: (path: string) => Promise<unknown>;
  rmdir: (path: string) => Promise<unknown>;
};

export const realLinkFs: LinkFs = { lstat: (p) => lstat(p), unlink: (p) => unlink(p), rmdir: (p) => rmdir(p) };

/** Whether a folder is on disk, asked without blocking. */
export const realExists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

export type RemoveDeps = {
  run: Run;
  listServers: ListServers;
  /** Whether a folder is on disk. */
  exists: (path: string) => Promise<boolean>;
  /** The size walk, which never follows a link: used to find junctions and symlinks. `onLink` is given each link's path. */
  walk: (folder: string, onLink?: (path: string) => void) => Promise<WalkResult>;
  /** Why the folder must not be removed now (a session running in it, open in this window), or nothing. Answers from memory. */
  inUse: (path: string) => string | undefined;
  /** The home folder, for a `~/` at the start of a part of a custom command. */
  home: string;
  /** For the `node_modules` link; the real file system when left out. */
  fs?: LinkFs;
};

export type RemoveResult =
  /** The folder is gone. `branch`: the local branch was deleted, kept, or never touched. */
  | { outcome: "removed"; path: string; branch: "deleted" | "kept" | "untouched"; note: string }
  /** Nothing was run on the worktree. */
  | { outcome: "refused"; path: string; reason: string }
  /** The remove command ran and the worktree is not removed. `partly`: the folder may be partly removed. */
  | { outcome: "failed"; path: string; reason: string; partly: boolean };

/**
 * A custom remove command as a program and its arguments. The text is split on spaces first; then a part that
 * starts with `~/` gets the home folder, and `{slug}` and `{path}` are filled in inside each part, so a path
 * with a space stays one argument. Nothing when the text is empty or is not text.
 */
export const commandParts = (template: unknown, fill: { slug: string; path: string; home: string }): string[] =>
  removeCommandOf(template).split(/\s+/).filter((p) => p !== "").map((part) => {
    const homed = part.startsWith("~/") ? `${fill.home.replace(/[\\/]+$/, "")}/${part.slice(2)}` : part;
    return homed.split("{slug}").join(fill.slug).split("{path}").join(fill.path);
  });

const sameHead = (a: string, b: string) => a !== "" && a.toLowerCase() === b.toLowerCase();

/** Whether the top-level `node_modules` of a folder is a link. A folder without one is not an error. */
const nodeModulesLinked = async (folder: string, fs: LinkFs): Promise<boolean> => {
  try {
    return (await fs.lstat(join(folder, "node_modules"))).isSymbolicLink();
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw e;
  }
};

/** Takes a link away without following it: `unlink` first, `rmdir` for a junction that `unlink` will not take. Neither is recursive. */
const dropLink = async (path: string, fs: LinkFs): Promise<void> => {
  try {
    await fs.unlink(path);
  } catch (first) {
    try { await fs.rmdir(path); } catch { throw first; }
  }
};

/**
 * Whether the branch's commits are all on its upstream or on its pull request's head commit, asked from the
 * main checkout once the folder is gone. Only then may the local branch go.
 */
const branchIsSafe = async (branch: string, prHead: string | undefined, main: string, run: Run): Promise<boolean> => {
  const held: string[] = [];
  const upstream = `refs/remotes/origin/${branch}`;
  if (ok(await run("git", ["rev-parse", "--verify", "--quiet", upstream], { cwd: main }))) held.push(upstream);
  if (prHead && ok(await run("git", ["cat-file", "-e", `${prHead}^{commit}`], { cwd: main }))) held.push(prHead);
  if (held.length === 0) return false;
  const extra = await run("git", ["rev-list", "--count", `refs/heads/${branch}`, "--not", ...held], { cwd: main });
  return ok(extra) && extra.stdout.trim() === "0";
};

/**
 * Remove one worktree. Fresh facts are read first (never the cache); the removal is refused, with the reason,
 * when the first of these holds: git no longer lists it as a linked worktree; HEAD or the branch moved since the
 * last scan; the fresh verdict offers no removal; the dev servers could not be listed; the folder is in use;
 * and, for the default command, the folder holds a link other than a top-level `node_modules` or could not be
 * walked to the end. Then a linked `node_modules` is unlinked and confirmed gone, `git worktree remove <path>`
 * runs from the main checkout (or the custom command), and the local branch is deleted with `git branch -D`
 * only when a second check from the main checkout finds every commit on it also on its upstream or its pull
 * request. Done means exit 0 and the folder gone. Never throws.
 */
export const removeOne = async (input: RemoveInput, deps: RemoveDeps): Promise<RemoveResult> => {
  const refused = (reason: string): RemoveResult => ({ outcome: "refused", path: input.path, reason });
  const fs = deps.fs ?? realLinkFs;
  let started = false;
  try {
    const key = norm(input.path);
    const repo = await collectRepo(input.repoPath, deps.run, { only: [input.path] });
    if (repo.error !== undefined) return refused(`could not read the repo: ${repo.error}`);
    const mainRec = repo.worktrees.find((w) => w.main);
    const rec = repo.worktrees.find((w) => norm(w.path) === key);
    // 1. Not a linked worktree any more, or never one
    if (!mainRec || !rec || rec.main || rec.bare) return refused(REASON.notLinked);
    const main = mainRec.path;

    // 2. HEAD or the branch moved since the row was drawn
    if (!sameHead(rec.head, input.seen.head) || (rec.branch ?? "") !== (input.seen.branch ?? "")) return refused(REASON.changed);

    // 3. The fresh verdict, first without the dev servers: what it refuses, a server cannot allow
    const plain = verdictOf(rec);
    if (!plain) return refused(REASON.notLinked);
    if (!plain.closeOffered) return refused(plain.reason);

    let listeners: Awaited<ReturnType<ListServers>>;
    try { listeners = await deps.listServers(repo.worktrees.map((w) => w.path)); } catch { listeners = undefined; }
    const fresh: Facts | undefined = markServers(repo.worktrees, listeners).find((w) => norm(w.path) === key);
    const verdict = fresh ? verdictOf(fresh) : undefined;
    if (!fresh || !verdict) return refused(REASON.notLinked);
    if (!verdict.closeOffered) return refused(verdict.reason);

    // "Remove {n} safe" only: merged, and nothing on HEAD past what the pull request held
    if (input.bulk) {
      if (!verdict.safeForBulk || fresh.pr.state !== "merged") return refused(`${REASON.notBulkSafe}: ${verdict.reason}`);
      const oid = fresh.pr.headRefOid ?? "";
      if (!oid) return refused(REASON.noMergeCheck);
      if (!sameHead(fresh.head, oid)) {
        const held = await deps.run("git", ["cat-file", "-e", `${oid}^{commit}`], { cwd: fresh.path });
        if (!ok(held)) return refused(REASON.noMergeCheck);
        const within = await deps.run("git", ["merge-base", "--is-ancestor", "HEAD", oid], { cwd: fresh.path });
        if (!ok(within)) return refused(within.code === 1 && !within.timedOut ? REASON.afterMerge : REASON.noMergeCheck);
      }
    }

    // 4. No way to look for dev servers
    if (listeners === undefined || fresh.server === "unknown") return refused(REASON.noServerCheck);

    // 5. A session running in it, or open in this window
    let use: string | undefined;
    try { use = deps.inUse(fresh.path); } catch { return refused(REASON.noUseCheck); }
    if (use) return refused(use);

    const custom = commandParts(input.command, { slug: slugOf(fresh.path), path: fresh.path, home: deps.home });

    // 6. The default command only: a link other than a top-level node_modules, or a walk that did not reach everything
    let linked = false;
    if (custom.length === 0) {
      const seenLinks: string[] = [];
      let walked: WalkResult;
      try {
        linked = await nodeModulesLinked(fresh.path, fs);
        walked = await deps.walk(fresh.path, (p) => seenLinks.push(p));
      } catch { return refused(REASON.noLinkCheck); }
      if (walked.cutShort || walked.skipped) return refused(REASON.noLinkCheck);
      if ((walked.links ?? 0) - (linked ? 1 : 0) > 0) {
        const top = norm(join(fresh.path, "node_modules"));
        const other = seenLinks.find((p) => norm(p) !== top);
        return refused(`${REASON.otherLink}: ${other ? relative(fresh.path, other).replace(/\\/g, "/") : "a linked folder"}`);
      }
    }

    // 7. A linked node_modules goes first, without following it; a failure here leaves the worktree whole
    const failedEarly = (reason: string): RemoveResult => ({ outcome: "failed", path: input.path, reason, partly: false });
    if (linked) {
      const nm = join(fresh.path, "node_modules");
      try { await dropLink(nm, fs); } catch (e) {
        return failedEarly(`could not remove the node_modules link: ${e instanceof Error ? e.message : String(e)}. Nothing else was removed`);
      }
      let still = true;
      try { still = (await fs.lstat(nm)).isSymbolicLink(); } catch (e) { still = (e as NodeJS.ErrnoException)?.code !== "ENOENT"; }
      if (still) return failedEarly(REASON.linkStillThere);
    }

    started = true;
    const ran = custom.length === 0
      ? await deps.run("git", ["worktree", "remove", fresh.path], { cwd: main, timeoutMs: REMOVE_TIMEOUT_MS })
      : await deps.run(custom[0], custom.slice(1), { cwd: main, timeoutMs: REMOVE_TIMEOUT_MS });
    const what = custom.length === 0 ? "git worktree remove" : custom[0];
    const gone = !(await deps.exists(fresh.path));
    if (!ok(ran)) {
      const partly = ran.timedOut || gone;
      return { outcome: "failed", path: input.path, reason: `${failedText(what, ran)}${partly ? `; ${REASON.partly}` : ""}`, partly };
    }
    if (!gone) return { outcome: "failed", path: input.path, reason: REASON.stillThere, partly: false };

    // The local branch goes only after the default command, only for a branch, and only when the check made
    // now, from the main checkout, finds nothing on it that is missing from its upstream or its pull request
    const linkNote = linked ? `, ${NOTE.link}` : "";
    if (custom.length > 0 || fresh.detached || !fresh.branch) {
      return { outcome: "removed", path: input.path, branch: "untouched", note: `${NOTE.folder}${linkNote}` };
    }
    if (!(await branchIsSafe(fresh.branch, fresh.pr.headRefOid, main, deps.run))) {
      return { outcome: "removed", path: input.path, branch: "kept", note: `${NOTE.folder}${linkNote}, ${NOTE.keptCommits}` };
    }
    const dropped = await deps.run("git", ["branch", "-D", fresh.branch], { cwd: main });
    return ok(dropped)
      ? { outcome: "removed", path: input.path, branch: "deleted", note: `${NOTE.folderAndBranch}${linkNote}` }
      : { outcome: "removed", path: input.path, branch: "kept", note: `${NOTE.folder}${linkNote}, ${NOTE.keptGit}: ${failedText("git branch -D", dropped)}` };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // Before the command started nothing was changed; after it, the folder's state is not known
    return started
      ? { outcome: "failed", path: input.path, reason: `${why}; ${REASON.partly}`, partly: true }
      : refused(`could not check the worktree: ${why}`);
  }
};

// ---------- in use ----------

/** Without `claude agents`, a session row updated this recently may still be running in a terminal or another window. */
export const RECENT_SESSION_MS = 15 * 60 * 1000;

export const IN_USE = {
  open: "open in this window",
  running: "a session is running in it",
  recent: "a session was active in it in the last 15 minutes",
} as const;

/** What the host knows about who is using folders: the session rows, the running sessions when they could be listed, this window's folders. All in memory. */
export type UseState = {
  rows: readonly { id: string; cwd?: string; updatedAt: number }[];
  /** Running sessions by id; undefined when they could not be listed. */
  live: { has: (id: string) => boolean } | undefined;
  /** The folders this window has open. */
  folders: readonly string[];
  now: number;
};

/**
 * Why `path` must not be removed now, or nothing. A folder this window has open (the worktree itself or a
 * folder inside it); a running session whose folder is the worktree or inside it; and, when the running
 * sessions could not be listed, a session there that was updated in the last 15 minutes.
 */
export const inUseReason = (path: string, s: UseState): string | undefined => {
  if (s.folders.some((f) => typeof f === "string" && f !== "" && inside(f, path))) return IN_USE.open;
  const here = s.rows.filter((r) => typeof r.cwd === "string" && r.cwd !== "" && inside(r.cwd, path));
  if (s.live) return here.some((r) => s.live!.has(r.id)) ? IN_USE.running : undefined;
  return here.some((r) => s.now - r.updatedAt < RECENT_SESSION_MS) ? IN_USE.recent : undefined;
};

// ---------- what the confirmation names ----------

/** What a removal would take with it, read before the question: the ignored top-level names and a linked node_modules. */
export type Prepared = { ignored: string[]; nodeModulesLink: boolean };

/**
 * The top-level names of the ignored files and folders in a worktree, `node_modules` left out, from
 * `git ls-files --others --ignored --exclude-standard --directory -z`: one name per top-level entry, with a
 * slash after a folder. Sorted by letter.
 */
export const ignoredNames = (stdout: string): string[] => {
  const names = new Set<string>();
  for (const entry of stdout.split("\0")) {
    if (entry === "") continue;
    const parts = entry.replace(/\\/g, "/").split("/").filter((p) => p !== "");
    if (parts.length === 0 || parts[0] === "node_modules") continue;
    names.add(parts.length > 1 || entry.endsWith("/") ? `${parts[0]}/` : parts[0]);
  }
  return [...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
};

/** Reads what the confirmation has to name for one worktree. Never throws; an error is the text of why it could not be read. */
export const prepareRemoval = async (path: string, command: string, deps: Pick<RemoveDeps, "run" | "fs">): Promise<Prepared | { error: string }> => {
  try {
    const listed = await deps.run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { cwd: path });
    if (!ok(listed)) return { error: `${REASON.noIgnoredList}: ${failedText("git ls-files", listed)}` };
    const nodeModulesLink = removeCommandOf(command) === "" && (await nodeModulesLinked(path, deps.fs ?? realLinkFs));
    return { ignored: ignoredNames(listed.stdout), nodeModulesLink };
  } catch (e) {
    return { error: `${REASON.noIgnoredList}: ${e instanceof Error ? e.message : String(e)}` };
  }
};

// ---------- the Remove worktree button: guard, confirmation, removal ----------

/** Asks the person; true only when they chose to go ahead. */
export type Confirm = (ask: { title: string; detail: string }) => Promise<boolean>;

export type FlowDeps = RemoveDeps & { confirm: Confirm };

/** `declined`: the person said no, or the question could not be put; nothing was run. */
export type FlowResult = RemoveResult | { outcome: "declined"; path: string };

export const NOT_OFFERED = "the last scan does not offer a removal for it";
const IGNORED_HEAD = "Ignored files and folders that will be deleted:";
const IGNORED_NONE = "No ignored files or folders other than node_modules.";
const LINK_LINE = "node_modules is a link to another folder. The link is removed first. The folder it points to is not touched.";
const howRemoved = (command: string) =>
  removeCommandOf(command) === "" ? "removed with git worktree remove, without -f" : "handed to your remove command (questlog.worktrees.removeCommand)";

/** The question before one removal: the folder, its branch, why it can be removed, and what goes with it. */
export const confirmOne = (w: { path: string; branch?: string; detached?: boolean; reason: string }, command: string, prep: Prepared): { title: string; detail: string } => ({
  title: `Remove worktree ${slugOf(w.path)}?`,
  detail: [
    w.path,
    w.detached || !w.branch ? "Detached HEAD" : `Branch ${w.branch}`,
    w.reason,
    "",
    `It is checked again first, then ${howRemoved(command)}.`,
    ...(prep.nodeModulesLink ? [LINK_LINE] : []),
    ...(prep.ignored.length > 0 ? [IGNORED_HEAD, ...prep.ignored] : [IGNORED_NONE]),
  ].join("\n"),
});

/**
 * One Remove worktree click. The path must be one the last scan offers a removal for (a made-up path, a main
 * checkout, a Needs you row and a Missing row all stop here, before any question); then what the removal would
 * take is read; then the confirmation; then `removeOne`, which reads fresh facts and may still refuse.
 * Declined means no command is run.
 */
export const removeFlow = async (input: { scan: ScanFile | undefined; path: string; command: string }, deps: FlowDeps): Promise<FlowResult> => {
  const e = offeredEntry(input.scan, input.path);
  if (!e || !isRemoveOfferedByScan(input.scan, input.path)) return { outcome: "refused", path: input.path, reason: NOT_OFFERED };
  const w = e.worktree;
  const prep = await prepareRemoval(w.path, input.command, deps);
  if ("error" in prep) return { outcome: "refused", path: w.path, reason: prep.error };
  let yes = false;
  try { yes = (await deps.confirm(confirmOne({ path: w.path, branch: w.branch, detached: w.detached, reason: w.verdict?.reason ?? "" }, input.command, prep))) === true; } catch { yes = false; }
  if (!yes) return { outcome: "declined", path: w.path };
  return removeOne({ repoPath: e.repo.path, path: w.path, seen: { head: w.head, branch: w.branch }, command: input.command }, deps);
};

// ---------- Remove {n} safe ----------

export type BatchReport = {
  repoPath: string;
  /** "none": the last scan holds nothing safe for this repo, or does not hold the repo. "declined": nothing was run. */
  outcome: "none" | "declined" | "ran";
  /** `branch` says whether the local branch was deleted, kept or never touched. */
  removed: { path: string; note: string; branch: "deleted" | "kept" | "untouched" }[];
  /** Refused at the re-check: nothing was run on these, and the batch carried on. */
  refused: { path: string; reason: string }[];
  /** The remove command failed on this one, which stopped the batch. */
  failed?: { path: string; reason: string; partly: boolean };
  /** After the failure: never looked at. */
  notTried: string[];
};

/** The question before a batch: every folder, one per line, what each takes with it, and how the batch runs. */
export const confirmAll = (repoPath: string, items: readonly { path: string; prep: Prepared }[], command: string): { title: string; detail: string } => {
  const withIgnored = items.filter((x) => x.prep.ignored.length > 0);
  const lines: string[] = [
    ...items.map((x) => x.path),
    "",
    `Each is checked again first. One that is no longer safe is refused and the rest carry on. Then ${howRemoved(command)}, one at a time. A failure stops the rest.`,
    ...items.filter((x) => x.prep.nodeModulesLink).map((x) => `${slugOf(x.path)}: ${LINK_LINE}`),
  ];
  if (withIgnored.length === 0) lines.push(IGNORED_NONE);
  else {
    lines.push(IGNORED_HEAD);
    for (const x of withIgnored) lines.push(x.path, ...x.prep.ignored.map((n) => `  ${n}`));
    if (withIgnored.length < items.length) lines.push("Other worktrees in this list have none.");
  }
  return { title: `Remove ${plural(items.length, "worktree", "worktrees")} of ${repoNameOf(repoPath)}?`, detail: lines.join("\n") };
};

/**
 * "Remove {n} safe" for one repo. The list is built here from the last scan (the repo's worktrees whose verdict
 * says `safeForBulk`): the page sends a repo path and never a list, and a repo path the scan does not hold
 * removes nothing. One confirmation listing every folder; then one at a time through `removeOne` with the batch
 * rule. A worktree refused at its re-check is skipped and the batch carries on; a remove command that fails
 * stops the batch, and the ones after it are reported as not tried.
 */
export const removeAllSafe = async (input: { scan: ScanFile | undefined; repoPath: string; command: string }, deps: FlowDeps): Promise<BatchReport> => {
  const list = safeWorktrees(input.scan, input.repoPath);
  const report: BatchReport = { repoPath: input.repoPath, outcome: "none", removed: [], refused: [], notTried: [] };
  const entry = list.length > 0 ? offeredEntry(input.scan, list[0].path) : undefined;
  if (!entry) return report;
  const repoPath = entry.repo.path;
  report.repoPath = repoPath;
  // What each removal would take, read one at a time; one that cannot be read is refused and left out of the question
  const items: { w: (typeof list)[number]; prep: Prepared }[] = [];
  for (const w of list) {
    const prep = await prepareRemoval(w.path, input.command, deps);
    if ("error" in prep) report.refused.push({ path: w.path, reason: prep.error });
    else items.push({ w, prep });
  }
  report.outcome = "ran";
  if (items.length === 0) return report;
  let yes = false;
  try { yes = (await deps.confirm(confirmAll(repoPath, items.map((x) => ({ path: x.w.path, prep: x.prep })), input.command))) === true; } catch { yes = false; }
  if (!yes) return { ...report, outcome: "declined", refused: [] };
  for (let i = 0; i < items.length; i++) {
    const w = items[i].w;
    const r = await removeOne({ repoPath, path: w.path, seen: { head: w.head, branch: w.branch }, command: input.command, bulk: true }, deps);
    if (r.outcome === "removed") report.removed.push({ path: w.path, note: r.note, branch: r.branch });
    else if (r.outcome === "refused") report.refused.push({ path: w.path, reason: r.reason });
    else {
      report.failed = { path: w.path, reason: r.reason, partly: r.partly };
      report.notTried = items.slice(i + 1).map((x) => x.w.path);
      break;
    }
  }
  return report;
};

// ---------- what the person is told ----------

/** One removal in words; empty when the person declined (nothing happened, nothing to say). */
export const resultText = (r: FlowResult): string => {
  const slug = slugOf(r.path);
  if (r.outcome === "removed") return `Removed ${slug}: ${r.note}.`;
  if (r.outcome === "refused") return `Did not remove ${slug}: ${r.reason}.`;
  if (r.outcome === "failed") return `Removing ${slug} failed: ${r.reason}.`;
  return "";
};

/** A batch in words: what was removed, which branches were kept, what was refused and why, what failed, what was not tried. Empty when declined. */
export const reportText = (r: BatchReport): string => {
  if (r.outcome === "declined") return "";
  if (r.outcome === "none") return "Nothing to remove: the last scan holds no worktree of that repo that is safe to remove in a batch.";
  const parts: string[] = [];
  parts.push(r.removed.length > 0 ? `Removed ${r.removed.length}: ${r.removed.map((x) => slugOf(x.path)).join(", ")}.` : "Removed none.");
  const kept = r.removed.filter((x) => x.branch === "kept");
  if (kept.length > 0) parts.push(`Branch kept for ${kept.length}: ${kept.map((x) => slugOf(x.path)).join(", ")}.`);
  if (r.refused.length > 0) parts.push(`Refused ${r.refused.length}: ${r.refused.map((x) => `${slugOf(x.path)} (${x.reason})`).join(", ")}.`);
  if (r.failed) parts.push(`Failed: ${slugOf(r.failed.path)} (${r.failed.reason}).`);
  if (r.notTried.length > 0) parts.push(`Not tried ${r.notTried.length}: ${r.notTried.map(slugOf).join(", ")}.`);
  return parts.join(" ");
};

/** The folders a removal or a batch removed: what leaves the cache at once. A failed removal stays a row until a scan reads it again. */
export const removedPaths = (r: FlowResult | BatchReport | Busy): string[] => {
  if ("removed" in r) return r.removed.map((x) => x.path);
  return r.outcome === "removed" ? [r.path] : [];
};

/** A remove command failed: the folder's state is not known, so the next tick should scan again without waiting out the interval. */
export const wantsRescan = (r: FlowResult | BatchReport | Busy): boolean => ("removed" in r ? r.failed !== undefined : r.outcome === "failed");

// ---------- one at a time ----------

/** A second request while a removal or a batch is running: dropped, nothing was run. */
export type Busy = { outcome: "busy" };
export const BUSY_TEXT = "A removal is already running: try again when it has finished.";

/**
 * A window's one door to removing: one removal or one batch at a time. While one runs (its confirmation
 * included), a second request is dropped and says so.
 */
export const makeRemover = (deps: FlowDeps) => {
  let running = false;
  const gate = async <T>(job: () => Promise<T>): Promise<T | Busy> => {
    if (running) return { outcome: "busy" };
    running = true;
    try { return await job(); } finally { running = false; }
  };
  return {
    one: (input: Parameters<typeof removeFlow>[0]): Promise<FlowResult | Busy> => gate(() => removeFlow(input, deps)),
    allSafe: (input: Parameters<typeof removeAllSafe>[0]): Promise<BatchReport | Busy> => gate(() => removeAllSafe(input, deps)),
  };
};

// Removing a worktree. The real-git cases remove worktrees of a repo this file builds under the OS temp folder
// and deletes afterwards; GitHub's answer there is canned text wrapped around the real `run`. No real worktree is touched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUSY_TEXT, commandParts, confirmAll, confirmOne, ignoredNames, inUseReason, makeRemover, NOT_OFFERED, NOTE, prepareRemoval, REASON, removeAllSafe, removeCommandOf, removedPaths, removeFlow, removeOne, realExists,
  realLinkFs, REMOVE_TIMEOUT_MS, reportText, resultText, wantsRescan,
  type BatchReport, type FlowDeps, type LinkFs, type Prepared, type RemoveDeps, type RemoveInput, type RemoveResult, type UseState,
} from "../src/worktrees/close.ts";
import { collectRepo } from "../src/worktrees/collect.ts";
import { parseWorktreeList } from "../src/worktrees/parse.ts";
import { ok, realRun, type Run, type RunResult } from "../src/worktrees/run.ts";
import type { ScanFile } from "../src/worktrees/scan.ts";
import { walkSize, type WalkResult } from "../src/worktrees/size.ts";
import { verdictOf, type Facts } from "../src/worktrees/verdict.ts";
import { bad, fakeRun, good, repoTable, scannedRepo, scannedWt, SHA, type Call, type Table } from "./worktrees-fixtures.ts";

// ---------- a real repo under the OS temp folder ----------

let root = "";
let repo = "";
let shared = "";
/** What the canned GitHub answers: one entry per branch a test gave a pull request. */
const prs: { number: number; state: string; headRefName: string; headRefOid: string; updatedAt: string; isCrossRepository: boolean }[] = [];
/** Every call any test made through the wrapped run. */
const everyCall: Call[] = [];

const ID = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", "-c", "protocol.file.allow=always"];
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `add ${file}`);
};
const headOf = (cwd: string) => git(cwd, "rev-parse", "HEAD").trim();
const branchExists = (name: string) => {
  try { git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`); return true; } catch { return false; }
};

/** The real run with `gh` answered from `prs`; `gh: "down"` makes GitHub not answer. Every call is recorded. */
const wrapped = (gh: "up" | "down" = "up", log: Call[] = []): Run => async (cmd, args, opts) => {
  const call = { cmd, args: [...args], cwd: opts.cwd };
  log.push(call);
  everyCall.push(call);
  if (cmd !== "gh") return realRun(cmd, args, opts);
  if (gh === "down") return bad(1, "gh: not logged in");
  const at = args.indexOf("--head");
  return good(JSON.stringify(at === -1 ? prs : prs.filter((p) => p.headRefName === args[at + 1])));
};

type Made = { name: string; branch: string; dir: string };
let nextPr = 300;
/** A linked worktree beside the repo with one pushed commit, and a pull request in the given state on that commit. */
const make = (name: string, pr: "MERGED" | "CLOSED" | "OPEN" | "none" = "MERGED"): Made => {
  const dir = join(root, `acme-app-${name}`);
  const branch = `feat/${name}`;
  git(repo, "worktree", "add", "-q", dir, "-b", branch, "origin/main");
  commit(dir, `${name}.txt`, `${name}\n`);
  git(dir, "push", "-q", "-u", "origin", branch);
  if (pr !== "none") prs.push({ number: nextPr++, state: pr, headRefName: branch, headRefOid: headOf(dir), updatedAt: "2026-01-02T00:00:00Z", isCrossRepository: false });
  return { name, branch, dir };
};

/** The repo's entries as git prints them now: the paths a scan would hold. */
const listed = () => parseWorktreeList(git(repo, "worktree", "list", "--porcelain"));
const entry = (name: string) => {
  const e = listed().find((w) => w.path.replace(/\\/g, "/").endsWith(`/acme-app-${name}`));
  assert.ok(e, `git lists no worktree named acme-app-${name}`);
  return e;
};
const mainPath = () => listed()[0].path;

const deps = (over: Partial<RemoveDeps> = {}, log: Call[] = []): RemoveDeps => ({
  run: wrapped("up", log),
  listServers: async () => [],
  exists: realExists,
  walk: (folder, onLink) => walkSize(folder, undefined, undefined, onLink),
  inUse: () => undefined,
  home: "/home/dev",
  ...over,
});

/** Remove the named worktree as a row of the last scan would ask: with the HEAD and branch git lists for it now. */
const remove = (name: string, d: RemoveDeps, over: Partial<RemoveInput> = {}): Promise<RemoveResult> => {
  const e = entry(name);
  return removeOne({ repoPath: mainPath(), path: e.path, seen: { head: e.head, branch: e.branch }, command: "", ...over }, d);
};

const linkDir = (target: string, path: string): string | undefined => {
  try { symlinkSync(target, path, "junction"); return undefined; } catch (e) { return e instanceof Error ? e.message : String(e); }
};
const unlinkDir = (path: string) => { try { unlinkSync(path); } catch { try { rmdirSync(path); } catch { /* already gone */ } } };
const LINKED = ["linked", "ignored", "nm-fail", "nm-stuck"];

let w: Record<string, Made> = {};
let orphanDir = "";
let junctionRefused: string | undefined;

before(() => {
  root = mkdtempSync(join(tmpdir(), "questlog-remove-"));
  const origin = join(root, "origin.git");
  repo = join(root, "acme-app");
  shared = join(root, "shared-modules");
  mkdirSync(origin);
  mkdirSync(repo);
  mkdirSync(join(shared, "pkg"), { recursive: true });
  writeFileSync(join(shared, "pkg", "index.js"), "module.exports = 1;\n");
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(repo, "init", "-q", "-b", "main");
  commit(repo, "readme.txt", "one\n");
  commit(repo, ".gitignore", "node_modules\ncache-link\n.env.local\ndist\n");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");

  for (const name of ["three-a", "three-b", "three-c", "dirty", "moved", "kept", "otherlink", "nogh", "inuse", "after-merge", "bulk-ok", ...LINKED]) w[name] = make(name);
  w["closed-pr"] = make("closed-pr", "CLOSED");
  w["open-pr"] = make("open-pr", "OPEN");

  writeFileSync(join(w.dirty.dir, "notes.txt"), "not added\n");
  // A branch used again after its pull request merged: one more commit, pushed
  commit(w["after-merge"].dir, "later.txt", "later\n");
  git(w["after-merge"].dir, "push", "-q", "origin", w["after-merge"].branch);
  // Ignored junctions to a folder outside the worktree, as a shared node_modules is
  for (const name of LINKED) junctionRefused ??= linkDir(shared, join(w[name].dir, "node_modules"));
  junctionRefused ??= linkDir(shared, join(w.otherlink.dir, "cache-link"));
  // Ignored files of the kind a person keeps in a worktree
  writeFileSync(join(w.ignored.dir, ".env.local"), "SECRET=1\n");
  mkdirSync(join(w.ignored.dir, "dist"));
  writeFileSync(join(w.ignored.dir, "dist", "out.js"), "x\n");

  orphanDir = join(root, "acme-app-orphan");
  git(repo, "worktree", "add", "-q", "--detach", orphanDir, "origin/main");
});

after(() => {
  if (!root) return;
  // Never walk through a junction when tidying up
  for (const name of LINKED) unlinkDir(join(root, `acme-app-${name}`, "node_modules"));
  unlinkDir(join(root, "acme-app-otherlink", "cache-link"));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const removes = (log: Call[]) => log.filter((c) => c.args[0] === "worktree" && c.args[1] === "remove");

test("real git: three worktrees of one repo in one parent folder, the named one is the one removed, with its branch", async () => {
  const log: Call[] = [];
  const r = await remove("three-b", deps({}, log));
  assert.deepEqual(r, { outcome: "removed", path: r.path, branch: "deleted", note: "folder and branch removed" });
  assert.equal(existsSync(w["three-b"].dir), false);
  assert.equal(existsSync(w["three-a"].dir), true);
  assert.equal(existsSync(w["three-c"].dir), true);
  assert.deepEqual([branchExists("feat/three-a"), branchExists("feat/three-b"), branchExists("feat/three-c")], [true, false, true]);
  // One remove from the main checkout for the named worktree, then one forced delete of its branch only
  assert.equal(removes(log).length, 1);
  assert.equal(removes(log)[0].args.length, 3);
  assert.match(removes(log)[0].args[2].replace(/\\/g, "/"), /\/acme-app-three-b$/);
  assert.equal(removes(log)[0].cwd, mainPath());
  assert.deepEqual(log.filter((c) => c.args[0] === "branch").map((c) => [c.args, c.cwd]), [[["branch", "-D", "feat/three-b"], mainPath()]]);
  // No git call was made inside the two siblings
  assert.equal(log.some((c) => /three-[ac]$/.test(c.cwd.replace(/\\/g, "/"))), false);
});

test("real git: a merged clean worktree is removed and git no longer lists it", async () => {
  const r = await remove("three-a", deps());
  assert.equal(r.outcome, "removed");
  assert.equal(existsSync(w["three-a"].dir), false);
  assert.equal(listed().some((e) => e.path.replace(/\\/g, "/").endsWith("/acme-app-three-a")), false);
});

test("real git: a dirty worktree is refused and nothing is run on it", async () => {
  const log: Call[] = [];
  const r = await remove("dirty", deps({}, log));
  assert.deepEqual(r, { outcome: "refused", path: r.path, reason: "1 untracked file" });
  assert.equal(existsSync(join(w.dirty.dir, "notes.txt")), true);
  assert.equal(removes(log).length, 0);
  assert.equal(log.some((c) => c.args[0] === "branch"), false);
});

test("real git: refused when HEAD or the branch changed after the scan", async () => {
  const log: Call[] = [];
  const e = entry("moved");
  const head = await remove("moved", deps({}, log), { seen: { head: SHA(7), branch: e.branch } });
  assert.deepEqual(head, { outcome: "refused", path: e.path, reason: "changed since the last scan" });
  const branch = await remove("moved", deps({}, log), { seen: { head: e.head, branch: "feat/another" } });
  assert.deepEqual(branch, { outcome: "refused", path: e.path, reason: REASON.changed });
  assert.equal(existsSync(w.moved.dir), true);
  assert.equal(removes(log).length, 0);
});

test("real git: a pull request closed without merging, with every commit pushed, removes the folder and the branch", async () => {
  const log: Call[] = [];
  const r = await remove("closed-pr", deps({}, log));
  assert.deepEqual(r, { outcome: "removed", path: r.path, branch: "deleted", note: "folder and branch removed" });
  assert.equal(existsSync(w["closed-pr"].dir), false);
  assert.equal(branchExists("feat/closed-pr"), false);
});

test("real git: an orphan is removed and no branch is touched", async () => {
  const log: Call[] = [];
  const e = entry("orphan");
  assert.equal(e.detached, true);
  const r = await remove("orphan", deps({}, log));
  assert.deepEqual(r, { outcome: "removed", path: e.path, branch: "untouched", note: "folder removed" });
  assert.equal(existsSync(orphanDir), false);
  assert.equal(log.some((c) => c.args[0] === "branch"), false);
});

test("real git: a commit that lands on the branch after the first check keeps the branch, and the report says why", async () => {
  const base = wrapped();
  const log: Call[] = [];
  // Right after the folder is removed, a commit appears on the branch that is on neither its upstream nor its pull request
  const run: Run = async (cmd, args, opts) => {
    const r = await base(cmd, args, opts);
    log.push({ cmd, args: [...args], cwd: opts.cwd });
    if (cmd === "git" && args[0] === "worktree" && args[1] === "remove" && ok(r)) {
      const tree = git(repo, "rev-parse", `${w.kept.branch}^{tree}`).trim();
      const parent = git(repo, "rev-parse", w.kept.branch).trim();
      git(repo, "update-ref", `refs/heads/${w.kept.branch}`, git(repo, "commit-tree", tree, "-p", parent, "-m", "late").trim());
    }
    return r;
  };
  const r = await remove("kept", deps({ run }));
  assert.deepEqual(r, { outcome: "removed", path: r.path, branch: "kept", note: "folder removed, branch kept because it has commits that are not on its upstream or its pull request" });
  assert.equal(existsSync(w.kept.dir), false);
  assert.equal(branchExists("feat/kept"), true);
  assert.equal(log.some((c) => c.args[0] === "branch"), false);
});

test("real git: a junction node_modules is unlinked, the worktree is removed, and the folder it pointed to is untouched", async (t) => {
  if (junctionRefused) { t.skip(`the system refused to make a folder link: ${junctionRefused}`); return; }
  const log: Call[] = [];
  const r = await remove("linked", deps({}, log));
  assert.deepEqual(r, { outcome: "removed", path: r.path, branch: "deleted", note: "folder and branch removed, node_modules link removed first" });
  assert.equal(existsSync(w.linked.dir), false);
  assert.equal(existsSync(join(shared, "pkg", "index.js")), true);
  assert.equal(removes(log).length, 1);
  assert.equal(resultText(r), `Removed acme-app-linked: folder and branch removed, node_modules link removed first.`);
});

test("real git: the confirmation names the ignored files and says node_modules is a link; node_modules is never listed", async (t) => {
  if (junctionRefused) { t.skip(`the system refused to make a folder link: ${junctionRefused}`); return; }
  const e = entry("ignored");
  const prep = await prepareRemoval(e.path, "", { run: wrapped() });
  assert.deepEqual(prep, { ignored: [".env.local", "dist/"], nodeModulesLink: true });
  // A custom command unlinks nothing, so the link line is not asked
  assert.deepEqual(await prepareRemoval(e.path, "tool {path}", { run: wrapped() }), { ignored: [".env.local", "dist/"], nodeModulesLink: false });
  const ask = confirmOne({ path: e.path, branch: e.branch, reason: "PR #1 merged, clean" }, "", prep as Prepared);
  assert.equal(ask.detail, [
    e.path, `Branch ${e.branch}`, "PR #1 merged, clean", "",
    "It is checked again first, then removed with git worktree remove, never by force.",
    "node_modules is a link to another folder. The link is removed first. The folder it points to is not touched.",
    "Ignored files and folders that will be deleted:", ".env.local", "dist/",
  ].join("\n"));
  const r = await remove("ignored", deps());
  assert.equal(r.outcome, "removed");
  assert.equal(existsSync(w.ignored.dir), false);
  assert.equal(existsSync(join(shared, "pkg", "index.js")), true);
});

test("real git: a link that cannot be removed fails with nothing else removed; a link still there after the unlink fails the same way", async (t) => {
  if (junctionRefused) { t.skip(`the system refused to make a folder link: ${junctionRefused}`); return; }
  const log: Call[] = [];
  const stuck: LinkFs = { lstat: realLinkFs.lstat, unlink: async () => { throw new Error("EPERM boom"); }, rmdir: async () => { throw new Error("EPERM boom"); } };
  const r = await remove("nm-fail", deps({ fs: stuck }, log));
  assert.deepEqual(r, { outcome: "failed", path: r.path, reason: "could not remove the node_modules link: EPERM boom. Nothing else was removed", partly: false });
  assert.equal(resultText(r), "Removing acme-app-nm-fail failed: could not remove the node_modules link: EPERM boom. Nothing else was removed.");
  assert.equal(existsSync(w["nm-fail"].dir), true);
  assert.equal(existsSync(join(w["nm-fail"].dir, "node_modules")), true);
  assert.equal(removes(log).length, 0);
  assert.equal(log.some((c) => c.args[0] === "branch"), false);
  // The unlink says it worked and the link is still there
  const log2: Call[] = [];
  const noop: LinkFs = { lstat: realLinkFs.lstat, unlink: async () => undefined, rmdir: async () => undefined };
  const r2 = await remove("nm-stuck", deps({ fs: noop }, log2));
  assert.deepEqual(r2, { outcome: "failed", path: r2.path, reason: "the node_modules link is still there after removing it", partly: false });
  assert.equal(existsSync(w["nm-stuck"].dir), true);
  assert.equal(removes(log2).length, 0);
});

test("real git: any link other than node_modules is refused, and the folder it points to and its file are still there", async (t) => {
  if (junctionRefused) { t.skip(`the system refused to make a folder link: ${junctionRefused}`); return; }
  const log: Call[] = [];
  const r = await remove("otherlink", deps({}, log));
  assert.deepEqual(r, { outcome: "refused", path: r.path, reason: "holds a linked folder other than node_modules: cache-link" });
  // Its node_modules link was not touched either: the refusal comes first
  assert.equal(existsSync(w.otherlink.dir), true);
  assert.equal(existsSync(join(shared, "pkg", "index.js")), true);
  assert.equal(removes(log).length, 0);
});

test("real git: GitHub not answering refuses", async () => {
  const log: Call[] = [];
  const r = await remove("nogh", deps({ run: wrapped("down", log) }));
  assert.deepEqual(r, { outcome: "refused", path: r.path, reason: "could not ask GitHub" });
  assert.equal(existsSync(w.nogh.dir), true);
  assert.equal(removes(log).length, 0);
});

test("real git: an open pull request refuses", async () => {
  const r = await remove("open-pr", deps());
  assert.equal(r.outcome, "refused");
  assert.match(r.outcome === "refused" ? r.reason : "", /^PR #\d+ open$/);
  assert.equal(existsSync(w["open-pr"].dir), true);
});

test("real git: a folder in use is refused with the reason it was given", async () => {
  const asked: string[] = [];
  const log: Call[] = [];
  const r = await remove("inuse", deps({ inUse: (p) => { asked.push(p); return "a session is running here"; } }, log));
  assert.deepEqual(r, { outcome: "refused", path: r.path, reason: "a session is running here" });
  assert.deepEqual(asked, [entry("inuse").path]);
  assert.equal(existsSync(w.inuse.dir), true);
  // A test that throws is a refusal too, never a go-ahead
  const thrown = await remove("inuse", deps({ inUse: () => { throw new Error("no rows"); } }, log));
  assert.deepEqual(thrown, { outcome: "refused", path: thrown.path, reason: REASON.noUseCheck });
  assert.equal(removes(log).length, 0);
});

test("real git: the main checkout and a made-up path are refused", async () => {
  const log: Call[] = [];
  const main = listed()[0];
  const asMain = await removeOne({ repoPath: main.path, path: main.path, seen: { head: main.head, branch: main.branch }, command: "" }, deps({}, log));
  assert.deepEqual(asMain, { outcome: "refused", path: main.path, reason: "not a linked worktree of this repo" });
  const madeUp = join(root, "acme-app-no-such-worktree");
  const asMadeUp = await removeOne({ repoPath: main.path, path: madeUp, seen: { head: main.head, branch: "feat/x" }, command: "" }, deps({}, log));
  assert.deepEqual(asMadeUp, { outcome: "refused", path: madeUp, reason: REASON.notLinked });
  // A real folder that is no worktree of the repo is refused as well
  const asShared = await removeOne({ repoPath: main.path, path: shared, seen: { head: main.head, branch: "main" }, command: "" }, deps({}, log));
  assert.equal(asShared.outcome, "refused");
  assert.equal(existsSync(repo), true);
  assert.equal(existsSync(shared), true);
  assert.equal(removes(log).length, 0);
});

test("real git: in a batch, a branch with a commit after its merged pull request's head is refused", async () => {
  const log: Call[] = [];
  const r = await remove("after-merge", deps({}, log), { bulk: true });
  assert.deepEqual(r, { outcome: "refused", path: r.path, reason: "has commits after its merged pull request" });
  assert.equal(existsSync(w["after-merge"].dir), true);
  assert.equal(removes(log).length, 0);
});

test("real git: in a batch, a merged worktree at its pull request's head is removed", async () => {
  const r = await remove("bulk-ok", deps(), { bulk: true });
  assert.equal(r.outcome, "removed");
  assert.equal(existsSync(w["bulk-ok"].dir), false);
});

test("real git: across every removal above, the folder was never forced, and -D went only to `git branch`", () => {
  assert.equal(everyCall.some((c) => c.args.includes("--force") || c.args.includes("-f")), false);
  for (const c of everyCall.filter((x) => x.args.includes("-D"))) assert.deepEqual([c.cmd, c.args[0]], ["git", "branch"]);
  const all = removes(everyCall);
  assert.ok(all.length >= 6);
  for (const c of all) assert.equal(c.args.length, 3);
});

// ---------- a fake run: what real git cannot be made to do on demand ----------

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";
const WTS = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/a" }, { path: B, branch: "feat/b" }, { path: C, branch: "feat/c" }];
const prOf = (number: number, state: string, headRefName: string, headRefOid = SHA(1)) =>
  ({ number, state, headRefName, headRefOid, updatedAt: "2026-01-02T00:00:00Z", isCrossRepository: false });
const MERGED = [prOf(7, "MERGED", "feat/a"), prOf(8, "MERGED", "feat/b"), prOf(9, "MERGED", "feat/c")];
const REMOVE_A = `${MAIN}|git worktree remove ${A}`;
const LS_IGNORED = "git ls-files --others --ignored --exclude-standard --directory -z";

/** What the second check reads from the main checkout for one branch, and the delete that follows it. `behind` is what rev-list counts. */
const branchTable = (n: string, behind = "0\n"): Table => ({
  [`${MAIN}|git rev-parse --verify --quiet refs/remotes/origin/feat/${n}`]: good(SHA(1)),
  [`${MAIN}|git rev-list --count refs/heads/feat/${n} --not refs/remotes/origin/feat/${n}`]: good(behind),
  [`${MAIN}|git branch -D feat/${n}`]: good(""),
});
const BRANCH_A = branchTable("a");

type Seen = { cmd: string; args: string[]; cwd: string; timeoutMs?: number };
/** A fake run that also keeps the time limit each call was given, and deps whose folder is gone once `goneAfter` has run. */
const rig = (table: Table, over: Partial<RemoveDeps> = {}, goneAfter: (c: Seen) => boolean = (c) => c.args[0] === "worktree" && c.args[1] === "remove") => {
  const fake = fakeRun(table);
  const seen: Seen[] = [];
  let gone = false;
  const walked: string[] = [];
  const run: Run = async (cmd, args, opts) => {
    const c = { cmd, args: [...args], cwd: opts.cwd, timeoutMs: opts.timeoutMs };
    seen.push(c);
    const r = await fake.run(cmd, args, opts);
    if (goneAfter(c) && r.code === 0) gone = true;
    return r;
  };
  const d: RemoveDeps = {
    run,
    listServers: async () => [],
    exists: async () => !gone,
    walk: async (folder): Promise<WalkResult> => { walked.push(folder); return { bytes: 10 }; },
    inUse: () => undefined,
    home: "/home/dev",
    ...over,
  };
  return { d, seen, walked };
};
const input = (over: Partial<RemoveInput> = {}): RemoveInput => ({ repoPath: MAIN, path: A, seen: { head: SHA(1), branch: "feat/a" }, command: "", ...over });
const ranRemove = (seen: Seen[]) => seen.filter((c) => (c.cmd === "git" && (c.args[0] === "worktree" && c.args[1] === "remove" || c.args[0] === "branch")) || (c.cmd !== "git" && c.cmd !== "gh"));

test("fake: the default command is git worktree remove from the main checkout with a 10 minute limit, then the second check, then branch -D", async () => {
  const { d, seen, walked } = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), ...BRANCH_A });
  const r = await removeOne(input(), d);
  assert.deepEqual(r, { outcome: "removed", path: A, branch: "deleted", note: "folder and branch removed" });
  assert.deepEqual(ranRemove(seen).map((c) => [c.cmd, c.args, c.cwd]), [
    ["git", ["worktree", "remove", A], MAIN],
    ["git", ["branch", "-D", "feat/a"], MAIN],
  ]);
  assert.equal(ranRemove(seen)[0].timeoutMs, 10 * 60 * 1000);
  assert.equal(REMOVE_TIMEOUT_MS, 600_000);
  assert.deepEqual(walked, [A]);
  assert.equal(seen.some((c) => c.args.includes("--force") || c.args.includes("-f")), false);
  // The check is made after the folder is gone, from the main checkout, and the commit set is the branch's own
  const order = seen.map((c) => c.args.join(" "));
  assert.ok(order.indexOf(`worktree remove ${A}`) < order.indexOf("rev-list --count refs/heads/feat/a --not refs/remotes/origin/feat/a"));
  // Fresh facts were read for the one worktree only
  assert.equal(seen.some((c) => c.cwd === B || c.cwd === C), false);
});

test("fake: the branch is deleted only when every commit on it is on its upstream or its pull request head", async () => {
  const base = { ...repoTable(WTS, MERGED), [REMOVE_A]: good("") };
  // Two commits on the branch that its upstream does not hold
  const extra = rig({ ...base, ...branchTable("a", "2\n") });
  assert.deepEqual(await removeOne(input(), extra.d), { outcome: "removed", path: A, branch: "kept", note: "folder removed, branch kept because it has commits that are not on its upstream or its pull request" });
  assert.equal(extra.seen.some((c) => c.args[0] === "branch"), false);
  // No upstream and no pull request commit to compare with: nothing to prove it safe, so kept
  const none = rig({ ...base, [`${MAIN}|git branch -D feat/a`]: good("") });
  assert.equal((await removeOne(input(), none.d) as { branch: string }).branch, "kept");
  assert.equal(none.seen.some((c) => c.args[0] === "branch"), false);
  // The count could not be read
  const unread = rig({ ...base, ...BRANCH_A, [`${MAIN}|git rev-list --count refs/heads/feat/a --not refs/remotes/origin/feat/a`]: bad(128, "fatal") });
  assert.equal((await removeOne(input(), unread.d) as { branch: string }).branch, "kept");
  // The pull request's head commit is held locally: it counts as a place the commits may be, though the upstream is gone
  const viaPr = rig({
    ...repoTable(WTS, [prOf(7, "MERGED", "feat/a", SHA(2))]), [REMOVE_A]: good(""),
    [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(""), [`${A}|git rev-list --count HEAD --not refs/remotes/origin/feat/a ${SHA(2)}`]: good("0\n"),
    [`${MAIN}|git cat-file -e ${SHA(2)}^{commit}`]: good(""),
    [`${MAIN}|git rev-list --count refs/heads/feat/a --not ${SHA(2)}`]: good("0\n"), [`${MAIN}|git branch -D feat/a`]: good(""),
  });
  assert.equal((await removeOne(input({ seen: { head: SHA(1), branch: "feat/a" } }), viaPr.d) as { branch: string }).branch, "deleted");
});

test("fake: when git cannot delete the branch the folder is still removed and the note says why", async () => {
  const { d } = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), ...BRANCH_A, [`${MAIN}|git branch -D feat/a`]: bad(1, "error: cannot delete branch 'feat/a' used by worktree at '/elsewhere'\nmore") });
  assert.deepEqual(await removeOne(input(), d), { outcome: "removed", path: A, branch: "kept", note: "folder removed, branch kept because git could not delete it: error: cannot delete branch 'feat/a' used by worktree at '/elsewhere'" });
});

test("fake: a custom command gets a path with a space as one argument, runs with no branch step and no link test", async () => {
  const line = `${MAIN}|C:/tools/finish.exe acme-app-feature a --dir ${A}`;
  const { d, seen, walked } = rig({ ...repoTable(WTS, MERGED), [line]: good("") }, {}, (c) => c.cmd === "C:/tools/finish.exe");
  const r = await removeOne(input({ command: "C:/tools/finish.exe {slug}  --dir {path}" }), d);
  assert.deepEqual(r, { outcome: "removed", path: A, branch: "untouched", note: "folder removed" });
  assert.deepEqual(ranRemove(seen).map((c) => [c.cmd, c.args, c.cwd, c.timeoutMs]), [
    ["C:/tools/finish.exe", ["acme-app-feature a", "--dir", A], MAIN, REMOVE_TIMEOUT_MS],
  ]);
  assert.deepEqual(walked, []);
  assert.equal(seen.some((c) => c.args[0] === "branch" || c.args[0] === "rev-list" && c.cwd === MAIN), false);
});

test("fake: a part of a custom command that starts with ~/ gets the home folder", async () => {
  assert.deepEqual(commandParts("bash ~/scripts/finish.sh {slug}", { slug: "acme-app-x", path: "/work/acme-app-x", home: "/home/dev/" }),
    ["bash", "/home/dev/scripts/finish.sh", "acme-app-x"]);
  // Only at the start of a part, and a placeholder is never read as a home folder
  assert.deepEqual(commandParts("run --to=~/x {path}", { slug: "s", path: "~/odd", home: "/home/dev" }), ["run", "--to=~/x", "~/odd"]);
  assert.deepEqual(commandParts("   ", { slug: "s", path: "p", home: "/home/dev" }), []);
  assert.deepEqual(commandParts("tool {path}/{slug}.{slug}", { slug: "s 1", path: "/a b", home: "/h" }), ["tool", "/a b/s 1.s 1"]);

  const line = `${MAIN}|/home/dev/bin/finish.sh acme-app-feature a`;
  const { d, seen } = rig({ ...repoTable(WTS, MERGED), [line]: good("") }, {}, (c) => c.cmd === "/home/dev/bin/finish.sh");
  const r = await removeOne(input({ command: "~/bin/finish.sh {slug}" }), d);
  assert.equal(r.outcome, "removed");
  assert.deepEqual(ranRemove(seen).map((c) => c.cmd), ["/home/dev/bin/finish.sh"]);
});

test("a setting that is not text reads as empty, and the empty command is the default one", async () => {
  for (const v of [undefined, null, 5, true, {}, [], ["tool"]]) {
    assert.equal(removeCommandOf(v), "", String(v));
    assert.deepEqual(commandParts(v, { slug: "s", path: "p", home: "/h" }), []);
  }
  assert.equal(removeCommandOf("  tool {path}  "), "tool {path}");
  // Handed to the removal as a number, it runs the default command and does not throw
  const { d, seen } = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), ...BRANCH_A });
  const r = await removeOne(input({ command: 5 as unknown as string }), d);
  assert.equal(r.outcome, "removed");
  assert.deepEqual(ranRemove(seen).map((c) => c.cmd), ["git", "git"]);
  assert.equal(confirmOne({ path: A, branch: "feat/a", reason: "x" }, 5 as unknown as string, { ignored: [], nodeModulesLink: false }).detail.includes("never by force"), true);
});

test("fake: a non-zero exit is a failure, and the folder is as it was", async () => {
  const line = `${MAIN}|finish acme-app-feature a`;
  const { d } = rig({ ...repoTable(WTS, MERGED), [line]: bad(3, "boom\nmore") });
  assert.deepEqual(await removeOne(input({ command: "finish {slug}" }), d), { outcome: "failed", path: A, reason: "boom", partly: false });
  const dflt = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: bad(128, "fatal: cannot remove") });
  assert.deepEqual(await removeOne(input(), dflt.d), { outcome: "failed", path: A, reason: "fatal: cannot remove", partly: false });
  assert.equal(dflt.seen.some((c) => c.args[0] === "branch"), false);
});

test("fake: exit 0 with the folder still there is not removed, and no branch is deleted", async () => {
  const line = `${MAIN}|finish acme-app-feature a`;
  const custom = rig({ ...repoTable(WTS, MERGED), [line]: good("") }, {}, () => false);
  assert.deepEqual(await removeOne(input({ command: "finish {slug}" }), custom.d), { outcome: "failed", path: A, reason: "the command finished and the folder is still there", partly: false });
  const dflt = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good("") }, {}, () => false);
  assert.deepEqual(await removeOne(input(), dflt.d), { outcome: "failed", path: A, reason: REASON.stillThere, partly: false });
  assert.equal(dflt.seen.some((c) => c.args[0] === "branch"), false);
});

test("fake: a refused re-check never starts the command", async () => {
  const line = `${MAIN}|finish acme-app-feature a`;
  const dirty = rig({ ...repoTable(WTS, MERGED), [line]: good(""), [REMOVE_A]: good(""), [`${A}|git status --porcelain`]: good(" M src/x.ts\n") });
  for (const command of ["", "finish {slug}"]) {
    assert.deepEqual(await removeOne(input({ command }), dirty.d), { outcome: "refused", path: A, reason: "1 changed file" });
  }
  assert.deepEqual(ranRemove(dirty.seen), []);
  // A status that could not be read is not clean
  const unread = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), [`${A}|git status --porcelain`]: bad(128, "fatal") });
  assert.deepEqual(await removeOne(input(), unread.d), { outcome: "refused", path: A, reason: "could not read the working tree" });
  // Stashes that could not be listed are not zero
  const stash = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), [`${MAIN}|git stash list`]: bad(1, "x") });
  assert.deepEqual(await removeOne(input(), stash.d), { outcome: "refused", path: A, reason: "could not read the stash list" });
  // An unpushed commit
  const ahead = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), [`${A}|git rev-list --count HEAD --not refs/remotes/origin/feat/a`]: good("2\n") });
  assert.deepEqual(await removeOne(input(), ahead.d), { outcome: "refused", path: A, reason: "2 commits not pushed" });
  // A repo that cannot be listed
  const broken = rig({});
  const r = await removeOne(input(), broken.d);
  assert.equal(r.outcome, "refused");
  for (const x of [unread, stash, ahead, broken]) assert.deepEqual(ranRemove(x.seen), []);
});

test("fake: a timeout reads may be partly removed", async () => {
  const cut: RunResult = { code: -1, stdout: "", stderr: "", timedOut: true };
  const { d, seen } = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: cut });
  assert.deepEqual(await removeOne(input(), d), { outcome: "failed", path: A, reason: "git worktree remove timed out; may be partly removed", partly: true });
  assert.equal(seen.some((c) => c.args[0] === "branch"), false);
  // A failure after which the folder is gone reads the same way
  const half = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: bad(1, "error: failed to delete") }, { exists: async () => false });
  assert.deepEqual(await removeOne(input(), half.d), { outcome: "failed", path: A, reason: "error: failed to delete; may be partly removed", partly: true });
});

test("fake: no way to list dev servers refuses; a server in the folder refuses; one in a sibling does not", async () => {
  const table = { ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), ...BRANCH_A };
  const blind = rig(table, { listServers: async () => undefined });
  assert.deepEqual(await removeOne(input(), blind.d), { outcome: "refused", path: A, reason: "could not check for dev servers" });
  const thrown = rig(table, { listServers: async () => { throw new Error("netstat"); } });
  assert.deepEqual(await removeOne(input(), thrown.d), { outcome: "refused", path: A, reason: REASON.noServerCheck });
  const busy = rig(table, { listServers: async () => [{ port: 3000, folder: `${A}/app` }] });
  assert.deepEqual(await removeOne(input(), busy.d), { outcome: "refused", path: A, reason: "dev server on port 3000" });
  for (const x of [blind, thrown, busy]) assert.deepEqual(ranRemove(x.seen), []);
  const sibling = rig(table, { listServers: async () => [{ port: 3000, folder: B }, { port: 3001, folder: MAIN }] });
  assert.equal((await removeOne(input(), sibling.d)).outcome, "removed");
});

test("fake: the default command refuses a folder with any link but a top-level node_modules, or a walk that did not finish", async () => {
  const table = { ...repoTable(WTS, MERGED), [REMOVE_A]: good("") };
  const cases: [WalkResult | Error, string][] = [
    [{ bytes: 1, links: 1 }, `${REASON.otherLink}: a linked folder`],
    [{ bytes: 1, sharesNodeModules: true, links: 2 }, `${REASON.otherLink}: a linked folder`],
    [{ bytes: 1, cutShort: true }, REASON.noLinkCheck],
    [{ bytes: 1, skipped: true }, REASON.noLinkCheck],
    [new Error("EACCES"), REASON.noLinkCheck],
  ];
  for (const [walked, reason] of cases) {
    const x = rig(table, { walk: async () => { if (walked instanceof Error) throw walked; return walked; } });
    assert.deepEqual(await removeOne(input(), x.d), { outcome: "refused", path: A, reason });
    assert.deepEqual(ranRemove(x.seen), []);
  }
  // The walk names the link it met: the first one that is not the top-level node_modules
  const named = rig(table, { walk: async (f, onLink) => { onLink?.(`${f}/node_modules`); onLink?.(`${f}/packages/web/cache`); return { bytes: 1, links: 2 }; }, fs: { lstat: async () => ({ isSymbolicLink: () => true }), unlink: async () => undefined, rmdir: async () => undefined } });
  assert.deepEqual(await removeOne(input(), named.d), { outcome: "refused", path: A, reason: "holds a linked folder other than node_modules: packages/web/cache" });
  assert.deepEqual(ranRemove(named.seen), []);
  assert.equal(REASON.noLinkCheck, "could not check the folder for linked folders: set questlog.worktrees.removeCommand");
});

test("fake: a top-level node_modules link alone is unlinked first, then the worktree is removed, in that order", async () => {
  const events: string[] = [];
  let linked = true;
  const fs: LinkFs = {
    lstat: async () => { if (!linked) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return { isSymbolicLink: () => true }; },
    unlink: async (p) => { events.push(`unlink ${String(p).replace(/\\/g, "/")}`); linked = false; },
    rmdir: async () => { events.push("rmdir"); },
  };
  const { d, seen } = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), ...BRANCH_A }, { fs, walk: async (f, onLink) => { onLink?.(`${f}/node_modules`); return { bytes: 1, links: 1 }; } });
  const r = await removeOne(input(), d);
  assert.deepEqual(r, { outcome: "removed", path: A, branch: "deleted", note: "folder and branch removed, node_modules link removed first" });
  assert.deepEqual(events, [`unlink ${A}/node_modules`]);
  assert.equal(seen.some((c) => c.args[1] === "remove"), true);
  // A junction that unlink will not take falls back to rmdir, which never follows it either
  let still = true;
  const fs2: LinkFs = { lstat: async () => { if (!still) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return { isSymbolicLink: () => true }; }, unlink: async () => { throw new Error("EPERM"); }, rmdir: async () => { still = false; } };
  const second = rig({ ...repoTable(WTS, MERGED), [REMOVE_A]: good(""), ...BRANCH_A }, { fs: fs2, walk: async () => ({ bytes: 1, links: 1 }) });
  assert.equal((await removeOne(input(), second.d)).outcome, "removed");
});

test("fake: three worktrees in one parent folder, mixed slashes and letter case still pick the named one", async () => {
  const { d, seen } = rig({ ...repoTable(WTS, MERGED), [`${MAIN}|git worktree remove ${B}`]: good(""), ...branchTable("b") });
  const r = await removeOne({ repoPath: MAIN, path: "\\WORK\\Acme-App-Feature-B", seen: { head: SHA(1).toUpperCase(), branch: "feat/b" }, command: "" }, d);
  assert.equal(r.outcome, "removed");
  assert.deepEqual(ranRemove(seen).map((c) => c.args), [["worktree", "remove", B], ["branch", "-D", "feat/b"]]);
  assert.equal(seen.some((c) => c.cwd === A || c.cwd === C), false);
});

test("fake: in a batch only a merged pull request whose head HEAD is, or is reachable from, goes ahead", async () => {
  const ok = { [REMOVE_A]: good(""), ...BRANCH_A };
  // Closed without merging: removable alone, never in a batch
  const closed = rig({ ...repoTable(WTS, [prOf(7, "CLOSED", "feat/a")]), ...ok });
  assert.deepEqual(await removeOne(input({ bulk: true }), closed.d), { outcome: "refused", path: A, reason: "not safe to remove in a batch: PR #7 closed without merging, clean" });
  // HEAD is the pull request's head: no further git question is asked
  const same = rig({ ...repoTable(WTS, MERGED), ...ok });
  assert.equal((await removeOne(input({ bulk: true }), same.d)).outcome, "removed");
  assert.equal(same.seen.some((c) => c.args[0] === "merge-base"), false);
  // HEAD is behind the pull request's head and git holds that commit: reachable, so it goes ahead
  const behind = rig({ ...repoTable(WTS, [prOf(7, "MERGED", "feat/a", SHA(2))]), ...ok, [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(""), [`${A}|git rev-list --count HEAD --not refs/remotes/origin/feat/a ${SHA(2)}`]: good("0\n"), [`${A}|git merge-base --is-ancestor HEAD ${SHA(2)}`]: good("") });
  assert.equal((await removeOne(input({ bulk: true }), behind.d)).outcome, "removed");
  // HEAD has commits the pull request never held
  const past = rig({ ...repoTable(WTS, [prOf(7, "MERGED", "feat/a", SHA(2))]), ...ok, [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(""), [`${A}|git rev-list --count HEAD --not refs/remotes/origin/feat/a ${SHA(2)}`]: good("0\n"), [`${A}|git merge-base --is-ancestor HEAD ${SHA(2)}`]: bad(1) });
  assert.deepEqual(await removeOne(input({ bulk: true }), past.d), { outcome: "refused", path: A, reason: REASON.afterMerge });
  // The pull request's head commit is not held locally: cannot tell
  const unheld = rig({ ...repoTable(WTS, [prOf(7, "MERGED", "feat/a", SHA(2))]), ...ok });
  assert.deepEqual(await removeOne(input({ bulk: true }), unheld.d), { outcome: "refused", path: A, reason: REASON.noMergeCheck });
  // GitHub gave no usable head commit
  const noOid = rig({ ...repoTable(WTS, [prOf(7, "MERGED", "feat/a", "not-a-sha")]), ...ok });
  assert.deepEqual(await removeOne(input({ bulk: true }), noOid.d), { outcome: "refused", path: A, reason: REASON.noMergeCheck });
  for (const x of [closed, past, unheld, noOid]) assert.deepEqual(ranRemove(x.seen), []);
});

// ---------- the Remove worktree button and Remove {n} safe ----------

/** The last scan as the page would have shown it, for the fake repo above: A, B and C merged and clean. */
const fakeScan = (over: Record<string, Partial<Facts>> = {}): ScanFile => ({
  version: 1, scannedAt: 1, repos: [scannedRepo(MAIN, [
    scannedWt(MAIN, "main", { main: true }),
    scannedWt(A, "feat/a", { pr: { state: "merged", number: 7, headRefOid: SHA(1) }, ...over[A] }),
    scannedWt(B, "feat/b", { pr: { state: "merged", number: 8, headRefOid: SHA(1) }, ...over[B] }),
    scannedWt(C, "feat/c", { pr: { state: "merged", number: 9, headRefOid: SHA(1) }, ...over[C] }),
  ])],
});
const ALL_OK: Table = Object.fromEntries([[A, "a"], [B, "b"], [C, "c"]].flatMap(([p, n]) => [
  [`${MAIN}|git worktree remove ${p}`, good("")], [`${p}|${LS_IGNORED}`, good("")], ...Object.entries(branchTable(n)),
]));
/** Deps whose folders go one by one as their remove runs, and a confirmation that records what it was asked. */
const flowRig = (table: Table, answer: boolean | (() => Promise<boolean>) = true, over: Partial<RemoveDeps> = {}) => {
  const fake = fakeRun(table);
  const seen: Seen[] = [];
  const gone = new Set<string>();
  const asked: { title: string; detail: string }[] = [];
  const d: FlowDeps = {
    run: async (cmd, args, opts) => {
      seen.push({ cmd, args: [...args], cwd: opts.cwd, timeoutMs: opts.timeoutMs });
      const r = await fake.run(cmd, args, opts);
      if (args[0] === "worktree" && args[1] === "remove" && r.code === 0) gone.add(args[2]);
      return r;
    },
    listServers: async () => [],
    exists: async (p) => !gone.has(p),
    walk: async (): Promise<WalkResult> => ({ bytes: 10 }),
    inUse: () => undefined,
    home: "/home/dev",
    confirm: async (ask) => { asked.push(ask); return typeof answer === "function" ? answer() : answer; },
    ...over,
  };
  return { d, seen, asked };
};
const removed = (seen: Seen[]) => seen.filter((c) => c.args[0] === "worktree" && c.args[1] === "remove").map((c) => c.args[2]);

test("flow: three worktrees in one parent folder, the clicked one is confirmed by name and is the one removed", async () => {
  const { d, seen, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK });
  const r = await removeFlow({ scan: fakeScan(), path: "\\WORK\\Acme-App-Feature-B", command: "" }, d);
  assert.deepEqual(r, { outcome: "removed", path: B, branch: "deleted", note: "folder and branch removed" });
  assert.deepEqual(removed(seen), [B]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Remove worktree acme-app-feature-b?");
  assert.equal(asked[0].detail, [
    B,
    "Branch feat/b",
    "PR #8 merged, clean",
    "",
    "It is checked again first, then removed with git worktree remove, never by force.",
    "No ignored files or folders other than node_modules.",
  ].join("\n"));
  assert.equal(resultText(r), "Removed acme-app-feature-b: folder and branch removed.");
  assert.deepEqual(removedPaths(r), [B]);
  assert.equal(wantsRescan(r), false);
});

test("flow: the confirmation names the ignored files, the folder, says detached for an orphan, and names the remove command when one is set", () => {
  const none: Prepared = { ignored: [], nodeModulesLink: false };
  const orphan = confirmOne({ path: "/work/acme-app-old", branch: "", detached: true, reason: "detached HEAD, clean" }, "", none);
  assert.equal(orphan.title, "Remove worktree acme-app-old?");
  assert.deepEqual(orphan.detail.split("\n").slice(0, 3), ["/work/acme-app-old", "Detached HEAD", "detached HEAD, clean"]);
  const custom = confirmOne({ path: A, branch: "feat/a", reason: "PR #7 merged, clean" }, "bash ~/finish.sh {slug}", { ignored: [".env.local", "dist/"], nodeModulesLink: false });
  assert.equal(custom.detail, [
    "/work/acme-app-feature a", "Branch feat/a", "PR #7 merged, clean", "",
    "It is checked again first, then handed to your remove command (questlog.worktrees.removeCommand).",
    "Ignored files and folders that will be deleted:", ".env.local", "dist/",
  ].join("\n"));
  assert.equal(custom.detail.includes("such as"), false);
});

test("ignoredNames: top-level names only, node_modules left out, a folder marked with a slash, sorted by letter without case", () => {
  assert.deepEqual(ignoredNames(".env.local\0dist/\0node_modules/\0src/deep/x.log\0Zed.log\0apps/web/node_modules/\0\0"), [".env.local", "apps/", "dist/", "src/", "Zed.log"]);
  assert.deepEqual(ignoredNames("node_modules\0node_modules/a/b\0"), []);
  assert.deepEqual(ignoredNames(""), []);
});

test("flow: ignored files are read in the worktree before the question and are named in it; a list that cannot be read refuses before any question", async () => {
  const table = { ...repoTable(WTS, MERGED), ...ALL_OK, [`${A}|${LS_IGNORED}`]: good(".env.local\0dist/\0node_modules/\0") };
  const { d, seen, asked } = flowRig(table);
  await removeFlow({ scan: fakeScan(), path: A, command: "" }, d);
  assert.deepEqual(asked[0].detail.split("\n").slice(-3), ["Ignored files and folders that will be deleted:", ".env.local", "dist/"]);
  const read = seen.findIndex((c) => c.args[0] === "ls-files");
  assert.ok(read >= 0 && seen[read].cwd === A);
  assert.ok(read < seen.findIndex((c) => c.args[1] === "remove"));
  const blind = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK, [`${A}|${LS_IGNORED}`]: bad(128, "fatal: not a git repository") });
  const r = await removeFlow({ scan: fakeScan(), path: A, command: "" }, blind.d);
  assert.deepEqual(r, { outcome: "refused", path: A, reason: "could not list the ignored files: fatal: not a git repository" });
  assert.deepEqual(blind.asked, []);
  assert.deepEqual(removed(blind.seen), []);
});

test("flow: declined runs nothing, and so does a confirmation that throws", async () => {
  for (const answer of [false, async () => { throw new Error("window closed"); }] as const) {
    const { d, seen, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK }, answer);
    const r = await removeFlow({ scan: fakeScan(), path: A, command: "" }, d);
    assert.deepEqual(r, { outcome: "declined", path: A });
    assert.equal(asked.length, 1);
    assert.deepEqual(removed(seen), []);
    assert.equal(seen.some((c) => c.args[0] === "branch" || c.args[1] === "remove"), false, "only the read of the ignored files ran");
    assert.equal(resultText(r), "");
    assert.deepEqual(removedPaths(r), []);
  }
  // Only a plain true goes ahead
  const odd = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK }, (async () => "Remove") as unknown as () => Promise<boolean>);
  assert.equal((await removeFlow({ scan: fakeScan(), path: A, command: "" }, odd.d)).outcome, "declined");
  assert.deepEqual(removed(odd.seen), []);
});

test("flow: a path the last scan does not offer a removal for is refused before any question: made-up, main checkout, Needs you, Missing, no scan", async () => {
  const scan = fakeScan({ [A]: { dirty: 1, changed: 1 }, [B]: { prunable: true } });
  for (const [path, s] of [["/work/made-up", scan], [MAIN, scan], [A, scan], [B, scan], [C, undefined]] as const) {
    const { d, seen, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK });
    const r = await removeFlow({ scan: s, path, command: "" }, d);
    assert.deepEqual(r, { outcome: "refused", path, reason: "the last scan does not offer a removal for it" });
    assert.deepEqual(asked, []);
    assert.deepEqual(seen, []);
  }
  assert.equal(resultText({ outcome: "refused", path: A, reason: NOT_OFFERED }), "Did not remove acme-app-feature a: the last scan does not offer a removal for it.");
});

test("flow: confirmed, the fresh re-check can still refuse, and nothing is removed", async () => {
  const { d, seen } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK, [`${A}|git status --porcelain`]: good("?? notes.txt\n") });
  const r = await removeFlow({ scan: fakeScan(), path: A, command: "" }, d);
  assert.deepEqual(r, { outcome: "refused", path: A, reason: "1 untracked file" });
  assert.deepEqual(removed(seen), []);
  const failed = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK, [`${MAIN}|git worktree remove ${A}`]: bad(1, "error: busy") });
  const f = await removeFlow({ scan: fakeScan(), path: A, command: "" }, failed.d);
  assert.equal(resultText(f), "Removing acme-app-feature a failed: error: busy.");
  assert.deepEqual(removedPaths(f), [], "a failed removal stays a row");
  assert.equal(wantsRescan(f), true);
});

test("gate: a second request while one runs is dropped and says so; the next one after it is taken", async () => {
  let release: (v: boolean) => void = () => {};
  const { d, seen, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK }, () => new Promise<boolean>((r) => { release = r; }));
  const remover = makeRemover(d);
  const first = remover.one({ scan: fakeScan(), path: A, command: "" });
  await new Promise((r) => setTimeout(r, 20));
  // The first is still at its confirmation: a second removal and a batch are both dropped
  assert.deepEqual(await remover.one({ scan: fakeScan(), path: B, command: "" }), { outcome: "busy" });
  assert.deepEqual(await remover.allSafe({ scan: fakeScan(), repoPath: MAIN, command: "" }), { outcome: "busy" });
  assert.equal(asked.length, 1);
  assert.deepEqual(removed(seen), []);
  assert.deepEqual(removedPaths({ outcome: "busy" }), []);
  assert.equal(wantsRescan({ outcome: "busy" }), false);
  assert.equal(BUSY_TEXT, "A removal is already running: try again when it has finished.");
  release(true);
  assert.deepEqual(await first, { outcome: "removed", path: A, branch: "deleted", note: "folder and branch removed" });
  assert.deepEqual(removed(seen), [A]);
  // The door is open again
  const next = remover.one({ scan: fakeScan(), path: B, command: "" });
  await new Promise((r) => setTimeout(r, 20));
  release(true);
  assert.equal((await next).outcome, "removed");
});

test("batch: the list comes from the scan, the confirmation lists every folder, and a declined batch runs nothing", async () => {
  const scan = fakeScan({ [B]: { dirty: 2, changed: 2 } });
  const { d, seen, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK }, false);
  // A path the page adds is not part of the input's type and is never read
  const r = await removeAllSafe({ scan, repoPath: "\\WORK\\Acme-App", command: "", paths: [B, "/work/elsewhere"] } as Parameters<typeof removeAllSafe>[0], d);
  assert.deepEqual(r, { repoPath: MAIN, outcome: "declined", removed: [], refused: [], notTried: [] });
  assert.deepEqual(asked, [{
    title: "Remove 2 worktrees of acme-app?",
    detail: [A, C, "", "Each is checked again first. One that is no longer safe is refused and the rest carry on. Then removed with git worktree remove, never by force, one at a time. A failure stops the rest.", "No ignored files or folders other than node_modules."].join("\n"),
  }]);
  assert.deepEqual(seen.filter((c) => c.args[0] !== "ls-files"), []);
  assert.equal(reportText(r), "");
  assert.equal(confirmAll(MAIN, [{ path: A, prep: { ignored: [], nodeModulesLink: false } }], "").title, "Remove 1 worktree of acme-app?");
});

test("batch: the confirmation lists only worktrees that have ignored files, then says the others have none; a link gets a line of its own", () => {
  const items = [
    { path: A, prep: { ignored: [".env.local", "dist/"], nodeModulesLink: true } },
    { path: B, prep: { ignored: [], nodeModulesLink: false } },
    { path: C, prep: { ignored: ["coverage/"], nodeModulesLink: false } },
  ];
  assert.equal(confirmAll(MAIN, items, "").detail, [
    A, B, C, "",
    "Each is checked again first. One that is no longer safe is refused and the rest carry on. Then removed with git worktree remove, never by force, one at a time. A failure stops the rest.",
    "acme-app-feature a: node_modules is a link to another folder. The link is removed first. The folder it points to is not touched.",
    "Ignored files and folders that will be deleted:",
    A, "  .env.local", "  dist/", C, "  coverage/",
    "Other worktrees in this list have none.",
  ].join("\n"));
  // Every one has some: no "others" line
  assert.equal(confirmAll(MAIN, [items[0], items[2]], "bash x").detail.includes("Other worktrees"), false);
  assert.match(confirmAll(MAIN, [items[0]], "bash x").detail, /Then handed to your remove command \(questlog\.worktrees\.removeCommand\), one at a time/);
});

test("batch: a made-up repo path, a worktree's path and a repo with nothing safe remove nothing and ask nothing", async () => {
  const dirty = fakeScan({ [A]: { dirty: 1, changed: 1 }, [B]: { pr: { state: "closed", number: 8 } }, [C]: { detached: true } });
  for (const [scan, repoPath] of [[fakeScan(), "/work/made-up"], [fakeScan(), A], [dirty, MAIN], [undefined, MAIN], [fakeScan(), ""]] as const) {
    const { d, seen, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK });
    const r = await removeAllSafe({ scan, repoPath, command: "" }, d);
    assert.deepEqual(r, { repoPath, outcome: "none", removed: [], refused: [], notTried: [] });
    assert.deepEqual(asked, []);
    assert.deepEqual(seen, []);
    assert.equal(reportText(r), "Nothing to remove: the last scan holds no worktree of that repo that is safe to remove in a batch.");
  }
});

test("batch: every removal is asked with the batch rule, one at a time, in the scan's order", async () => {
  const { d, seen } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK });
  const r = await removeAllSafe({ scan: fakeScan(), repoPath: MAIN, command: "" }, d);
  assert.equal(r.outcome, "ran");
  assert.deepEqual(r.removed.map((x) => x.path), [A, B, C]);
  assert.deepEqual(removed(seen), [A, B, C]);
  // One at a time: each worktree's remove comes before the next worktree's first read
  const order = seen.filter((c) => (c.args[0] === "worktree" && c.args[1] === "remove") || c.args[0] === "status").map((c) => (c.args[0] === "status" ? `read ${c.cwd}` : `remove ${c.args[2]}`));
  assert.deepEqual(order, [`read ${A}`, `remove ${A}`, `read ${B}`, `remove ${B}`, `read ${C}`, `remove ${C}`]);
  assert.equal(seen.some((c) => c.args.includes("--force") || c.args.includes("-f")), false);
  assert.equal(reportText(r), "Removed 3: acme-app-feature a, acme-app-feature-b, acme-app-feature-c.");
  assert.deepEqual(removedPaths(r), [A, B, C]);
  assert.equal(wantsRescan(r), false);
});

test("batch: a worktree refused at its re-check is skipped and the rest carry on", async () => {
  const { d, seen } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK, [`${B}|git status --porcelain`]: good("?? late.txt\n") });
  const r = await removeAllSafe({ scan: fakeScan(), repoPath: MAIN, command: "" }, d);
  assert.deepEqual(r.removed.map((x) => x.path), [A, C]);
  assert.deepEqual(r.refused, [{ path: B, reason: "1 untracked file" }]);
  assert.equal(r.failed, undefined);
  assert.deepEqual(r.notTried, []);
  assert.deepEqual(removed(seen), [A, C]);
  assert.equal(reportText(r), "Removed 2: acme-app-feature a, acme-app-feature-c. Refused 1: acme-app-feature-b (1 untracked file).");
  assert.equal(wantsRescan(r), false);
});

test("batch: a failed remove command stops the rest, which are named as not tried and are never read", async () => {
  const { d, seen } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK, [`${MAIN}|git worktree remove ${B}`]: bad(1, "error: busy") });
  const r = await removeAllSafe({ scan: fakeScan(), repoPath: MAIN, command: "" }, d);
  assert.deepEqual(r.removed.map((x) => x.path), [A]);
  assert.deepEqual(r.failed, { path: B, reason: "error: busy", partly: false });
  assert.deepEqual(r.notTried, [C]);
  assert.equal(seen.some((c) => c.cwd === C && c.args[0] !== "ls-files"), false);
  assert.equal(reportText(r), "Removed 1: acme-app-feature a. Failed: acme-app-feature-b (error: busy). Not tried 1: acme-app-feature-c.");
  assert.equal(wantsRescan(r), true);
});

test("batch: a worktree whose ignored files cannot be listed is refused and left out of the question", async () => {
  const { d, asked } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK, [`${B}|${LS_IGNORED}`]: bad(128, "fatal: broken") });
  const r = await removeAllSafe({ scan: fakeScan(), repoPath: MAIN, command: "" }, d);
  assert.equal(asked[0].title, "Remove 2 worktrees of acme-app?");
  assert.equal(asked[0].detail.includes(B), false);
  assert.deepEqual(r.removed.map((x) => x.path), [A, C]);
  assert.deepEqual(r.refused, [{ path: B, reason: "could not list the ignored files: fatal: broken" }]);
});

test("batch: the report words, the kept branches counted from each result's field and named, never from the note's text", () => {
  const r: BatchReport = {
    repoPath: MAIN, outcome: "ran",
    removed: [
      { path: A, note: NOTE.folderAndBranch, branch: "deleted" },
      { path: B, note: "a note nobody could match", branch: "kept" },
      // The wording of a kept note on a branch that was deleted does not count, and a kept branch is counted whatever its note says
      { path: C, note: `${NOTE.folder}, ${NOTE.keptCommits}`, branch: "deleted" },
      { path: "/work/acme-app-feature-g", note: NOTE.folder, branch: "untouched" },
      { path: "/work/acme-app-feature-h", note: `${NOTE.folder}, ${NOTE.keptGit}: boom`, branch: "kept" },
    ],
    refused: [{ path: "/work/acme-app-feature-d", reason: "1 untracked file" }, { path: "/work/acme-app-feature-e", reason: "open in this window" }],
    failed: { path: "/work/acme-app-feature-f", reason: "error: busy; may be partly removed", partly: true },
    notTried: ["/work/acme-app-feature-i", "/work/acme-app-feature-j"],
  };
  assert.equal(reportText(r), "Removed 5: acme-app-feature a, acme-app-feature-b, acme-app-feature-c, acme-app-feature-g, acme-app-feature-h. Branch kept for 2: acme-app-feature-b, acme-app-feature-h. Refused 2: acme-app-feature-d (1 untracked file), acme-app-feature-e (open in this window). Failed: acme-app-feature-f (error: busy; may be partly removed). Not tried 2: acme-app-feature-i, acme-app-feature-j.");
  assert.deepEqual(removedPaths(r).length, 5);
  assert.equal(wantsRescan(r), true);
  assert.equal(reportText({ repoPath: MAIN, outcome: "ran", removed: [], refused: [{ path: A, reason: "open in this window" }], notTried: [] }), "Removed none. Refused 1: acme-app-feature a (open in this window).");
});

// ---------- batches on real git, each in a repo of its own under the OS temp folder ----------

/** A second repo beside the first, so a batch's list holds only what its test made. */
const batchRepo = (name: string) => {
  const origin = join(root, `${name}.git`);
  const dir = join(root, name);
  mkdirSync(origin);
  mkdirSync(dir);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "readme.txt", "one\n");
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "-u", "origin", "main");
  git(dir, "remote", "set-head", "origin", "main");
  const add = (wt: string, pr: "MERGED" | "none" = "MERGED") => {
    const path = join(root, `${name}-${wt}`);
    const branch = `feat/${name}-${wt}`;
    git(dir, "worktree", "add", "-q", path, "-b", branch, "origin/main");
    commit(path, `${wt}.txt`, `${wt}\n`);
    git(path, "push", "-q", "-u", "origin", branch);
    if (pr !== "none") prs.push({ number: nextPr++, state: pr, headRefName: branch, headRefOid: headOf(path), updatedAt: "2026-01-02T00:00:00Z", isCrossRepository: false });
    return path;
  };
  /** The scan as a real scan would write it for this repo: fresh facts and the verdict the real rule gives them. */
  const scan = async (): Promise<ScanFile> => {
    const facts = await collectRepo(dir, wrapped());
    assert.equal(facts.error, undefined);
    const worktrees = facts.worktrees.map((f) => { const verdict = verdictOf(f); return verdict ? { ...f, verdict } : { ...f }; });
    return { version: 1, scannedAt: 1, repos: [{ path: worktrees.find((x) => x.main)!.path, defaultBranch: "main", tookMs: 1, worktrees }] };
  };
  return { dir, add, scan };
};
const flowDeps = (log: Call[], over: Partial<FlowDeps> = {}): FlowDeps => ({ ...deps({}, log), confirm: async () => true, ...over });
const tail = (p: string) => p.replace(/\\/g, "/").split("/").pop();

test("real git batch: three safe and one unsafe, the three are removed and the unsafe one survives", async () => {
  const r = batchRepo("depot");
  const safe = [r.add("one"), r.add("two"), r.add("three")];
  const unsafe = r.add("dirty");
  writeFileSync(join(unsafe, "notes.txt"), "not added\n");
  const scan = await r.scan();
  const log: Call[] = [];
  const asked: { title: string; detail: string }[] = [];
  const report = await removeAllSafe({ scan, repoPath: scan.repos[0].path, command: "" }, flowDeps(log, { confirm: async (a) => { asked.push(a); return true; } }));
  assert.equal(report.outcome, "ran");
  assert.deepEqual(report.removed.map((x) => tail(x.path)).sort(), ["depot-one", "depot-three", "depot-two"]);
  assert.deepEqual(report.removed.map((x) => x.branch), ["deleted", "deleted", "deleted"]);
  assert.deepEqual(report.refused, []);
  assert.equal(report.failed, undefined);
  assert.deepEqual(report.notTried, []);
  for (const p of safe) assert.equal(existsSync(p), false);
  assert.equal(existsSync(join(unsafe, "notes.txt")), true);
  // The unsafe one was never in the list: the confirmation did not name it and no command ran in or on it
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Remove 3 worktrees of depot?");
  assert.equal(asked[0].detail.includes("depot-dirty"), false);
  assert.equal(log.some((c) => c.args.some((a) => a.replace(/\\/g, "/").endsWith("/depot-dirty"))), false);
  assert.equal(removes(log).length, 3);
  assert.equal(existsSync(r.dir), true);
});

test("real git batch: a failure on the second stops the third", async () => {
  const r = batchRepo("ledger");
  r.add("one"); r.add("two"); r.add("three");
  const scan = await r.scan();
  const order = scan.repos[0].worktrees.filter((x) => !x.main).map((x) => x.path);
  assert.equal(order.length, 3);
  const log: Call[] = [];
  const real = wrapped("up", log);
  // The second remove fails without touching the folder; everything else is real git
  const run: Run = async (cmd, args, opts) => (args[0] === "worktree" && args[1] === "remove" && args[2] === order[1] ? (log.push({ cmd, args: [...args], cwd: opts.cwd }), bad(1, "error: failed to delete")) : real(cmd, args, opts));
  const report = await removeAllSafe({ scan, repoPath: scan.repos[0].path, command: "" }, flowDeps(log, { run }));
  assert.deepEqual(report.removed.map((x) => x.path), [order[0]]);
  assert.deepEqual(report.failed, { path: order[1], reason: "error: failed to delete", partly: false });
  assert.deepEqual(report.notTried, [order[2]]);
  assert.deepEqual([existsSync(order[0]), existsSync(order[1]), existsSync(order[2])], [false, true, true]);
  // Nothing was run on the third but the read of its ignored files before the question: no re-check, no remove
  assert.equal(log.some((c) => (c.cwd === order[2] && c.args[0] !== "ls-files") || c.args.includes(order[2])), false);
  assert.match(reportText(report), /^Removed 1: ledger-\w+\. Failed: ledger-\w+ \(error: failed to delete\)\. Not tried 1: ledger-\w+\.$/);
});

test("real git batch: a worktree refused at its re-check is skipped and the rest are removed; a branch with a commit after its merged pull request is skipped", async () => {
  const r = batchRepo("atlas");
  const one = r.add("one");
  const changed = r.add("changed");
  const later = r.add("later");
  const two = r.add("two");
  // Used again after its pull request merged: one more commit, pushed. The verdict still reads closable and safe.
  commit(later, "more.txt", "more\n");
  git(later, "push", "-q", "origin", "feat/atlas-later");
  const scan = await r.scan();
  assert.equal(scan.repos[0].worktrees.filter((x) => x.verdict?.safeForBulk).length, 4, "all four read safe in the scan");
  // After the scan, before the batch: a file appears in one of them
  writeFileSync(join(changed, "notes.txt"), "written after the scan\n");
  const log: Call[] = [];
  const report = await removeAllSafe({ scan, repoPath: scan.repos[0].path, command: "" }, flowDeps(log));
  assert.deepEqual(report.removed.map((x) => tail(x.path)).sort(), ["atlas-one", "atlas-two"]);
  assert.deepEqual(report.refused.map((x) => [tail(x.path), x.reason]).sort(), [["atlas-changed", "1 untracked file"], ["atlas-later", "has commits after its merged pull request"]]);
  assert.equal(report.failed, undefined);
  assert.deepEqual(report.notTried, []);
  assert.deepEqual([existsSync(one), existsSync(two), existsSync(changed), existsSync(later)], [false, false, true, true]);
  assert.equal(existsSync(join(changed, "notes.txt")), true);
  assert.equal(removes(log).length, 2);
  assert.equal(log.some((c) => c.args.includes("--force") || c.args.includes("-f")), false);
});

// ---------- in use ----------

test("inUseReason: a folder open in this window, a running session in it, and a recent one when the running ones could not be listed; all from memory", () => {
  const WT = "/work/acme-app-feature-a";
  const NOW = 10_000_000;
  const rows = [{ id: "s1", cwd: `${WT}/src`, updatedAt: NOW - 60 * 60 * 1000 }, { id: "s2", cwd: "/work/acme-app-feature-b", updatedAt: NOW }, { id: "s3", updatedAt: NOW }];
  const state = (over: Partial<UseState> = {}): UseState => ({ rows, live: new Map(), folders: [], now: NOW, ...over });
  assert.equal(inUseReason(WT, state()), undefined);
  // This window has the worktree, or a folder inside it, open; a sibling or the parent folder does not count
  assert.equal(inUseReason(WT, state({ folders: ["\\WORK\\Acme-App-Feature-A"] })), "open in this window");
  assert.equal(inUseReason(WT, state({ folders: [`${WT}/extension`] })), "open in this window");
  assert.equal(inUseReason(WT, state({ folders: ["/work/acme-app-feature-b", "/work", "/work/acme-app-feature-a2"] })), undefined);
  // A running session in the worktree or a folder inside it; one in a sibling does not count
  assert.equal(inUseReason(WT, state({ live: new Map([["s1", {}]]) })), "a session is running in it");
  assert.equal(inUseReason(WT, state({ live: new Map([["s2", {}], ["s3", {}]]) })), undefined);
  // The running sessions could not be listed: a session there updated in the last 15 minutes counts, an older one does not
  assert.equal(inUseReason(WT, state({ live: undefined })), undefined);
  assert.equal(inUseReason(WT, state({ live: undefined, rows: [{ id: "s1", cwd: WT, updatedAt: NOW - 14 * 60 * 1000 }] })), "a session was active in it in the last 15 minutes");
  assert.equal(inUseReason(WT, state({ live: undefined, rows: [{ id: "s1", cwd: WT, updatedAt: NOW - 15 * 60 * 1000 }] })), undefined);
});

test("the click path reads no file of its own: the in-use test is a plain function of memory, and the file system is reached only through the injected async parts", async () => {
  const touched: string[] = [];
  const fs: LinkFs = {
    lstat: async (p) => { touched.push(`lstat ${p}`); throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
    unlink: async () => undefined,
    rmdir: async () => undefined,
  };
  const inUse = (p: string) => inUseReason(p, { rows: [], live: new Map(), folders: [], now: 1 });
  // The in-use test hands back a value, not a promise: it cannot have waited on a file
  assert.equal(typeof (inUse(A) as unknown as { then?: unknown } | undefined)?.then, "undefined");
  const { d } = flowRig({ ...repoTable(WTS, MERGED), ...ALL_OK }, true, { fs, inUse });
  assert.equal((await removeFlow({ scan: fakeScan(), path: A, command: "" }, d)).outcome, "removed");
  assert.ok(touched.length > 0 && touched.every((x) => x.startsWith("lstat ") && x.includes("node_modules")), touched.join(", "));
});

test("fake: removeOne never throws: a run that throws before the command is a refusal, during it a failure that may be partly removed", async () => {
  const early: RemoveDeps = { ...rig({}).d, run: async () => { throw new Error("spawn EPERM"); } };
  assert.deepEqual(await removeOne(input(), early), { outcome: "refused", path: A, reason: "could not check the worktree: spawn EPERM" });
  const fake = fakeRun(repoTable(WTS, MERGED));
  const late: RemoveDeps = { ...rig({}).d, run: async (cmd, args, opts) => { if (args[0] === "worktree" && args[1] === "remove") throw new Error("spawn EPERM"); return fake.run(cmd, args, opts); } };
  assert.deepEqual(await removeOne(input(), late), { outcome: "failed", path: A, reason: "spawn EPERM; may be partly removed", partly: true });
});

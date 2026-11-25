// collect against real git: a repo with three linked worktrees, built under the OS temp folder and removed afterwards.
// The fake-run tests hold the builder's belief about git's output; this one checks that belief on this machine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRepo, type RepoFacts } from "../src/worktrees/collect.ts";
import { FOLDER_NOT_FOUND, makeRealRun, realRun } from "../src/worktrees/run.ts";
import { scanRepos } from "../src/worktrees/scan.ts";
import { verdictOf } from "../src/worktrees/verdict.ts";

let root = "";
let repo = "";
let facts: RepoFacts;

const ID = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", "-c", "protocol.file.allow=always"];
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `add ${file}`);
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "questlog-wt-"));
  const origin = join(root, "origin.git");
  repo = join(root, "acme-app");
  mkdirSync(origin);
  mkdirSync(repo);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(repo, "init", "-q", "-b", "main");
  commit(repo, "readme.txt", "one\n");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");

  // a: one commit, pushed, clean
  const a = join(root, "acme-app-feature-a");
  git(repo, "worktree", "add", "-q", a, "-b", "feat/feature-a", "origin/main");
  commit(a, "a.txt", "a\n");
  git(a, "push", "-q", "-u", "origin", "feat/feature-a");

  // b: one commit, pushed, then an untracked file
  const b = join(root, "acme-app-feature-b");
  git(repo, "worktree", "add", "-q", b, "-b", "feat/feature-b", "origin/main");
  commit(b, "b.txt", "b\n");
  git(b, "push", "-q", "-u", "origin", "feat/feature-b");
  writeFileSync(join(b, "untracked.txt"), "not added\n");

  // c: one commit pushed, one more that is not
  const c = join(root, "acme-app-feature-c");
  git(repo, "worktree", "add", "-q", c, "-b", "feat/feature-c", "origin/main");
  commit(c, "c.txt", "c\n");
  git(c, "push", "-q", "-u", "origin", "feat/feature-c");
  commit(c, "c2.txt", "c2\n");

  // d: detached at a commit only it holds; e: detached at a commit main also holds
  const d = join(root, "acme-app-detached-d");
  git(repo, "worktree", "add", "-q", "--detach", d, "origin/main");
  commit(d, "d.txt", "d\n");
  const e = join(root, "acme-app-detached-e");
  git(repo, "worktree", "add", "-q", "--detach", e, "origin/main");

  facts = await collectRepo(repo, realRun, { ghTimeoutMs: 20_000 });
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const on = (branch: string) => {
  const f = facts.worktrees.find((w) => w.branch === branch);
  assert.ok(f, `no worktree on ${branch}`);
  return f;
};
const at = (name: string) => {
  const f = facts.worktrees.find((w) => w.path.replace(/\\/g, "/").endsWith(`/${name}`));
  assert.ok(f, `no worktree named ${name}`);
  return f;
};

test("real git: the repo reads with its default branch and all its worktrees, the main checkout first", () => {
  assert.equal(facts.error, undefined);
  assert.equal(facts.defaultBranch, "main");
  assert.equal(facts.worktrees.length, 6);
  assert.equal(facts.worktrees[0].main, true);
  assert.equal(facts.worktrees.filter((w) => w.main).length, 1);
});

test("real git: three worktrees in one folder, one clean and pushed, one with an untracked file, one with an unpushed commit", () => {
  const a = on("feat/feature-a"), b = on("feat/feature-b"), c = on("feat/feature-c");
  assert.deepEqual([a.dirty, a.unpushed, a.ownCommits, a.stashes], [0, 0, 1, 0]);
  assert.deepEqual([b.dirty, b.unpushed, b.ownCommits], [1, 0, 1]);
  assert.deepEqual([c.dirty, c.unpushed, c.ownCommits], [0, 1, 2]);
  for (const f of [a, b, c]) {
    assert.equal(typeof f.lastCommitAt, "number");
    assert.ok(Math.abs(Date.now() - (f.lastCommitAt ?? 0)) < 10 * 60 * 1000);
    assert.match(f.head, /^[0-9a-f]{40}$/);
  }
});

test("real git: gh has no GitHub repo to ask there, so every pull request reads unknown and nothing is closable", () => {
  for (const f of [on("feat/feature-a"), on("feat/feature-b"), on("feat/feature-c")]) assert.deepEqual(f.pr, { state: "unknown" });
  assert.deepEqual(verdictOf(on("feat/feature-a")), { verdict: "in-flight", reason: "could not ask GitHub", closeOffered: false, safeForBulk: false });
  assert.equal(verdictOf(on("feat/feature-b"))?.reason, "1 untracked file");
  assert.equal(verdictOf(on("feat/feature-c"))?.reason, "1 commit not pushed");
});

test("real git: a detached HEAD holding a commit of its own needs you; one at a commit main holds is an orphan", () => {
  const d = at("acme-app-detached-d"), e = at("acme-app-detached-e");
  assert.deepEqual([d.detached, d.unpushed], [true, 1]);
  assert.equal(verdictOf(d)?.verdict, "needs-you");
  assert.deepEqual([e.detached, e.unpushed], [true, 0]);
  assert.equal(verdictOf(e)?.verdict, "orphan");
});

test("real run: a program that does not exist is a result with code -1, not a throw", async () => {
  const r = await realRun("questlog-no-such-program-xyz", ["--version"], { cwd: tmpdir() });
  assert.equal(r.code, -1);
  assert.equal(r.timedOut, false);
  assert.equal(r.stderr, "program not found: questlog-no-such-program-xyz");
});

test("real run: a folder that does not exist reads folder not found, told apart from a missing program", async () => {
  const gone = join(root, "no-such-folder");
  const r = await realRun("git", ["status"], { cwd: gone });
  assert.deepEqual(r, { code: -1, stdout: "", stderr: FOLDER_NOT_FOUND, timedOut: false });
  assert.equal(FOLDER_NOT_FOUND, "folder not found");
});

test("real scan: a repo folder that is gone keeps an entry whose error reads folder not found", async () => {
  const scan = await scanRepos([join(root, "no-such-folder"), repo], realRun);
  const gone = scan.repos.find((r) => r.error !== undefined);
  assert.equal(gone?.error, "folder not found");
  assert.deepEqual(gone?.worktrees, []);
  assert.equal(scan.repos.some((r) => r.error === undefined && r.worktrees.length > 1), true);
});

test("real run: the child never takes git's optional index lock", async () => {
  const r = await realRun(process.execPath, ["-e", "process.stdout.write(process.env.GIT_OPTIONAL_LOCKS||'')"], { cwd: tmpdir() });
  assert.deepEqual([r.code, r.stdout], [0, "0"]);
});

test("real run: output past the buffer is a failure that says so, not a timeout", async () => {
  const small = makeRealRun(64);
  const r = await small(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000))"], { cwd: tmpdir() });
  assert.equal(r.code, -1);
  assert.equal(r.timedOut, false);
  assert.match(r.stderr, /^output too large: /);
});

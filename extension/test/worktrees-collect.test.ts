import { test } from "node:test";
import assert from "node:assert/strict";
import { collectRepo, parsePrList, parseStatus, pickPr, stashesByBranch, PR_LIST_LIMIT } from "../src/worktrees/collect.ts";
import { verdictOf } from "../src/worktrees/verdict.ts";
import type { Run, RunResult } from "../src/worktrees/run.ts";
import { bad, DIFF_BASE, DIFF_HEAD, fakeRun as fake, GH_ALL, good, SHA, type Table } from "./worktrees-fixtures.ts";

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";

type Wt = { path: string; branch?: string; head?: string; extra?: string[] };
const porcelain = (wts: Wt[]) =>
  wts.map((w) => [`worktree ${w.path}`, `HEAD ${w.head ?? SHA(1)}`, w.branch ? `branch refs/heads/${w.branch}` : "detached", ...(w.extra ?? [])].join("\n")).join("\n\n") + "\n\n";

const pr = (number: number, state: string, headRefName: string, headRefOid = SHA(1), updatedAt = "2026-01-02T00:00:00Z", isCrossRepository = false) =>
  ({ number, state, headRefName, headRefOid, updatedAt, isCrossRepository });

/** What every repo in these tests answers: its worktrees, a default branch of main, no stashes. */
const base = (wts: Wt[], prs: unknown[] | RunResult = []): Table => ({
  "git worktree list --porcelain": good(porcelain(wts)),
  "git symbolic-ref --short refs/remotes/origin/HEAD": good("origin/main\n"),
  "git stash list": good(""),
  [GH_ALL]: Array.isArray(prs) ? good(JSON.stringify(prs)) : prs,
  "git status --porcelain": good(""),
  "git log -1 --format=%ct": good("1767225600\n"),
  "git rev-list --count origin/main..HEAD": good("2\n"),
});

const byPath = (r: Awaited<ReturnType<typeof collectRepo>>, path: string) => {
  const f = r.worktrees.find((w) => w.path === path);
  assert.ok(f, `no worktree at ${path}`);
  return f;
};

test("three worktrees of one repo in one folder each get their own facts", async () => {
  const wts = [
    { path: MAIN, branch: "main" },
    { path: A, branch: "feat/feature-a", head: SHA(2) },
    { path: B, branch: "feat/feature-b", head: SHA(3) },
    { path: C, branch: "fix/feature-c", head: SHA(4) },
  ];
  const { run } = fake({
    ...base(wts, [pr(12, "MERGED", "feat/feature-a", SHA(2)), pr(13, "OPEN", "feat/feature-b", SHA(3))]),
    "git stash list": good("stash@{0}: WIP on feat/feature-b: 3333333 wip\nstash@{1}: On fix/feature-c: later\nstash@{2}: On fix/feature-c: more\n"),
    // a: merged, remote branch deleted, the PR head is held locally and is HEAD
    [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(),
    [`${A}|git rev-list --count HEAD --not ${SHA(2)}`]: good("0\n"),
    // b: pushed, two files changed
    [`${B}|git status --porcelain`]: good(" M src/a.ts\n?? notes.txt\n"),
    [`${B}|git rev-parse --verify --quiet refs/remotes/origin/feat/feature-b`]: good(SHA(3)),
    [`${B}|git cat-file -e ${SHA(3)}^{commit}`]: good(),
    [`${B}|git rev-list --count HEAD --not refs/remotes/origin/feat/feature-b ${SHA(3)}`]: good("0\n"),
    // c: pushed, one commit since, no PR
    [`${C}|git rev-parse --verify --quiet refs/remotes/origin/fix/feature-c`]: good(SHA(4)),
    [`${C}|git rev-list --count HEAD --not refs/remotes/origin/fix/feature-c`]: good("1\n"),
    [`${C}|git log -1 --format=%ct`]: good("1767312000\n"),
  });
  const r = await collectRepo(MAIN, run);
  assert.equal(r.error, undefined);
  assert.equal(r.defaultBranch, "main");
  assert.deepEqual(r.worktrees.map((w) => w.path), [MAIN, A, B, C]);

  const a = byPath(r, A), b = byPath(r, B), c = byPath(r, C);
  assert.deepEqual([a.dirty, a.unpushed, a.stashes, a.ownCommits], [0, 0, 0, 2]);
  assert.deepEqual(a.pr, { state: "merged", number: 12, headRefOid: SHA(2) });
  assert.equal(a.lastCommitAt, 1767225600000);
  assert.deepEqual([b.dirty, b.unpushed, b.stashes], [2, 0, 1]);
  assert.equal(b.pr.number, 13);
  assert.deepEqual([c.dirty, c.unpushed, c.stashes], [0, 1, 2]);
  assert.deepEqual(c.pr, { state: "none" });
  assert.equal(c.lastCommitAt, 1767312000000);

  assert.deepEqual([a, b, c].map((f) => verdictOf(f)?.verdict), ["closable", "needs-you", "needs-you"]);
  assert.equal(verdictOf(byPath(r, MAIN)), undefined);
});

test("the main checkout is listed but never entered", async () => {
  const { run, calls } = fake(base([{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }]));
  await collectRepo(MAIN, run);
  assert.equal(calls.some((c) => c.cwd === MAIN && c.args[0] === "status"), false);
  assert.equal(calls.some((c) => c.cwd === A && c.args[0] === "status"), true);
});

test("gh missing: every worktree's pull request is unknown, from one failed call", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const { run, calls } = fake({
    ...base(wts, bad(-1, "spawn gh ENOENT")),
    "git rev-parse --verify --quiet refs/remotes/origin/feat/feature-a": good(SHA(1)),
    "git rev-list --count HEAD --not refs/remotes/origin/feat/feature-a": good("0\n"),
  });
  const r = await collectRepo(MAIN, run);
  assert.deepEqual([byPath(r, A).pr, byPath(r, B).pr], [{ state: "unknown" }, { state: "unknown" }]);
  assert.equal(calls.filter((c) => c.cmd === "gh").length, 1);
  assert.deepEqual(verdictOf(byPath(r, A)), { verdict: "in-flight", reason: "could not ask GitHub", closeOffered: false, safeForBulk: false });
  // b was never pushed, and without GitHub nobody can say its commits are safe
  assert.equal(byPath(r, B).unpushed, "unknown");
});

test("gh timing out or printing something that is not the list also reads unknown", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  for (const answer of [{ code: -1, stdout: "", stderr: "", timedOut: true }, good("<html>rate limited</html>"), good("{\"message\":\"no\"}")]) {
    const { run } = fake(base(wts, answer));
    const r = await collectRepo(MAIN, run);
    assert.deepEqual(byPath(r, A).pr, { state: "unknown" });
    assert.notEqual(verdictOf(byPath(r, A))?.verdict, "closable");
  }
});

test("squash-merged, remote branch gone, PR head equals HEAD: nothing unpushed, closable", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a", head: SHA(2) }];
  const { run, calls } = fake({
    ...base(wts, [pr(12, "MERGED", "feat/feature-a", SHA(2))]),
    [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(),
    [`${A}|git rev-list --count HEAD --not ${SHA(2)}`]: good("0\n"),
  });
  const a = byPath(await collectRepo(MAIN, run), A);
  assert.equal(a.unpushed, 0);
  assert.deepEqual(verdictOf(a), { verdict: "closable", reason: "PR #12 merged, clean", closeOffered: true, safeForBulk: true });
  assert.equal(calls.some((c) => ["fetch", "ls-remote", "prune"].includes(c.args[0]) || c.args.includes("--prune")), false);
});

test("the same with one later local commit: one unpushed, needs you", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a", head: SHA(5) }];
  const { run } = fake({
    ...base(wts, [pr(12, "MERGED", "feat/feature-a", SHA(2))]),
    [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(),
    [`${A}|git rev-list --count HEAD --not ${SHA(2)}`]: good("1\n"),
  });
  const a = byPath(await collectRepo(MAIN, run), A);
  assert.equal(a.unpushed, 1);
  assert.equal(verdictOf(a)?.verdict, "needs-you");
});

test("merged, remote branch gone and the PR head not held locally: unknown, never closable", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a", head: SHA(2) }];
  const { run } = fake(base(wts, [pr(12, "MERGED", "feat/feature-a", SHA(7))]));
  const a = byPath(await collectRepo(MAIN, run), A);
  assert.equal(a.unpushed, "unknown");
  assert.equal(verdictOf(a)?.verdict, "in-flight");
});

test("a branch with two pull requests: merged wins over closed, open over both", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  const two = [pr(10, "CLOSED", "feat/feature-a", SHA(8), "2026-03-01T00:00:00Z"), pr(11, "MERGED", "feat/feature-a", SHA(1), "2026-02-01T00:00:00Z")];
  const { run } = fake(base(wts, two));
  assert.equal(byPath(await collectRepo(MAIN, run), A).pr.number, 11);

  const prs = parsePrList(JSON.stringify([...two, pr(14, "OPEN", "feat/feature-a"), pr(9, "MERGED", "feat/feature-a", SHA(1), "2026-01-01T00:00:00Z")]));
  assert.ok(prs);
  assert.equal(pickPr(prs, "feat/feature-a").number, 14);
  // newest within one state
  assert.equal(pickPr(prs.filter((p) => p.state === "merged"), "feat/feature-a").number, 11);
  assert.deepEqual(pickPr(prs, "feat/other"), { state: "none" });
});

test("a fork's pull request of the same branch name is ignored", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  const { run } = fake(base(wts, [pr(20, "MERGED", "feat/feature-a", SHA(1), "2026-03-01T00:00:00Z", true)]));
  const a = byPath(await collectRepo(MAIN, run), A);
  assert.deepEqual(a.pr, { state: "none" });
  assert.notEqual(verdictOf(a)?.verdict, "closable");
});

test("a branch missing from a full page of pull requests is asked about by name; a short page is trusted", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  const HEAD_CALL = "gh pr list --head feat/feature-a --state all --json number,state,headRefName,headRefOid,updatedAt,isCrossRepository";
  const full = Array.from({ length: PR_LIST_LIMIT }, (_, i) => pr(1000 + i, "MERGED", `feat/other-${i}`));

  const cut = fake({ ...base(wts, full), [HEAD_CALL]: good(JSON.stringify([pr(7, "MERGED", "feat/feature-a")])) });
  assert.equal(byPath(await collectRepo(MAIN, cut.run), A).pr.number, 7);

  const cutAndFailing = fake(base(wts, full));
  assert.deepEqual(byPath(await collectRepo(MAIN, cutAndFailing.run), A).pr, { state: "unknown" });

  const short = fake(base(wts, [pr(1, "MERGED", "feat/other")]));
  assert.deepEqual(byPath(await collectRepo(MAIN, short.run), A).pr, { state: "none" });
  assert.equal(short.calls.filter((c) => c.cmd === "gh").length, 1);
});

test("a full page counts as full even when one of its pull requests is a fork's and is dropped", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const HEAD_CALL = "gh pr list --head feat/feature-a --state all --json number,state,headRefName,headRefOid,updatedAt,isCrossRepository";
  const full = [
    pr(999, "OPEN", "feat/from-a-fork", SHA(2), "2026-03-01T00:00:00Z", true),
    ...Array.from({ length: PR_LIST_LIMIT - 1 }, (_, i) => pr(1000 + i, "MERGED", `feat/other-${i}`)),
  ];

  const cut = fake({ ...base(wts, full), [HEAD_CALL]: good(JSON.stringify([pr(7, "MERGED", "feat/feature-a")])) });
  assert.equal(byPath(await collectRepo(MAIN, cut.run), A).pr.number, 7);
  assert.equal(cut.calls.some((c) => c.cmd === "gh" && c.args.includes("--head")), true);

  // An unread worktree missing from that page is unknown, not "no pull request".
  const stopped = fake(base(wts, full));
  let asked = 0;
  const r = await collectRepo(MAIN, stopped.run, { worktreeParallel: 1, stop: () => ++asked > 1 });
  assert.deepEqual([byPath(r, B).unread, byPath(r, B).pr.state], [true, "unknown"]);
});

test("a prunable worktree is never entered and reads missing", async () => {
  const wts = [
    { path: MAIN, branch: "main" },
    { path: A, branch: "feat/feature-a", extra: ["prunable gitdir file points to non-existent location"] },
    { path: B, branch: "feat/feature-b" },
  ];
  const { run, calls } = fake(base(wts));
  const r = await collectRepo(MAIN, run);
  assert.equal(calls.some((c) => c.cwd === A), false);
  assert.equal(verdictOf(byPath(r, A))?.verdict, "missing");
  assert.equal(calls.some((c) => c.cwd === B), true);
});

test("untracked files count as dirty", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  const { run } = fake({ ...base(wts), [`${A}|git status --porcelain`]: good("?? scratch.txt\n?? notes/\n") });
  const a = byPath(await collectRepo(MAIN, run), A);
  assert.equal(a.dirty, 2);
  assert.deepEqual([a.changed, a.untracked], [0, 2]);
  assert.deepEqual(a.dirtySample, ["scratch.txt", "notes/"]);
  assert.equal(verdictOf(a)?.verdict, "needs-you");
  assert.match(verdictOf(a)?.reason ?? "", /^2 untracked files/);
});

test("dirty files are split into changed and untracked, with the first five paths as a sample", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  const status = [" M src/a.ts", "A  src/new.ts", " D old.txt", "R  src/was.ts -> src/now.ts", "UU src/clash.ts", '?? "notes/with space.md"', "?? shots/", ""].join("\n");
  const { run } = fake({
    ...base(wts),
    [`${A}|git status --porcelain`]: good(status),
    [`${A}|git rev-parse --verify --quiet refs/remotes/origin/feat/feature-a`]: good(SHA(1)),
    [`${A}|git rev-list --count HEAD --not refs/remotes/origin/feat/feature-a`]: good("0\n"),
  });
  const a = byPath(await collectRepo(MAIN, run), A);
  assert.deepEqual([a.dirty, a.changed, a.untracked], [7, 5, 2]);
  assert.deepEqual(a.dirtySample, ["src/a.ts", "src/new.ts", "old.txt", "src/now.ts", "src/clash.ts"]);
  assert.equal(verdictOf(a)?.reason, "5 changed files, 2 untracked files");
  assert.deepEqual(parseStatus("?? a\\b.txt\n").sample, ["a/b.txt"]);
  assert.deepEqual(parseStatus(""), { changed: 0, untracked: 0, sample: [] });
});

test("worktrees of one repo are read a few at a time, never more than the limit, and stay in git's order", async () => {
  const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const wts = [{ path: MAIN, branch: "main" }, ...names.map((n) => ({ path: `/work/acme-app-feature-${n}`, branch: `feat/feature-${n}` }))];
  const table = base(wts);
  const open = new Set<string>();
  let most = 0;
  const run: Run = async (cmd, args, { cwd }) => {
    const line = `${cmd} ${args.join(" ")}`;
    // a worktree's read opens at its status call and closes at the last call made in its folder
    if (cwd !== MAIN && args[0] === "status") { open.add(cwd); most = Math.max(most, open.size); }
    await new Promise((r) => setTimeout(r, 1));
    if (cwd !== MAIN && args[0] === "rev-list" && args.includes("--not") === false && args[2] !== "origin/main..HEAD") open.delete(cwd);
    const res = table[`${cwd}|${line}`] ?? table[line] ?? bad();
    // never pushed, no PR: the last call for a worktree is the own-commits count
    if (cwd !== MAIN && line === "git rev-list --count origin/main..HEAD") open.delete(cwd);
    return res;
  };
  const r = await collectRepo(MAIN, run, { worktreeParallel: 3 });
  assert.equal(most, 3);
  assert.deepEqual(r.worktrees.map((w) => w.path), wts.map((w) => w.path));
  assert.equal(r.worktrees.every((w) => w.main || w.unpushed === 2), true);

  most = 0;
  await collectRepo(MAIN, run, { worktreeParallel: 1 });
  assert.equal(most, 1);
  most = 0;
  // the default is the plan's value: one worktree at a time
  await collectRepo(MAIN, run);
  assert.equal(most, 1);
});

test("a stash list that could not be read is not zero stashes: no branch worktree of the repo reads closable", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a", head: SHA(2) }, { path: B, branch: "feat/feature-b", head: SHA(3) }, { path: C }];
  const { run } = fake({
    ...base(wts, [pr(12, "MERGED", "feat/feature-a", SHA(2)), pr(13, "MERGED", "feat/feature-b", SHA(3))]),
    "git stash list": bad(128, "fatal: bad stash"),
    [`${A}|git cat-file -e ${SHA(2)}^{commit}`]: good(),
    [`${A}|git rev-list --count HEAD --not ${SHA(2)}`]: good("0\n"),
    [`${B}|git cat-file -e ${SHA(3)}^{commit}`]: good(),
    [`${B}|git rev-list --count HEAD --not ${SHA(3)}`]: good("0\n"),
  });
  const r = await collectRepo(MAIN, run);
  for (const path of [A, B]) {
    const f = byPath(r, path);
    // the failure is said where it happened: the stash count, not the unpushed count
    assert.deepEqual([f.stashes, f.unpushed, f.dirty], ["unknown", 0, 0]);
    const v = verdictOf(f);
    assert.equal(v?.verdict, "in-flight");
    assert.equal(v?.reason, "could not read the stash list");
    assert.equal(v?.closeOffered, false);
  }
  // a stash belongs to a branch, so a detached worktree still has none
  assert.equal(byPath(r, C).stashes, 0);
});

test("an unread worktree keeps the pull request the repo's one gh call already found, with no call in its folder", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const { run, calls } = fake(base(wts, [pr(14, "MERGED", "feat/feature-b", SHA(1))]));
  let asked = 0;
  const r = await collectRepo(MAIN, run, { worktreeParallel: 1, stop: () => ++asked > 1 });
  const b = byPath(r, B);
  assert.equal(b.unread, true);
  assert.deepEqual([b.pr.state, b.pr.number], ["merged", 14]);
  assert.equal(verdictOf(b)?.reason, "not read yet");
  assert.equal(verdictOf(b)?.closeOffered, false);
  assert.equal(calls.some((c) => c.cwd === B), false);
  assert.equal(byPath(r, A).unread, undefined);
});

test("an unread worktree's pull request is unknown when gh could not be asked", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }];
  const { run } = fake(base(wts, bad(1, "gh: not logged in")));
  const r = await collectRepo(MAIN, run, { stop: () => true });
  assert.deepEqual([byPath(r, A).unread, byPath(r, A).pr.state], [true, "unknown"]);
});

test("never pushed and no pull request: its own commits are all unpushed; none of its own reads not started", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const { run } = fake({ ...base(wts), [`${B}|git rev-list --count origin/main..HEAD`]: good("0\n") });
  const r = await collectRepo(MAIN, run);
  assert.equal(byPath(r, A).unpushed, 2);
  assert.equal(verdictOf(byPath(r, A))?.reason, "2 commits not pushed");
  assert.deepEqual([byPath(r, B).unpushed, byPath(r, B).ownCommits], [0, 0]);
  assert.equal(verdictOf(byPath(r, B))?.reason, "not started");
});

test("detached HEAD: commits no ref reaches are unpushed; none makes it an orphan; a failed count is not an orphan", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A }, { path: B }, { path: C }];
  const COUNT = "git rev-list --count HEAD --not --branches --remotes --tags";
  const { run, calls } = fake({ ...base(wts), [`${A}|${COUNT}`]: good("0\n"), [`${B}|${COUNT}`]: good("3\n") });
  const r = await collectRepo(MAIN, run);
  assert.deepEqual(r.worktrees.slice(1).map((w) => w.unpushed), [0, 3, "unknown"]);
  assert.deepEqual(r.worktrees.slice(1).map((w) => verdictOf(w)?.verdict), ["orphan", "needs-you", "in-flight"]);
  assert.deepEqual(byPath(r, A).pr, { state: "none" });
  // `--all` would include the worktree's own HEAD and always count zero
  assert.equal(calls.some((c) => c.args.includes("--all")), false);
});

test("a git call failing for one worktree makes that fact unknown and leaves the others alone", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const { run } = fake({
    ...base(wts, [pr(12, "MERGED", "feat/feature-a", SHA(1)), pr(13, "MERGED", "feat/feature-b", SHA(1))]),
    [`git cat-file -e ${SHA(1)}^{commit}`]: good(),
    [`git rev-list --count HEAD --not ${SHA(1)}`]: good("0\n"),
    [`${A}|git status --porcelain`]: bad(128, "fatal: not a git repository"),
    [`${A}|git log -1 --format=%ct`]: bad(128),
    [`${A}|git rev-list --count origin/main..HEAD`]: bad(128),
  });
  const r = await collectRepo(MAIN, run);
  const a = byPath(r, A);
  assert.deepEqual([a.dirty, a.unpushed, a.ownCommits, a.lastCommitAt], ["unknown", 0, "unknown", undefined]);
  assert.deepEqual([a.changed, a.untracked, a.dirtySample], [undefined, undefined, []]);
  assert.equal(verdictOf(a)?.verdict, "in-flight");
  assert.equal(verdictOf(a)?.reason, "could not read the working tree");
  assert.equal(verdictOf(a)?.closeOffered, false);
  assert.equal(verdictOf(byPath(r, B))?.verdict, "closable");
});

test("a pull request head that is not a full commit id is dropped and never handed to git", async () => {
  assert.deepEqual(parsePrList(JSON.stringify([pr(1, "MERGED", "feat/x", "--upload-pack=x"), pr(2, "MERGED", "feat/y", "abc1234"), pr(3, "MERGED", "feat/z", SHA(4))]))?.map((p) => p.headRefOid), ["", "", SHA(4)]);

  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const { run, calls } = fake(base(wts, [pr(12, "MERGED", "feat/feature-a", "--upload-pack=x"), pr(13, "MERGED", "feat/feature-b", "abc1234")]));
  const r = await collectRepo(MAIN, run);
  assert.deepEqual(byPath(r, A).pr, { state: "merged", number: 12 });
  assert.deepEqual(byPath(r, B).pr, { state: "merged", number: 13 });
  assert.equal(calls.some((c) => c.args[0] === "cat-file"), false);
  assert.equal(calls.some((c) => c.args.some((a) => a.includes("upload-pack") || a.includes("abc1234"))), false);
});

test("a failed worktree list gives an error and no worktrees, without throwing", async () => {
  const notRepo = fake({ "git worktree list --porcelain": bad(128, "fatal: not a git repository (or any of the parent directories): .git\n") });
  assert.deepEqual(await collectRepo("/work/not-a-repo", notRepo.run), {
    path: "/work/not-a-repo", defaultBranch: "", worktrees: [], error: "fatal: not a git repository (or any of the parent directories): .git",
  });
  const slow = fake({ "git worktree list --porcelain": { code: -1, stdout: "", stderr: "", timedOut: true } });
  assert.equal((await collectRepo(MAIN, slow.run)).error, "git worktree list timed out");
});

test("the default branch falls back to main, then master, when origin/HEAD is not set", async () => {
  const wts = [{ path: MAIN, branch: "master" }, { path: A, branch: "feat/feature-a" }];
  const table = base(wts);
  table["git symbolic-ref --short refs/remotes/origin/HEAD"] = bad(128);
  table["git rev-parse --verify --quiet refs/remotes/origin/master"] = good(SHA(1));
  table["git rev-list --count origin/master..HEAD"] = good("4\n");
  const r = await collectRepo(MAIN, fake(table).run);
  assert.equal(r.defaultBranch, "master");
  assert.equal(byPath(r, A).ownCommits, 4);

  const none = base(wts);
  none["git symbolic-ref --short refs/remotes/origin/HEAD"] = bad(128);
  const r2 = await collectRepo(MAIN, fake(none).run);
  assert.equal(r2.defaultBranch, "");
  assert.equal(byPath(r2, A).ownCommits, "unknown");
});

test("stop ends the reading early: the rest are listed with unknown counts and never entered", async () => {
  const wts = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }];
  const { run, calls } = fake(base(wts));
  let asked = 0;
  const r = await collectRepo(MAIN, run, { worktreeParallel: 1, stop: () => ++asked > 1 });
  assert.equal(r.stopped, true);
  assert.equal(byPath(r, A).unpushed, 2);
  // gh answered and has no pull request for the branch, so that much is known
  assert.deepEqual([byPath(r, B).unpushed, byPath(r, B).pr.state, byPath(r, B).unread], ["unknown", "none", true]);
  assert.equal(verdictOf(byPath(r, B))?.reason, "not read yet");
  assert.equal(calls.some((c) => c.cwd === B), false);
  assert.equal(verdictOf(byPath(r, B))?.verdict, "in-flight");
});

test("stashesByBranch counts per branch and leaves out a stash made on a detached HEAD", () => {
  const m = stashesByBranch("stash@{0}: WIP on feat/feature-a: 1111111 one\nstash@{1}: On feat/feature-a: two\nstash@{2}: WIP on (no branch): 2222222 three\n");
  assert.deepEqual([...m], [["feat/feature-a", 2]]);
});

const FOUR = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }, { path: C, branch: "feat/feature-c" }];

test("changedFiles: the union of what the branch changed since the merge base and what is changed and not committed", async () => {
  const { run, calls } = fake({
    ...base(FOUR),
    [`${A}|${DIFF_BASE}`]: good("src/app.ts\nsrc/a.ts\n"),
    [`${A}|${DIFF_HEAD}`]: good("src/a.ts\r\nsrc/wip.ts\r\n"),
    [`${B}|${DIFF_BASE}`]: good(""),
    [`${B}|${DIFF_HEAD}`]: good(""),
    [`${C}|${DIFF_BASE}`]: good("src/c.ts\n"),
    [`${C}|${DIFF_HEAD}`]: good(""),
  });
  const r = await collectRepo(MAIN, run, { changedFiles: true });
  assert.deepEqual([...r.changedFiles!].map(([p, f]) => [p, [...f].sort()]), [
    [A, ["src/a.ts", "src/app.ts", "src/wip.ts"]],
    [B, []],
    [C, ["src/c.ts"]],
  ]);
  // The three-dot form, exactly, in the worktree itself; the main checkout is never diffed.
  assert.deepEqual(calls.filter((c) => c.cwd === A && c.args[0] === "diff").map((c) => c.args), [
    ["diff", "--name-only", "origin/main...HEAD"],
    ["diff", "--name-only", "HEAD"],
  ]);
  assert.equal(calls.some((c) => c.cwd === MAIN && c.args[0] === "diff"), false);
  // The lists ride beside the facts, never on them.
  assert.equal(JSON.stringify(r.worktrees).includes("src/app.ts"), false);
});

test("changedFiles: a failed diff, either one, leaves the worktree out; so does an unknown default branch", async () => {
  const { run } = fake({
    ...base(FOUR),
    [`${A}|${DIFF_HEAD}`]: good("x.ts\n"),
    [`${B}|${DIFF_BASE}`]: good("x.ts\n"),
    [`${C}|${DIFF_BASE}`]: good("x.ts\n"),
    [`${C}|${DIFF_HEAD}`]: good(""),
  });
  const r = await collectRepo(MAIN, run, { changedFiles: true });
  assert.deepEqual([...r.changedFiles!.keys()], [C]);

  const t: Table = { ...base(FOUR), [`${A}|${DIFF_BASE}`]: good("x.ts\n"), [`${A}|${DIFF_HEAD}`]: good("") };
  delete t["git symbolic-ref --short refs/remotes/origin/HEAD"];
  const noDefault = fake(t);
  const r2 = await collectRepo(MAIN, noDefault.run, { changedFiles: true });
  assert.equal(r2.defaultBranch, "");
  assert.equal(r2.changedFiles!.size, 0);
  assert.equal(noDefault.calls.some((c) => c.args[0] === "diff"), false);
});

test("changedFiles: a closable or orphan worktree is not diffed; a merged one with local changes is; nor is one the scan never read", async () => {
  const diffs = Object.fromEntries([A, B, C].flatMap((p) => [[`${p}|${DIFF_BASE}`, good("x.ts\n")], [`${p}|${DIFF_HEAD}`, good("")]]));
  // A and B are both merged and their PR head is HEAD. A is clean, so closable; B has a changed file, so needs you.
  const pushed = Object.fromEntries([A, B].flatMap((p) => [
    [`${p}|git cat-file -e ${SHA(1)}^{commit}`, good("")],
    [`${p}|git rev-list --count HEAD --not ${SHA(1)}`, good("0\n")],
  ]));
  const done = fake({
    ...base(FOUR, [pr(3, "MERGED", "feat/feature-a"), pr(4, "MERGED", "feat/feature-b")]), ...diffs, ...pushed,
    [`${B}|git status --porcelain`]: good(" M x.ts\n"),
  });
  const r = await collectRepo(MAIN, done.run, { changedFiles: true });
  assert.deepEqual([verdictOf(byPath(r, A))?.verdict, verdictOf(byPath(r, B))?.verdict], ["closable", "needs-you"]);
  assert.deepEqual([...r.changedFiles!.keys()], [B, C]);
  assert.deepEqual(done.calls.filter((c) => c.args[0] === "diff").map((c) => c.cwd), [B, B, C, C]);

  // A detached HEAD with nothing of its own is an orphan: not diffed either.
  const orphan = fake({
    ...base([{ path: MAIN, branch: "main" }, { path: A }]), ...diffs,
    [`${A}|git rev-list --count HEAD --not --branches --remotes --tags`]: good("0\n"),
  });
  const r3 = await collectRepo(MAIN, orphan.run, { changedFiles: true });
  assert.equal(verdictOf(byPath(r3, A))?.verdict, "orphan");
  assert.equal(r3.changedFiles!.size, 0);
  assert.equal(orphan.calls.some((c) => c.args[0] === "diff"), false);

  const stopped = fake({ ...base(FOUR), ...diffs });
  let asked = 0;
  const r2 = await collectRepo(MAIN, stopped.run, { changedFiles: true, worktreeParallel: 1, stop: () => ++asked > 1 });
  assert.deepEqual([...r2.changedFiles!.keys()], [A]);
  assert.equal(stopped.calls.some((c) => c.cwd === B), false);
});

test("without changedFiles no diff is run, no extra git call is made and the field is absent", async () => {
  const wts = FOUR.slice(0, 3);
  const plain = fake(base(wts));
  const r = await collectRepo(MAIN, plain.run);
  assert.equal("changedFiles" in r, false);
  assert.equal(plain.calls.some((c) => c.args[0] === "diff"), false);

  const off = fake(base(wts));
  assert.equal("changedFiles" in await collectRepo(MAIN, off.run, { changedFiles: false }), false);
  assert.equal(off.calls.length, plain.calls.length);

  const on = fake({ ...base(wts), [DIFF_BASE]: good(""), [DIFF_HEAD]: good("") });
  await collectRepo(MAIN, on.run, { changedFiles: true });
  // Two more calls per entered worktree, and nothing else.
  assert.equal(on.calls.length, plain.calls.length + 4);
});

test("only: the named worktree is entered and no other; the rest read as not read yet", async () => {
  const merged = [pr(3, "MERGED", "feat/feature-a"), pr(4, "MERGED", "feat/feature-b"), pr(5, "OPEN", "feat/feature-c")];
  // Named with the other slash and another letter case: it is still the one
  const { run, calls } = fake(base(FOUR, merged));
  const r = await collectRepo(MAIN, run, { only: ["\\WORK\\Acme-App-Feature-B\\"] });
  assert.equal(r.error, undefined);
  assert.equal(r.stopped, undefined);
  assert.equal(r.worktrees.length, 4);
  // Every call made inside a linked worktree was made in B
  assert.deepEqual([...new Set(calls.map((c) => c.cwd).filter((cwd) => cwd !== MAIN))], [B]);
  assert.equal(calls.filter((c) => c.cwd === B && c.args[0] === "status").length, 1);
  // The repo-wide reads still ran once each, from the main checkout
  assert.equal(calls.filter((c) => c.cmd === "gh").length, 1);
  assert.equal(calls.filter((c) => c.args.join(" ") === "stash list").length, 1);
  assert.equal(byPath(r, B).unread, undefined);
  assert.equal(byPath(r, B).dirty, 0);
  for (const other of [A, C]) {
    assert.equal(byPath(r, other).unread, true);
    assert.equal(verdictOf(byPath(r, other))?.reason, "not read yet");
  }
  // What GitHub already said about an unread one is kept, with no further call
  assert.equal(byPath(r, A).pr.state, "merged");

  // A path that is no worktree of the repo enters nothing
  const none = fake(base(FOUR, merged));
  const r2 = await collectRepo(MAIN, none.run, { only: ["/work/acme-app-feature-z"] });
  assert.deepEqual(none.calls.map((c) => c.cwd).filter((cwd) => cwd !== MAIN), []);
  assert.deepEqual(r2.worktrees.filter((w) => !w.main).map((w) => w.unread), [true, true, true]);

  // Without the option every worktree is entered, as before
  const all = fake(base(FOUR, merged));
  await collectRepo(MAIN, all.run);
  assert.deepEqual([...new Set(all.calls.map((c) => c.cwd).filter((cwd) => cwd !== MAIN))], [A, B, C]);
});

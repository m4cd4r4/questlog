import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictOf, type Facts } from "../src/worktrees/verdict.ts";

const HEAD = "2222222222222222222222222222222222222222";

/** A clean, pushed worktree on a branch with commits of its own and no pull request. */
const facts = (over: Partial<Facts> = {}): Facts => ({
  path: "/work/acme-app-feature-a", branch: "feat/feature-a", head: HEAD, main: false,
  detached: false, locked: false, lockedReason: "", bare: false, prunable: false, prunableReason: "",
  dirty: 0, unpushed: 0, stashes: 0, ownCommits: 2, pr: { state: "none" },
  ...over,
});

test("three worktrees of one repo in one folder each get their own verdict", () => {
  const a = facts({ path: "/work/acme-app-feature-a", branch: "feat/feature-a", pr: { state: "merged", number: 12, headRefOid: HEAD } });
  const b = facts({ path: "/work/acme-app-feature-b", branch: "feat/feature-b", dirty: 3, pr: { state: "open", number: 13 } });
  const c = facts({ path: "/work/acme-app-feature-c", branch: "fix/feature-c", pr: { state: "open", number: 14 } });
  assert.deepEqual([a, b, c].map((f) => verdictOf(f)?.verdict), ["closable", "needs-you", "in-flight"]);
  assert.equal(verdictOf(a)?.reason, "PR #12 merged, clean");
  assert.equal(verdictOf(b)?.reason, "3 changed files");
  assert.equal(verdictOf(c)?.reason, "PR #14 open");
});

test("a working tree that could not be read is in flight and says so, never closable and never an orphan", () => {
  const merged = { state: "merged", number: 12, headRefOid: HEAD } as const;
  assert.deepEqual(verdictOf(facts({ dirty: "unknown", pr: merged })),
    { verdict: "in-flight", reason: "could not read the working tree", closeOffered: false, safeForBulk: false });
  assert.deepEqual(verdictOf(facts({ dirty: "unknown", detached: true, branch: "" })),
    { verdict: "in-flight", reason: "could not read the working tree", closeOffered: false, safeForBulk: false });
  // work that is known to be unsaved still comes first
  assert.equal(verdictOf(facts({ dirty: "unknown", unpushed: 1, pr: merged }))?.reason, "1 commit not pushed");
  // and so does busy
  assert.equal(verdictOf(facts({ dirty: "unknown", locked: true }))?.verdict, "busy");
});

test("a stash list that could not be read is in flight and says so; known unsaved work still needs you", () => {
  const merged = { state: "merged", number: 12, headRefOid: HEAD } as const;
  assert.deepEqual(verdictOf(facts({ stashes: "unknown", unpushed: 0, pr: merged })),
    { verdict: "in-flight", reason: "could not read the stash list", closeOffered: false, safeForBulk: false });
  assert.deepEqual(verdictOf(facts({ stashes: "unknown", dirty: 2, changed: 2, untracked: 0, pr: merged })),
    { verdict: "needs-you", reason: "2 changed files", closeOffered: false, safeForBulk: false });
  // both unknown: the working tree is named first
  assert.equal(verdictOf(facts({ dirty: "unknown", stashes: "unknown" }))?.reason, "could not read the working tree");
});

test("missing: git lists it but the folder is gone, and no close is offered", () => {
  // Even with everything else pointing at closable, the folder being gone wins
  const v = verdictOf(facts({ prunable: true, prunableReason: "gitdir file points to non-existent location", pr: { state: "merged", number: 12 } }));
  assert.deepEqual(v, { verdict: "missing", reason: "folder is gone: run git worktree prune", closeOffered: false, safeForBulk: false });
});

test("needs you: changed files, unpushed commits or a stash, each named, singular and plural", () => {
  assert.equal(verdictOf(facts({ dirty: 1 }))?.reason, "1 changed file");
  assert.equal(verdictOf(facts({ dirty: 3 }))?.reason, "3 changed files");
  assert.equal(verdictOf(facts({ unpushed: 1 }))?.reason, "1 commit not pushed");
  assert.equal(verdictOf(facts({ unpushed: 2 }))?.reason, "2 commits not pushed");
  assert.equal(verdictOf(facts({ stashes: 1 }))?.reason, "1 stash");
  assert.equal(verdictOf(facts({ stashes: 2 }))?.reason, "2 stashes");
  const all = verdictOf(facts({ dirty: 3, unpushed: 2, stashes: 1 }));
  assert.deepEqual(all, { verdict: "needs-you", reason: "3 changed files, 2 commits not pushed, 1 stash", closeOffered: false, safeForBulk: false });
});

test("needs you says changed and untracked apart; untracked alone still needs you", () => {
  assert.equal(verdictOf(facts({ dirty: 1, changed: 0, untracked: 1 }))?.reason, "1 untracked file");
  assert.equal(verdictOf(facts({ dirty: 2, changed: 0, untracked: 2 }))?.verdict, "needs-you");
  assert.equal(verdictOf(facts({ dirty: 5, changed: 2, untracked: 3, unpushed: 1 }))?.reason, "2 changed files, 3 untracked files, 1 commit not pushed");
  const merged = facts({ dirty: 1, changed: 0, untracked: 1, pr: { state: "merged", number: 12, headRefOid: HEAD } });
  assert.deepEqual(verdictOf(merged), { verdict: "needs-you", reason: "1 untracked file", closeOffered: false, safeForBulk: false });
});

test("a worktree the scan never reached reads not read yet, whatever else is on the record", () => {
  const merged = facts({ unread: true, unpushed: "unknown", ownCommits: "unknown", pr: { state: "merged", number: 12, headRefOid: HEAD } });
  assert.deepEqual(verdictOf(merged), { verdict: "in-flight", reason: "not read yet", closeOffered: false, safeForBulk: false });
  assert.equal(verdictOf(facts({ unread: true, pr: { state: "unknown" } }))?.reason, "not read yet");
  assert.equal(verdictOf(facts({ unread: true, detached: true, branch: "" }))?.verdict, "in-flight");
  // missing still comes first, and the main checkout still gets no verdict
  assert.equal(verdictOf(facts({ unread: true, prunable: true }))?.verdict, "missing");
  assert.equal(verdictOf(facts({ unread: true, main: true })), undefined);
});

test("dirty and merged gives needs you, not closable", () => {
  const v = verdictOf(facts({ dirty: 1, pr: { state: "merged", number: 12, headRefOid: HEAD } }));
  assert.equal(v?.verdict, "needs-you");
  assert.equal(v?.closeOffered, false);
});

test("needs you comes before busy and before orphan", () => {
  assert.equal(verdictOf(facts({ dirty: 1, locked: true }))?.verdict, "needs-you");
  assert.equal(verdictOf(facts({ dirty: 1, server: { port: 3000 } }))?.verdict, "needs-you");
  assert.equal(verdictOf(facts({ detached: true, branch: "", stashes: 1 }))?.verdict, "needs-you");
});

test("busy: a dev server listening from the folder, with its port", () => {
  const v = verdictOf(facts({ server: { port: 3000 }, pr: { state: "merged", number: 12 } }));
  assert.deepEqual(v, { verdict: "busy", reason: "dev server on port 3000", closeOffered: false, safeForBulk: false });
});

test("locked gives busy, with git's reason when it gave one", () => {
  assert.deepEqual(verdictOf(facts({ locked: true, pr: { state: "merged", number: 12 } })), { verdict: "busy", reason: "locked", closeOffered: false, safeForBulk: false });
  assert.equal(verdictOf(facts({ locked: true, lockedReason: "on a removable drive" }))?.reason, "locked: on a removable drive");
});

test("a server list that could not be read leaves the verdict alone", () => {
  assert.equal(verdictOf(facts({ server: "unknown", pr: { state: "merged", number: 12 } }))?.verdict, "closable");
});

test("orphan: detached HEAD with a clean tree, close offered one at a time", () => {
  const v = verdictOf(facts({ detached: true, branch: "" }));
  assert.deepEqual(v, { verdict: "orphan", reason: "detached HEAD, clean", closeOffered: true, safeForBulk: false });
});

test("a detached HEAD is an orphan only when no commit of its own is left unkept", () => {
  const kept = verdictOf(facts({ detached: true, branch: "", unpushed: 0 }));
  assert.equal(kept?.verdict, "orphan");
  const loose = verdictOf(facts({ detached: true, branch: "", unpushed: 2 }));
  assert.deepEqual(loose, { verdict: "needs-you", reason: "2 commits not pushed", closeOffered: false, safeForBulk: false });
  const unknown = verdictOf(facts({ detached: true, branch: "", unpushed: "unknown" }));
  assert.deepEqual(unknown, {
    verdict: "in-flight", reason: "detached HEAD, cannot tell whether its commits are kept elsewhere", closeOffered: false, safeForBulk: false,
  });
});

test("closable: merged, remote branch deleted, HEAD equals the PR head", () => {
  const v = verdictOf(facts({ unpushed: 0, pr: { state: "merged", number: 12, headRefOid: HEAD } }));
  assert.deepEqual(v, { verdict: "closable", reason: "PR #12 merged, clean", closeOffered: true, safeForBulk: true });
});

test("the same merged worktree with one later local commit needs you", () => {
  const v = verdictOf(facts({ unpushed: 1, pr: { state: "merged", number: 12, headRefOid: "9999999999999999999999999999999999999999" } }));
  assert.deepEqual(v, { verdict: "needs-you", reason: "1 commit not pushed", closeOffered: false, safeForBulk: false });
});

test("unpushed unknown with a merged PR is in flight, never closable", () => {
  const v = verdictOf(facts({ unpushed: "unknown", pr: { state: "merged", number: 12 } }));
  assert.deepEqual(v, { verdict: "in-flight", reason: "PR #12 merged, cannot tell whether everything was pushed", closeOffered: false, safeForBulk: false });
});

test("a closed, unmerged PR and a clean tree is closable one at a time, not in bulk", () => {
  const v = verdictOf(facts({ pr: { state: "closed", number: 12 } }));
  assert.deepEqual(v, { verdict: "closable", reason: "PR #12 closed without merging, clean", closeOffered: true, safeForBulk: false });
});

test("a merged PR whose number is missing still reads right", () => {
  assert.equal(verdictOf(facts({ pr: { state: "merged" } }))?.reason, "PR merged, clean");
});

test("in flight: an open PR", () => {
  assert.deepEqual(verdictOf(facts({ pr: { state: "open", number: 13 } })), { verdict: "in-flight", reason: "PR #13 open", closeOffered: false, safeForBulk: false });
});

test("in flight: a clean pushed branch with no PR yet", () => {
  assert.deepEqual(verdictOf(facts()), { verdict: "in-flight", reason: "pushed, no PR yet", closeOffered: false, safeForBulk: false });
});

test("never pushed, clean, no commits of its own is in flight: not started", () => {
  const v = verdictOf(facts({ ownCommits: 0, unpushed: 0, pr: { state: "none" } }));
  assert.deepEqual(v, { verdict: "in-flight", reason: "not started", closeOffered: false, safeForBulk: false });
});

test("PR state unknown is in flight: could not ask GitHub", () => {
  const v = verdictOf(facts({ pr: { state: "unknown" } }));
  assert.deepEqual(v, { verdict: "in-flight", reason: "could not ask GitHub", closeOffered: false, safeForBulk: false });
});

test("no PR and an unknown unpushed count is in flight and says so", () => {
  assert.equal(verdictOf(facts({ unpushed: "unknown", ownCommits: "unknown" }))?.reason, "no PR, cannot tell whether everything was pushed");
});

test("the main checkout on a merged branch gets no verdict, and neither does a bare entry", () => {
  assert.equal(verdictOf(facts({ path: "/work/acme-app", main: true, pr: { state: "merged", number: 12 } })), undefined);
  assert.equal(verdictOf(facts({ path: "/work/acme-app.git", bare: true, branch: "", head: "" })), undefined);
});

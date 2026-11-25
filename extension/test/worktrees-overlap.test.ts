import { test } from "node:test";
import assert from "node:assert/strict";
import { findOverlaps, markOverlaps } from "../src/worktrees/overlap.ts";
import { verdictOf, type Facts, type VerdictResult } from "../src/worktrees/verdict.ts";

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";
const SHA = "1".repeat(40);

/** A read worktree on a branch: clean, pushed, an open pull request unless told otherwise. */
const wt = (path: string, over: Partial<Facts> = {}): Facts => ({
  path, head: SHA, branch: `feat/${path.split("-").pop()}`, main: false, detached: false, locked: false, bare: false, prunable: false,
  dirty: 0, changed: 0, untracked: 0, dirtySample: [], unpushed: 0, stashes: 0, ownCommits: 1, pr: { state: "open", number: 5 },
  ...over,
} as Facts);

const judged = (facts: Facts[]) => facts.map((f): Facts & { verdict?: VerdictResult } => {
  const verdict = verdictOf(f);
  return verdict ? { ...f, verdict } : { ...f };
});

test("three worktrees of one repo in one folder: the two that share a file name each other, the third shares nothing", () => {
  const got = findOverlaps([
    { path: A, files: ["src/app.ts", "src/a-only.ts"] },
    { path: B, files: ["src/app.ts", "src/b-only.ts"] },
    { path: C, files: ["docs/readme.md"] },
  ]);
  assert.deepEqual(got.get(A), [{ path: B, count: 1, files: ["src/app.ts"] }]);
  assert.deepEqual(got.get(B), [{ path: A, count: 1, files: ["src/app.ts"] }]);
  assert.deepEqual(got.get(C), []);
  assert.equal(got.size, 3);
});

test("six shared files give a count of six and the first five names in sorted order", () => {
  const six = ["f.ts", "b.ts", "e.ts", "a.ts", "d.ts", "c.ts"];
  const got = findOverlaps([{ path: A, files: six }, { path: B, files: [...six].reverse() }]);
  assert.deepEqual(got.get(A), [{ path: B, count: 6, files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] }]);
  assert.deepEqual(got.get(B), [{ path: A, count: 6, files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] }]);
});

test("the cap is the caller's to set, and the count stays whole", () => {
  const got = findOverlaps([{ path: A, files: ["a", "b", "c"] }, { path: B, files: ["a", "b", "c"] }], 2);
  assert.deepEqual(got.get(A), [{ path: B, count: 3, files: ["a", "b"] }]);
});

test("names that differ only in case are not shared, and a name listed twice counts once", () => {
  const got = findOverlaps([{ path: A, files: ["src/App.ts", "x.ts", "x.ts"] }, { path: B, files: ["src/app.ts", "x.ts"] }]);
  assert.deepEqual(got.get(A), [{ path: B, count: 1, files: ["x.ts"] }]);
});

test("a worktree that shares with two others lists them by path", () => {
  const got = findOverlaps([
    { path: C, files: ["x.ts"] },
    { path: A, files: ["x.ts", "y.ts"] },
    { path: B, files: ["y.ts"] },
  ]);
  assert.deepEqual(got.get(A), [{ path: B, count: 1, files: ["y.ts"] }, { path: C, count: 1, files: ["x.ts"] }]);
  assert.deepEqual(got.get(B), [{ path: A, count: 1, files: ["y.ts"] }]);
});

test("markOverlaps: a closable worktree is left out, and so is its side of the pair", () => {
  const main = wt(MAIN, { main: true, branch: "main" });
  const a = wt(A);
  const b = wt(B, { pr: { state: "none" } });
  const c = wt(C, { pr: { state: "merged", number: 9 } });
  const all = judged([main, a, b, c]);
  assert.equal(all[3].verdict?.verdict, "closable");
  const files = new Map([[A, ["src/app.ts"]], [B, ["src/app.ts"]], [C, ["src/app.ts"]], [MAIN, ["src/app.ts"]]]);
  const got = markOverlaps(all, files);
  assert.deepEqual(got.map((w) => w.overlaps), [
    undefined,
    [{ path: B, count: 1, files: ["src/app.ts"] }],
    [{ path: A, count: 1, files: ["src/app.ts"] }],
    undefined,
  ]);
  // The input is left as it was, and no verdict moves.
  assert.equal(all.some((w) => "overlaps" in w), false);
  assert.deepEqual(got.map((w) => w.verdict), all.map((w) => w.verdict));
});

test("markOverlaps: needs you, in flight and busy are compared, whatever the pull request state", () => {
  const needs = wt(A, { dirty: 1, changed: 1 });
  const busy = wt(B, { locked: true });
  const mergedDirty = wt(C, { pr: { state: "merged", number: 9 }, dirty: 2, changed: 2 });
  const all = judged([needs, busy, mergedDirty]);
  assert.deepEqual(all.map((w) => w.verdict?.verdict), ["needs-you", "busy", "needs-you"]);
  const files = new Map([[A, ["x.ts"]], [B, ["x.ts"]], [C, ["x.ts"]]]);
  const got = markOverlaps(all, files);
  const shared = (path: string) => ({ path, count: 1, files: ["x.ts"] });
  assert.deepEqual(got[0].overlaps, [shared(B), shared(C)]);
  assert.deepEqual(got[1].overlaps, [shared(A), shared(C)]);
  // Merged, with local changes: still open work, so it is compared and named on both sides.
  assert.deepEqual(got[2].overlaps, [shared(A), shared(B)]);
});

test("markOverlaps: a worktree with no file list, or one that was not read, gets no field; one that shares nothing gets an empty list", () => {
  const all = judged([wt(A), wt(B), wt(C, { unread: true })]);
  const got = markOverlaps(all, new Map([[A, ["x.ts"]], [C, ["x.ts"]]]));
  assert.deepEqual(got[0].overlaps, []);
  assert.equal("overlaps" in got[1], false);
  assert.equal("overlaps" in got[2], false);
});

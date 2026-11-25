import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParentPlan, Slice } from "../src/plans.ts";
import type { ScanFile, ScannedRepo, ScannedWorktree } from "../src/worktrees/scan.ts";
import { liveFacts, sliceViews } from "../src/worktrees/slices.ts";
import { scannedRepo, scannedWt } from "./worktrees-fixtures.ts";

const ROOT = "/work/acme-app";
const scanOf = (repos: ScannedRepo[]): ScanFile => ({ version: 1, scannedAt: 1000, repos });
const repoOf = (...wts: ScannedWorktree[]) => scannedRepo(ROOT, [scannedWt(ROOT, "main", { main: true }), ...wts]);
const slice = (slug: string, o: Partial<Slice> = {}): Slice => {
  const worktree = o.worktree ?? `${ROOT}-${slug}`;
  return { slug, label: "", wave: "1", state: "working", why: "in progress, worktree on disk", resume: worktree, worktree, ...o };
};
const plan = (...slices: Slice[]): ParentPlan => ({ name: "Pricing", repo: "acme-app", slices });
const one = (s: Slice, scan?: ScanFile) => sliceViews(plan(s, slice("other", { state: "ready", why: "ready to mint", resume: "mint other", worktree: "" })), scan)[0];

test("a materialised slice whose PR is merged and whose tree is clean reads done", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { pr: { state: "merged", number: 12 } }))]);
  const v = one(slice("feature-a"), scan);
  assert.deepEqual({ done: v.done, listed: v.listed, relisted: v.relisted, why: v.why }, { done: true, listed: true, relisted: false, why: "PR #12 merged, clean" });
});

test("a merged PR with a dirty tree reads needs you, not done", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { pr: { state: "merged", number: 12 }, dirty: 2, changed: 2 }))]);
  const v = one(slice("feature-a"), scan);
  assert.equal(v.done, false);
  assert.equal(v.why, "needs you: 2 changed files");
});

test("a PR closed without merging is not done", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { pr: { state: "closed", number: 7 } }))]);
  const v = one(slice("feature-a"), scan);
  assert.equal(v.done, false);
  assert.equal(v.why, "closable: PR #7 closed without merging, clean");
});

test("a slice the registry calls merged whose worktree needs you is listed again, and live facts win", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { pr: { state: "merged", number: 12 }, dirty: 1, changed: 1 }))]);
  const v = one(slice("feature-a", { state: "done", why: "merged", resume: "" }), scan);
  assert.deepEqual({ done: v.done, listed: v.listed, relisted: v.relisted }, { done: false, listed: true, relisted: true });
  assert.equal(v.why, "registry says merged; needs you: 1 changed file");
});

test("a slice the registry calls done is listed again for busy and in flight, and for nothing else", () => {
  const done = (slug: string) => slice(slug, { state: "done", why: "archived", resume: "" });
  const scan = scanOf([repoOf(
    scannedWt(`${ROOT}-busy`, "feat/busy", { locked: true }),
    scannedWt(`${ROOT}-flight`, "feat/flight", { pr: { state: "open", number: 3 } }),
    scannedWt(`${ROOT}-closable`, "feat/closable", { pr: { state: "merged", number: 4 } }),
    scannedWt(`${ROOT}-gone`, "feat/gone", { prunable: true }),
    scannedWt(`${ROOT}-loose`, "", { detached: true }),
  )]);
  const views = sliceViews(plan(done("busy"), done("flight"), done("closable"), done("gone"), done("loose"), done("unscanned")), scan);
  assert.deepEqual(views.map((v) => `${v.slice.slug}:${v.relisted}`), ["busy:true", "flight:true", "closable:false", "gone:false", "loose:false", "unscanned:false"]);
  assert.equal(views[0].why, "registry says archived; busy: locked");
  assert.equal(views[1].why, "registry says archived; in flight: PR #3 open");
  // What is not listed again stays done by the registry, with the registry's reason
  assert.deepEqual(views.slice(2).map((v) => [v.done, v.listed, v.why]), [[true, false, "archived"], [true, false, "archived"], [true, false, "archived"], [true, false, "archived"]]);
});

test("a slice the registry calls blocked keeps its state and takes the live reason", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { untracked: 3, dirty: 3 }))]);
  const v = one(slice("feature-a", { state: "blocked", why: "blocked, worktree on disk" }), scan);
  assert.equal(v.slice.state, "blocked");
  assert.deepEqual({ done: v.done, listed: v.listed, relisted: v.relisted, why: v.why }, { done: false, listed: true, relisted: false, why: "needs you: 3 untracked files" });
});

test("three slices of one plan with worktrees in one parent folder each get their own verdict", () => {
  const scan = scanOf([repoOf(
    scannedWt(`${ROOT}-feature-a`, "feat/a", { dirty: 1, changed: 1 }),
    scannedWt(`${ROOT}-feature-b`, "feat/b", { pr: { state: "open", number: 9 } }),
    scannedWt(`${ROOT}-feature-c`, "feat/c", { pr: { state: "merged", number: 5 } }),
  )]);
  const views = sliceViews(plan(slice("feature-a"), slice("feature-b"), slice("feature-c")), scan);
  assert.deepEqual(views.map((v) => [v.slice.slug, v.done, v.why]), [
    ["feature-a", false, "needs you: 1 changed file"],
    ["feature-b", false, "in flight: PR #9 open"],
    ["feature-c", true, "PR #5 merged, clean"],
  ]);
});

test("the join holds across mixed slashes and drive-letter case", () => {
  const scan = scanOf([scannedRepo("i:/work/acme-app", [
    scannedWt("i:/work/acme-app", "main", { main: true }),
    scannedWt("i:/work/acme-app-feature-a", "feat/a", { pr: { state: "merged", number: 12 } }),
  ])]);
  const v = one(slice("feature-a", { worktree: "I:\\work\\acme-app-feature-a", resume: "I:\\work\\acme-app-feature-a" }), scan);
  assert.equal(v.done, true);
  assert.equal(v.why, "PR #12 merged, clean");
});

// The fallbacks: with no live facts the registry's state and reason stand, exactly as today.
const stands = (scan: ScanFile | undefined) => {
  const s = slice("feature-a");
  assert.equal(liveFacts(s, scan), undefined);
  const v = one(s, scan);
  assert.deepEqual({ done: v.done, listed: v.listed, relisted: v.relisted, why: v.why }, { done: false, listed: true, relisted: false, why: "in progress, worktree on disk" });
};

test("fallback: no scan cache yet, the registry stands", () => stands(undefined));

test("fallback: the worktrees setting is off, so the host passes no scan, the registry stands", () => {
  const views = sliceViews(plan(slice("feature-a"), slice("feature-b", { state: "done", why: "merged", resume: "" })));
  assert.deepEqual(views.map((v) => [v.done, v.listed, v.relisted, v.why]), [[false, true, false, "in progress, worktree on disk"], [true, false, false, "merged"]]);
});

test("fallback: the repo errored in the scan, the registry stands", () => stands(scanOf([scannedRepo(ROOT, [], { error: "git worktree list timed out" })])));

test("fallback: the worktree is not in the scan, the registry stands", () => stands(scanOf([repoOf(scannedWt(`${ROOT}-feature-b`, "feat/b"))])));

test("fallback: the worktree was not read yet, the registry stands", () => stands(scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { unread: true }))])));

test("fallback: the worktree has no verdict, the registry stands", () => {
  const { verdict: _dropped, ...bare } = scannedWt(`${ROOT}-feature-a`, "feat/a");
  stands(scanOf([repoOf(bare)]));
});

test("a slice with no worktree on disk has no live facts, and the main checkout is never a slice's worktree", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a"))]);
  assert.equal(liveFacts(slice("feature-a", { worktree: "" }), scan), undefined);
  assert.equal(liveFacts(slice("main", { worktree: ROOT }), scan), undefined);
  assert.equal(liveFacts({ slug: "x", state: "blocked" } as never, scan), undefined);
});

test("sliceViews keeps every slice, in the plan's order", () => {
  const scan = scanOf([repoOf(scannedWt(`${ROOT}-feature-a`, "feat/a", { pr: { state: "merged", number: 12 } }))]);
  const views = sliceViews(plan(slice("zero", { state: "done", why: "merged", resume: "", worktree: "" }), slice("feature-a"), slice("later", { state: "held", why: "waits on feature-a", resume: "mint later", worktree: "" })), scan);
  assert.deepEqual(views.map((v) => `${v.slice.slug}:${v.done}:${v.listed}`), ["zero:true:false", "feature-a:true:true", "later:false:true"]);
  // Not re-derived: a slice that waits on a merged one stays held while the registry calls that one open
  assert.equal(views[2].why, "waits on feature-a");
});

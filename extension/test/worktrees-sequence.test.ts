import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParentPlan } from "../src/plans.ts";
import type { ScanFile, ScannedRepo } from "../src/worktrees/scan.ts";
import { branchName, sequencesOf, slugName, stepOf, stepOfWorktree, type SequenceMember } from "../src/worktrees/sequence.ts";
import { worktreeBlocks } from "../src/worktrees/view.ts";
import { scannedRepo, scannedWt } from "./worktrees-fixtures.ts";

const NOW = Date.UTC(2026, 0, 10);
const REPO = "acme-app";
const scanOf = (repos: ScannedRepo[]): ScanFile => ({ version: 1, scannedAt: NOW, repos });

/** A worktree of acme-app in /work, in flight unless told otherwise. */
const m = (slug: string, branch: string, over: Partial<SequenceMember> = {}): SequenceMember =>
  ({ path: `/work/${slug}`, slug, branch, verdict: "in-flight", label: "in flight", ...over });
const steps = (members: SequenceMember[]) => sequencesOf(members, REPO).map((s) => `${s.name}: ${s.steps.map((x) => x.step).join(", ")}`);

// Written first: three worktrees of one repo in one parent folder.
test("three worktrees of one repo in one parent folder are one sequence, each step keyed by its own path", () => {
  const seqs = sequencesOf([
    m("acme-app-pricing-s2", "feat/pricing-s2", { verdict: "needs-you", label: "needs you" }),
    m("acme-app-pricing-s3", "feat/pricing-s3"),
    m("acme-app-pricing-s1", "feat/pricing-s1", { verdict: "closable", label: "closable" }),
  ], REPO);
  assert.deepEqual(seqs, [{ name: "pricing", steps: [
    { step: "s1", path: "/work/acme-app-pricing-s1", verdict: "closable", label: "closable" },
    { step: "s2", path: "/work/acme-app-pricing-s2", verdict: "needs-you", label: "needs you" },
    { step: "s3", path: "/work/acme-app-pricing-s3", verdict: "in-flight", label: "in flight" },
  ] }]);
  assert.equal(new Set(seqs[0].steps.map((s) => s.path)).size, 3);
});

test("matches: the row's four endings are steps (-s1, -s2, -wave3, -phase-2)", () => {
  assert.deepEqual(stepOf("pricing-s1"), { prefix: "pricing", word: "s", n: 1, step: "s1" });
  assert.deepEqual(stepOf("pricing-s2"), { prefix: "pricing", word: "s", n: 2, step: "s2" });
  assert.deepEqual(stepOf("drain-wave3"), { prefix: "drain", word: "wave", n: 3, step: "wave 3" });
  assert.deepEqual(stepOf("nav-phase-2"), { prefix: "nav", word: "phase", n: 2, step: "phase 2" });
  assert.deepEqual(steps([m("acme-app-nav-phase-1", "feat/nav-phase-1"), m("acme-app-nav-phase-2", "feat/nav-phase-2")]), ["nav: phase 1, phase 2"]);
});

test("every word of the closed list is a step, in any letter case, glued or as the next part; s only glued", () => {
  for (const word of ["slice", "step", "wave", "phase", "round", "part", "stage"]) {
    assert.equal(stepOf(`x-${word}4`)?.step, `${word} 4`, `${word} glued`);
    assert.equal(stepOf(`x-${word}-4`)?.step, `${word} 4`, `${word} then its number`);
  }
  assert.equal(stepOf("x-S07")?.step, "s7");
  assert.equal(stepOf("x-Wave-03")?.step, "wave 3");
  assert.equal(stepOf("x-s-1"), undefined, "s is a step only glued to its number");
});

test("a lone numbered one stays ungrouped", () => {
  assert.deepEqual(steps([m("acme-app-pricing-s1", "feat/pricing-s1"), m("acme-app-nav-rework", "feat/nav-rework")]), []);
  assert.deepEqual(steps([m("acme-app-pebble-phase0", "feat/pebble-phase0")]), []);
});

test("-v2 in a product name is not a step", () => {
  assert.equal(stepOf("drain-v2"), undefined);
  assert.equal(stepOf("lb-drain-v3-alert"), undefined);
  assert.deepEqual(steps([m("acme-app-drain-v2", "feat/drain-v2"), m("acme-app-drain-v3", "feat/drain-v3")]), []);
});

test("a bare number is not a step", () => {
  assert.equal(stepOf("automation-3"), undefined);
  assert.equal(stepOf("card5"), undefined);
  assert.deepEqual(steps([m("acme-app-automation-3", "feat/automation-3"), m("acme-app-automation-4", "feat/automation-4")]), []);
});

test("a date is not a step", () => {
  assert.equal(stepOf("launch-runbook-2026-09-14"), undefined);
  assert.equal(stepOf("release-2026-08-19"), undefined);
  assert.equal(stepOf("flip-wave2026"), undefined, "four digits are never a step number");
  assert.equal(stepOf("flip-phase-2026"), undefined);
  assert.deepEqual(steps([m("acme-app-release-2026-08-18", "release/2026-08-18"), m("acme-app-release-2026-08-19", "release/2026-08-19")]), []);
});

test("a single letter is not a step", () => {
  assert.equal(stepOf("feature-a"), undefined);
  assert.equal(stepOf("alert-d-s"), undefined);
  assert.deepEqual(steps([m("acme-app-feature-a", "feat/feature-a"), m("acme-app-feature-b", "feat/feature-b")]), []);
});

test("a product code is not a step (az-900)", () => {
  assert.equal(stepOf("regen-az-900"), undefined);
  assert.equal(stepOf("regen-sc-300"), undefined);
  assert.deepEqual(steps([m("acme-app-regen-az-900", "regen/az-900"), m("acme-app-regen-az-104", "regen/az-104"), m("acme-app-regen-sc-300", "regen/sc-300")]), []);
});

test("numeric order: s2 comes before s10", () => {
  assert.deepEqual(steps([m("acme-app-pricing-s10", "feat/pricing-s10"), m("acme-app-pricing-s2", "feat/pricing-s2"), m("acme-app-pricing-s1", "feat/pricing-s1")]), ["pricing: s1, s2, s10"]);
});

test("a gap is fine: s1 and s3 are one sequence", () => {
  assert.deepEqual(steps([m("acme-app-pricing-s3", "feat/pricing-s3"), m("acme-app-pricing-s1", "feat/pricing-s1")]), ["pricing: s1, s3"]);
});

test("two worktrees on one step are both listed, by slug", () => {
  const [seq] = sequencesOf([m("acme-app-pricing-s2-retry", "feat/pricing-s2-retry"), m("acme-app-pricing-s2", "feat/pricing-s2"), m("acme-app-pricing-s1", "feat/pricing-s1")], REPO);
  assert.deepEqual(seq.steps.map((s) => [s.step, s.path]), [["s1", "/work/acme-app-pricing-s1"], ["s2", "/work/acme-app-pricing-s2"], ["s2", "/work/acme-app-pricing-s2-retry"]]);
});

test("mixed words under one prefix are not one sequence", () => {
  assert.deepEqual(steps([m("acme-app-drain-slice13", "feat/drain-slice13"), m("acme-app-drain-wave4", "feat/drain-wave4")]), []);
  assert.deepEqual(
    steps([m("acme-app-drain-slice13", "feat/drain-slice13"), m("acme-app-drain-wave4", "feat/drain-wave4"), m("acme-app-drain-wave5", "feat/drain-wave5"), m("acme-app-drain-slice14", "feat/drain-slice14")]),
    ["drain: slice 13, slice 14", "drain: wave 4, wave 5"],
  );
});

test("a step in the middle of a name counts, and what follows it is no part of the prefix or the step", () => {
  assert.deepEqual(stepOf("lb-drain-v3-wave2-sc-100"), { prefix: "lb-drain-v3", word: "wave", n: 2, step: "wave 2" });
  assert.deepEqual(stepOf("nav-phase-2-something"), { prefix: "nav", word: "phase", n: 2, step: "phase 2" });
  assert.equal(stepOf("s1-pricing"), undefined, "a step needs something before it");
  assert.equal(stepOf("phase-2-nav"), undefined);
  assert.deepEqual(stepOf("skyhop-slice-s1"), { prefix: "skyhop-slice", word: "s", n: 1, step: "s1" }, "the first step with a number wins");
  assert.deepEqual(steps([m("acme-app-drain-wave1-az-120", "feat/drain-wave1-az-120"), m("acme-app-drain-wave2-sc-100", "feat/drain-wave2-sc-100")]), ["drain: wave 1, wave 2"]);
});

test("the prefix is compared without regard to letter case, and keeps the first spelling", () => {
  assert.deepEqual(steps([m("acme-app-Pricing-s1", "feat/Pricing-s1"), m("acme-app-pricing-S2", "feat/pricing-S2")]), ["Pricing: s1, s2"]);
});

test("the branch wins over the folder", () => {
  // The folders say s8 and s9 of "old"; the branches say s1 and s2 of "pricing"
  assert.deepEqual(steps([m("acme-app-old-s9", "feat/pricing-s2"), m("acme-app-old-s8", "feat/pricing-s1")]), ["pricing: s1, s2"]);
  assert.equal(branchName("feat/pricing-s1"), "pricing-s1");
  assert.equal(branchName("pricing-s1"), "pricing-s1");
  assert.equal(branchName("feat/team/pricing-s1"), "team/pricing-s1", "only the first part is dropped");
  assert.equal(stepOf(branchName("feat/team/pricing-s1"))?.prefix, "team-pricing");
});

test("a branch with no step falls back to the folder", () => {
  assert.equal(stepOfWorktree({ slug: "acme-app-pricing-s2", branch: "feat/second-go", detached: false }, REPO)?.step, "s2");
  assert.deepEqual(steps([m("acme-app-pricing-s1", "feat/pricing-s1"), m("acme-app-pricing-s2", "feat/second-go")]), ["pricing: s1, s2"]);
});

test("a detached worktree uses its folder, with the repo's name dropped from the front", () => {
  assert.equal(slugName("acme-app-pricing-s3", REPO), "pricing-s3");
  assert.equal(slugName("ACME-APP-pricing-s3", REPO), "pricing-s3");
  assert.equal(slugName("pricing-s3", REPO), "pricing-s3");
  // A detached HEAD's stale branch text is not read
  assert.equal(stepOfWorktree({ slug: "acme-app-pricing-s3", branch: "feat/other-s9", detached: true }, REPO)?.step, "s3");
  assert.deepEqual(steps([m("acme-app-pricing-s1", "feat/pricing-s1"), m("acme-app-pricing-s3", "", { detached: true, verdict: "orphan", label: "orphan" })]), ["pricing: s1, s3"]);
});

test("a worktree a plan names is left out of every sequence", () => {
  const scan = scanOf([scannedRepo("/work/acme-app", [
    scannedWt("/work/acme-app", "main", { main: true }),
    scannedWt("/work/acme-app-pricing-s1", "feat/pricing-s1"),
    scannedWt("/work/acme-app-pricing-s2", "feat/pricing-s2"),
    scannedWt("/work/acme-app-pricing-s3", "feat/pricing-s3"),
  ])]);
  const slice = (worktree: string) => ({ slug: "x", label: "S1", wave: "1", state: "working" as const, why: "", resume: "", worktree });
  const plan = (worktrees: string[]): ParentPlan[] => [{ name: "Pricing", repo: REPO, slices: worktrees.map(slice) }];
  const seqsOf = (plans: ParentPlan[]) => (worktreeBlocks(scan, plans, NOW)[0].sequences ?? []).map((s) => s.steps.map((x) => x.step).join(", "));
  assert.deepEqual(seqsOf([]), ["s1, s2, s3"]);
  // Either slash, any letter case: the join the plan fact line uses
  assert.deepEqual(seqsOf(plan(["\\WORK\\acme-app-pricing-s1\\"])), ["s2, s3"]);
  assert.deepEqual(seqsOf(plan(["/work/acme-app-pricing-s1", "/work/acme-app-pricing-s2"])), [], "one left over is a lone step");
});

test("sequences of one repo are listed by name, and worktrees with no step are in none", () => {
  assert.deepEqual(
    steps([m("acme-app-search-wave2", "feat/search-wave2"), m("acme-app-nav-rework", "feat/nav-rework"), m("acme-app-pricing-s1", "feat/pricing-s1"), m("acme-app-search-wave1", "feat/search-wave1"), m("acme-app-pricing-s2", "feat/pricing-s2")]),
    ["pricing: s1, s2", "search: wave 1, wave 2"],
  );
  assert.deepEqual(sequencesOf([], REPO), []);
});

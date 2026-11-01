import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RESUME, isOfferedByPlans, openSlices, planOnlyRepos, plansForRepo, plansFromRegistry, planSummary, resumeFromArg, sliceDescription, sliceLabel, worktreeFromArg,
  type RegistryEntry,
} from "../src/plans.ts";

const NOW = Date.parse("2026-10-16T01:00:00Z");
const RECENT = "2026-10-15T11:29:11Z";
const OLD = "2026-07-01T00:00:00Z";
const e = (o: Partial<RegistryEntry>): RegistryEntry => ({
  plan: "seal-rebrand", repo_path: "C:/work/webapp", status: "later", last_activity_at: RECENT, ...o,
});
const onDisk = (p: string) => p === "C:/work/webapp-seal-landing";

const seal = [
  e({ slug: "seal-flip", label: "S8", wave: 4, depends_on: ["seal-web"] }),
  e({ slug: "seal-landing", label: "S2", wave: 1, status: "materialised", worktree_path: "C:/work/webapp-seal-landing" }),
  e({ slug: "seal-web", label: "S3", wave: 1, gate_reason: "after rd-legacy-delete merges" }),
  e({ slug: "seal-tokens", label: "S0", wave: 0, status: "merged" }),
  e({ slug: "seal-assets", label: "S6", wave: 3, gate_reason: "after the shoot", gate_date: "2026-10-19" }),
  e({ slug: "seal-sweep", label: "S5", wave: 2, gate_reason: "after review", gate_date: "2026-10-15" }),
  e({ slug: "seal-today", label: "S4", wave: 2, depends_on: ["seal-tokens", "some free text"] }),
];

test("plansFromRegistry orders slices by wave and gives each its state", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  assert.equal(p.name, "seal-rebrand");
  assert.equal(p.repo, "webapp");
  assert.deepEqual(
    p.slices.map((s) => `${s.slug}:${s.state}`),
    ["seal-tokens:done", "seal-landing:working", "seal-web:held", "seal-sweep:due", "seal-today:ready", "seal-assets:held", "seal-flip:held"],
  );
});

test("held says why: a dateless gate, a gate date ahead, an open dependency", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  const why = Object.fromEntries(p.slices.map((s) => [s.slug, s.why]));
  assert.equal(why["seal-web"], "held: after rd-legacy-delete merges");
  assert.equal(why["seal-assets"], "held: after the shoot (until 2026-10-19)");
  assert.equal(why["seal-flip"], "waits on seal-web");
  assert.equal(why["seal-sweep"], "gate date 2026-10-15 reached: after review");
});

test("a merged dependency and free text in depends_on do not hold a slice", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  assert.equal(p.slices.find((s) => s.slug === "seal-today")?.state, "ready");
});

test("resume is the mint command for a later slice, the worktree path for a working one, empty when done", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  const by = Object.fromEntries(p.slices.map((s) => [s.slug, s]));
  assert.equal(by["seal-web"].resume, "git worktree add ../seal-web -b seal-web");
  assert.equal(by["seal-landing"].resume, "C:/work/webapp-seal-landing");
  assert.equal(by["seal-landing"].worktree, "C:/work/webapp-seal-landing");
  assert.equal(by["seal-tokens"].resume, "");
});

test("a custom resume command fills every {slug}", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk, resumeCommand: "mint {slug} # {slug}" });
  assert.equal(p.slices.find((s) => s.slug === "seal-web")?.resume, "mint seal-web # seal-web");
  assert.ok(DEFAULT_RESUME.includes("{slug}"));
});

test("a working slice whose worktree is gone has no resume path", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: () => false });
  const s = p.slices.find((x) => x.slug === "seal-landing")!;
  assert.equal(s.resume, "");
  assert.equal(s.why, "materialised, worktree not on disk");
});

test("openSlices lists only what is left; the summary still counts the done ones", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  assert.ok(!openSlices(p).some((s) => s.slug === "seal-tokens"));
  assert.equal(openSlices(p).length, 6);
  assert.equal(p.slices.find((s) => s.slug === "seal-landing")?.why, "in progress, worktree on disk");
});

test("plansFromRegistry drops single-slice plans, finished plans and plans untouched with nothing on disk", () => {
  const entries = [
    e({ plan: "solo", slug: "a" }),
    e({ plan: "finished", slug: "b", status: "merged" }), e({ plan: "finished", slug: "c", status: "archived" }),
    e({ plan: "abandoned", slug: "d", last_activity_at: OLD }), e({ plan: "abandoned", slug: "f", last_activity_at: OLD }),
    e({ plan: "old-but-open", slug: "g", last_activity_at: OLD, status: "materialised", worktree_path: "C:/work/webapp-seal-landing" }),
    e({ plan: "old-but-open", slug: "h", last_activity_at: OLD }),
    { slug: "no-plan" }, e({ slug: undefined }),
  ];
  assert.deepEqual(plansFromRegistry(entries, { now: NOW, exists: onDisk }).map((p) => p.name), ["old-but-open"]);
});

test("planSummary counts done over total, then each open state", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  assert.equal(planSummary(p), "1/7 · 1 working · 1 due · 1 ready · 3 held");
});

test("slice label and description", () => {
  const [p] = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  const web = p.slices.find((s) => s.slug === "seal-web")!;
  assert.equal(sliceLabel(web), "S3 seal-web");
  assert.equal(sliceLabel({ ...web, label: "" }), "seal-web");
  assert.equal(sliceDescription(web), "after rd-legacy-delete merges");
  assert.equal(sliceDescription(p.slices.find((s) => s.slug === "seal-flip")!), "waits on seal-web");
  assert.equal(sliceDescription(p.slices.find((s) => s.slug === "seal-landing")!), "in progress");
  const long = sliceDescription({ ...web, why: "x".repeat(80) });
  assert.equal(long.length, 60);
  assert.ok(long.endsWith("…"));
});

test("plans attach to their repo group case-insensitively; repos with no session get their own group once", () => {
  const plans = plansFromRegistry([...seal, e({ plan: "other", slug: "o1", repo_path: "C:/work/api" }), e({ plan: "other", slug: "o2" })], { now: NOW, exists: onDisk });
  assert.deepEqual(plansForRepo(plans, "WebApp").map((p) => p.name), ["seal-rebrand"]);
  assert.deepEqual(planOnlyRepos(plans, ["webapp"]), ["api"]);
  assert.deepEqual(planOnlyRepos(plans, ["api", "webapp"]), []);
});

test("resumeFromArg and worktreeFromArg take a raw string or a tree node", () => {
  const slice = { resume: "bash x.sh a --launch", worktree: "I:/w" };
  assert.equal(resumeFromArg("cmd"), "cmd");
  assert.equal(resumeFromArg({ kind: "slice", slice }), "bash x.sh a --launch");
  assert.equal(resumeFromArg({ kind: "slice", slice: { resume: "" } }), undefined);
  assert.equal(resumeFromArg(null), undefined);
  assert.equal(worktreeFromArg({ kind: "slice", slice }), "I:/w");
  assert.equal(worktreeFromArg(""), undefined);
});

test("isOfferedByPlans accepts only worktrees and resume text the registry supplied", () => {
  const plans = plansFromRegistry(seal, { now: NOW, exists: onDisk });
  assert.ok(plans.length > 0);
  assert.equal(isOfferedByPlans(plans, "worktree", "C:/work/webapp-seal-landing"), true);
  assert.equal(isOfferedByPlans(plans, "worktree", "C:/Windows"), false);
  assert.equal(isOfferedByPlans(plans, "worktree", ""), false);
  assert.equal(isOfferedByPlans(plans, "worktree", "C:/work/webapp-seal-landing/"), false);
  assert.equal(isOfferedByPlans(plans, "resume", "C:/work/webapp-seal-landing"), true);
  assert.equal(isOfferedByPlans(plans, "resume", "rm -rf /"), false);
});

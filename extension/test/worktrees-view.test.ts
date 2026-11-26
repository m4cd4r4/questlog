import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParentPlan } from "../src/plans.ts";
import { FOLDER_NOT_FOUND } from "../src/worktrees/run.ts";
import type { ScanFile, ScannedRepo, ScannedWorktree } from "../src/worktrees/scan.ts";
import { countLine, isOfferedByScan, isOpenableByScan, offeredWorktree, withoutWorktrees, worktreeBlocks, worktreeNote } from "../src/worktrees/view.ts";
import { scannedRepo, scannedWt } from "./worktrees-fixtures.ts";

const NOW = Date.UTC(2026, 0, 10);
const HOUR = 60 * 60 * 1000;
const scanOf = (repos: ScannedRepo[], scannedAt = NOW): ScanFile => ({ version: 1, scannedAt, repos });

const main = (path: string) => scannedWt(path, "main", { main: true });
const closable = (path: string, n = 5) => scannedWt(path, "feat/done", { pr: { state: "merged", number: n } });
const needsYou = (path: string) => scannedWt(path, "feat/dirty", { dirty: 1, changed: 1 });
const busy = (path: string) => scannedWt(path, "feat/serving", { server: { port: 3000 } });
const inFlight = (path: string) => scannedWt(path, "feat/open", { pr: { state: "open", number: 9 } });
const orphan = (path: string) => scannedWt(path, "", { detached: true });
const missing = (path: string) => scannedWt(path, "feat/gone", { prunable: true });
const unread = (path: string) => scannedWt(path, "feat/late", { unread: true });

// Written first: three worktrees of one repo in one parent folder.
const THREE = scanOf([scannedRepo("/work/acme-app", [
  main("/work/acme-app"),
  needsYou("/work/acme-app-feature-a"),
  inFlight("/work/acme-app-feature-b"),
  closable("/work/acme-app-feature-c"),
])]);

test("three worktrees of one repo in one parent folder give three rows keyed by path", () => {
  const [block, ...rest] = worktreeBlocks(THREE, [], NOW);
  assert.equal(rest.length, 0);
  assert.equal(block.repoPath, "/work/acme-app");
  assert.deepEqual(block.rows.map((r) => r.path), ["/work/acme-app-feature-a", "/work/acme-app-feature-b", "/work/acme-app-feature-c"]);
  assert.equal(new Set(block.rows.map((r) => r.path)).size, 3);
  assert.deepEqual(block.rows.map((r) => r.slug), ["acme-app-feature-a", "acme-app-feature-b", "acme-app-feature-c"]);
  assert.deepEqual(block.rows.map((r) => r.verdict), ["needs-you", "in-flight", "closable"]);
  assert.deepEqual(block.rows.map((r) => r.label), ["needs you", "in flight", "closable"]);
  assert.equal(block.rows[0].reason, "1 changed file");
  assert.equal(block.rows[2].pr, 5);
});

test("rows are sorted needs you, busy, in flight, orphan, closable, missing, not read yet, then by slug", () => {
  const scan = scanOf([scannedRepo("/work/acme-app", [
    main("/work/acme-app"),
    unread("/work/wt-unread"),
    missing("/work/wt-missing"),
    closable("/work/wt-closable-b"),
    closable("/work/wt-Closable-a"),
    orphan("/work/wt-orphan"),
    inFlight("/work/wt-flight"),
    busy("/work/wt-busy"),
    needsYou("/work/wt-needs"),
  ])]);
  const [block] = worktreeBlocks(scan, [], NOW);
  assert.deepEqual(block.rows.map((r) => r.slug), ["wt-needs", "wt-busy", "wt-flight", "wt-orphan", "wt-Closable-a", "wt-closable-b", "wt-missing", "wt-unread"]);
  assert.deepEqual(block.rows.map((r) => r.verdict), ["needs-you", "busy", "in-flight", "orphan", "closable", "closable", "missing", "unread"]);
});

test("the count line leads with closable, closable first", () => {
  const wts = [main("/work/acme-app")];
  for (let i = 0; i < 21; i++) wts.push(closable(`/work/acme-app-done-${i}`, i + 1));
  for (let i = 0; i < 4; i++) wts.push(needsYou(`/work/acme-app-dirty-${i}`));
  for (let i = 0; i < 7; i++) wts.push(inFlight(`/work/acme-app-open-${i}`));
  const [block] = worktreeBlocks(scanOf([scannedRepo("/work/acme-app", wts)]), [], NOW);
  assert.equal(block.count, "32 worktrees: 21 closable, 4 need you, 7 in flight");
  assert.equal(block.rows.filter((r) => r.verdict === "closable").length, 21);
});

test("the count line says one of a kind in the singular and leaves out a zero", () => {
  const [block] = worktreeBlocks(scanOf([scannedRepo("/work/acme-app", [main("/work/acme-app"), needsYou("/work/acme-app-a")])]), [], NOW);
  assert.equal(block.count, "1 worktree: 1 needs you");
  assert.equal(countLine([{ verdict: "needs-you" }, { verdict: "needs-you" }, { verdict: "busy" }, { verdict: "orphan" }, { verdict: "missing" }]), "5 worktrees: 2 need you, 1 busy, 1 orphan, 1 missing");
});

test("a timed-out repo's count line says so and counts its unread rows as not read yet", () => {
  const scan = scanOf([scannedRepo("/work/acme-app", [main("/work/acme-app"), closable("/work/acme-app-a"), unread("/work/acme-app-b"), unread("/work/acme-app-c")], { timedOut: true })]);
  const [block] = worktreeBlocks(scan, [], NOW);
  assert.equal(block.count, "3 worktrees: 1 closable, 2 not read yet (timed out)");
  const late = block.rows.filter((r) => r.verdict === "unread");
  assert.deepEqual(late.map((r) => r.label), ["not read yet", "not read yet"]);
  assert.deepEqual(late.map((r) => r.reason), ["not read yet", "not read yet"]);
});

test("Closable rows are flagged by their verdict; only a Closable or Orphan row offers a removal, and the block counts the safe ones", () => {
  const [block] = worktreeBlocks(THREE, [], NOW);
  assert.deepEqual(block.rows.filter((r) => r.verdict === "closable").map((r) => r.path), ["/work/acme-app-feature-c"]);
  assert.deepEqual(block.rows.filter((r) => r.canRemove).map((r) => r.path), ["/work/acme-app-feature-c"]);
  assert.equal(block.safe, 1);
  const merged = scanOf([scannedRepo("/work/acme-app", [main("/work/acme-app"), closable("/work/acme-app-feature-c"), orphan("/work/acme-app-feature-o"), needsYou("/work/acme-app-feature-a"), missing("/work/acme-app-feature-m"), unread("/work/acme-app-feature-u"), scannedWt("/work/acme-app-feature-x", "feat/x", { pr: { state: "closed", number: 4 } })])]);
  const [b] = worktreeBlocks(merged, [], NOW);
  assert.deepEqual(b.rows.filter((r) => r.canRemove).map((r) => r.slug).sort(), ["acme-app-feature-c", "acme-app-feature-o", "acme-app-feature-x"]);
  assert.equal(b.safe, 1, "the merged one only; an orphan and a closed-unmerged one are removable alone, never in a batch");
});


test("a row's short slug drops the repo's name from the front, in any letter case, and keeps a slug that has none", () => {
  const scan = scanOf([scannedRepo("/work/acme-app", [
    main("/work/acme-app"),
    needsYou("/work/acme-app-feature-a"),
    needsYou("/work/ACME-APP-feature-b"),
    needsYou("/work/other-thing"),
    needsYou("/work/acme-app-"),
  ])]);
  const [block] = worktreeBlocks(scan, [], NOW);
  const short = Object.fromEntries(block.rows.map((r) => [r.slug, r.short]));
  assert.deepEqual(short, { "acme-app-feature-a": "feature-a", "ACME-APP-feature-b": "feature-b", "other-thing": "other-thing", "acme-app-": "acme-app-" });
});

test("a repo with no linked worktrees has no block", () => {
  assert.deepEqual(worktreeBlocks(scanOf([scannedRepo("/work/solo", [main("/work/solo")])]), [], NOW), []);
  assert.deepEqual(worktreeBlocks(undefined, [], NOW), []);
});

test("the main checkout and a bare entry are never rows", () => {
  const scan = scanOf([scannedRepo("/work/acme-app", [
    main("/work/acme-app"),
    scannedWt("/work/acme-app.git", "", { bare: true }),
    needsYou("/work/acme-app-feature-a"),
  ])]);
  const [block] = worktreeBlocks(scan, [], NOW);
  assert.deepEqual(block.rows.map((r) => r.path), ["/work/acme-app-feature-a"]);
  assert.equal(block.count, "1 worktree: 1 needs you");
});

test("a repo that could not be read has the error as its count line and no rows", () => {
  const [block] = worktreeBlocks(scanOf([scannedRepo("/work/broken", [], { error: "git worktree list timed out" })]), [], NOW);
  assert.equal(block.count, "could not read: git worktree list timed out");
  assert.deepEqual(block.rows, []);
  assert.equal("note" in block, false, "the error is on the count line only");
});

test("a folder that is no repo gets no block", () => {
  const scan = scanOf([
    scannedRepo("/work/gone", [], { error: FOLDER_NOT_FOUND }),
    scannedRepo("/work/plain", [], { error: "fatal: not a git repository (or any of the parent directories): .git" }),
    THREE.repos[0],
  ]);
  assert.deepEqual(worktreeBlocks(scan, [], NOW).map((b) => b.repoPath), ["/work/acme-app"]);
});

test("plan and wave come from the slice whose worktree is the row's path", () => {
  const slice = (o: Partial<ParentPlan["slices"][number]>) => ({ slug: "s", label: "", wave: "", state: "working" as const, why: "", resume: "", worktree: "", ...o });
  const plans: ParentPlan[] = [{ name: "Pricing", repo: "acme-app", slices: [
    slice({ slug: "a", label: "S2", wave: "1", worktree: "\\WORK\\acme-app-feature-a\\" }),
    slice({ slug: "b", wave: "3", worktree: "/work/acme-app-feature-b" }),
  ] }];
  const [block] = worktreeBlocks(THREE, plans, NOW);
  assert.ok(block.rows[0].facts.includes("plan Pricing, S2"));
  assert.ok(block.rows[1].facts.includes("plan Pricing, wave 3"));
  assert.ok(!block.rows[2].facts.some((f) => f.startsWith("plan ")));
});

test("the facts on expand hold what the scan holds and leave out what it does not", () => {
  const full = scannedWt("/work/acme-app-feature-a", "feat/a", {
    pr: { state: "open", number: 12 }, lastCommitAt: NOW - 3 * 24 * HOUR, server: { port: 5173 }, brief: "lost",
    size: { bytes: 1536, sharesNodeModules: true, measuredAt: NOW, key: "k" },
    overlaps: [{ path: "/work/acme-app-feature-b", count: 2, files: ["a.ts", "b.ts"] }, { path: "/work/acme-app-feature-c", count: 1, files: ["a.ts"] }],
  });
  const bare = scannedWt("/work/acme-app-feature-b", "", { detached: true, pr: { state: "unknown" }, size: "unknown", server: "unknown", brief: "present", overlaps: [] });
  const [block] = worktreeBlocks(scanOf([scannedRepo("/work/acme-app", [main("/work/acme-app"), full, bare])]), [], NOW);
  const a = block.rows.find((r) => r.slug === "acme-app-feature-a")!;
  assert.deepEqual(a.facts, [
    "branch feat/a", "PR #12 open", "last commit 3d ago", "size 1.5 KB, shares node_modules", "dev server on port 5173", "brief lost",
    "shares 2 files with acme-app-feature-b", "shares 1 file with acme-app-feature-c",
  ]);
  assert.equal(a.age, "3d");
  assert.equal(a.size, "1.5 KB");
  assert.equal(a.pr, 12);
  const b = block.rows.find((r) => r.slug === "acme-app-feature-b")!;
  assert.deepEqual(b.facts, ["detached HEAD"]);
  assert.equal(b.age, "");
  assert.equal(b.size, "");
  assert.equal("pr" in b, false);
});

test("a Missing row cannot be opened, every other row can", () => {
  const scan = scanOf([scannedRepo("/work/acme-app", [main("/work/acme-app"), missing("/work/acme-app-gone"), needsYou("/work/acme-app-feature-a")])]);
  const [block] = worktreeBlocks(scan, [], NOW);
  assert.deepEqual(block.rows.map((r) => [r.verdict, r.canOpen]), [["needs-you", true], ["missing", false]]);
  assert.equal(isOfferedByScan(scan, "/work/acme-app-gone"), true);
  assert.equal(isOpenableByScan(scan, "/work/acme-app-gone"), false);
  assert.equal(isOpenableByScan(scan, "/work/acme-app-feature-a"), true);
  assert.equal(isOpenableByScan(scan, "/work/made-up"), false);
});

test("isOfferedByScan honours a scanned path the registry does not know and drops everything else", () => {
  const scan = scanOf([
    ...THREE.repos,
    scannedRepo("/work/plain", [needsYou("/work/plain-wt")], { error: FOLDER_NOT_FOUND }),
    scannedRepo("/work/bare-repo", [main("/work/bare-repo"), scannedWt("/work/bare-repo.git", "", { bare: true })]),
  ]);
  // Picks the right one of three in one folder, whatever the slashes or letter case
  assert.equal(isOfferedByScan(scan, "/work/acme-app-feature-b"), true);
  assert.equal(isOfferedByScan(scan, "\\WORK\\Acme-App-Feature-B\\"), true);
  assert.equal(isOfferedByScan(scan, "/work/made-up"), false);
  assert.equal(isOfferedByScan(scan, "/work/acme-app-feature"), false);
  assert.equal(isOfferedByScan(scan, "/work/acme-app"), false, "the main checkout");
  assert.equal(isOfferedByScan(scan, "/work/bare-repo.git"), false, "a bare entry");
  assert.equal(isOfferedByScan(scan, "/work/plain-wt"), false, "a folder that is no repo");
  assert.equal(isOfferedByScan(scan, ""), false);
  assert.equal(isOfferedByScan(undefined, "/work/acme-app-feature-b"), false);
});

// Three worktrees of one repo in one parent folder, one of each kind: the guard picks the one asked for.
const PICK_THREE = scanOf([scannedRepo("/work/acme-app", [
  main("/work/acme-app"),
  needsYou("/work/acme-app-feature-a"),
  closable("/work/acme-app-feature-b"),
  orphan("/work/acme-app-feature-c"),
])]);

test("three worktrees of one repo in one parent folder: offeredWorktree returns the one at the path, never a neighbour", () => {
  for (const path of ["/work/acme-app-feature-a", "/work/acme-app-feature-b", "/work/acme-app-feature-c"]) {
    assert.equal(offeredWorktree(PICK_THREE, path)?.path, path);
  }
  // Either slash, any letter case, and never a neighbour whose name starts the same
  assert.equal(offeredWorktree(PICK_THREE, "\\WORK\\Acme-App-Feature-B\\")?.path, "/work/acme-app-feature-b");
  assert.equal(offeredWorktree(PICK_THREE, "/work/acme-app-feature"), undefined);
  assert.equal(offeredWorktree(PICK_THREE, "/work/acme-app"), undefined, "the main checkout");
  assert.equal(offeredWorktree(PICK_THREE, ""), undefined);
  assert.equal(offeredWorktree(undefined, "/work/acme-app-feature-b"), undefined);
});

test("worktreeNote speaks for a first scan in progress and for an old scan, else stays empty", () => {
  assert.equal(worktreeNote(undefined, true, NOW), "Reading worktrees for the first time");
  assert.equal(worktreeNote(undefined, false, NOW), "");
  assert.equal(worktreeNote(scanOf([], NOW - HOUR), true, NOW), "");
  assert.equal(worktreeNote(scanOf([], NOW - 24 * HOUR), false, NOW), "");
  assert.equal(worktreeNote(scanOf([], NOW - 30 * HOUR), false, NOW), "Worktree scan is 30 hours old");
});

// Keeps the helper types honest: a scanned worktree from the fixtures is what the view takes.
const _typed: ScannedWorktree = closable("/work/x");
void _typed;

// Sequences among worktrees no plan names.
const SEQ = scanOf([scannedRepo("/work/acme-app", [
  main("/work/acme-app"),
  scannedWt("/work/acme-app-pricing-s2", "feat/pricing-s2", { dirty: 1, changed: 1 }),
  scannedWt("/work/acme-app-pricing-s1", "feat/pricing-s1", { pr: { state: "merged", number: 7 } }),
  scannedWt("/work/acme-app-pricing-s3", "feat/pricing-s3", { pr: { state: "open", number: 9 } }),
  inFlight("/work/acme-app-nav-rework"),
])]);

test("a block's sequences hold each step in order with its row's path, verdict and label; the rows keep their verdict order", () => {
  const [block] = worktreeBlocks(SEQ, [], NOW);
  assert.deepEqual(block.sequences, [{ name: "pricing", steps: [
    { step: "s1", path: "/work/acme-app-pricing-s1", verdict: "closable", label: "closable" },
    { step: "s2", path: "/work/acme-app-pricing-s2", verdict: "needs-you", label: "needs you" },
    { step: "s3", path: "/work/acme-app-pricing-s3", verdict: "in-flight", label: "in flight" },
  ] }]);
  assert.deepEqual(block.rows.map((r) => r.slug), ["acme-app-pricing-s2", "acme-app-nav-rework", "acme-app-pricing-s3", "acme-app-pricing-s1"]);
  assert.equal(block.count, "4 worktrees: 1 closable, 1 needs you, 2 in flight");
  assert.equal(block.rows.filter((r) => r.verdict === "closable").length, 1);
  for (const s of block.sequences![0].steps) assert.ok(block.rows.some((r) => r.path === s.path && r.verdict === s.verdict), "every step is one of the rows");
});

test("a member row's facts end with its sequence and step; a row in no sequence has no such line", () => {
  const [block] = worktreeBlocks(SEQ, [], NOW);
  const facts = (slug: string) => block.rows.find((r) => r.slug === slug)!.facts;
  assert.equal(facts("acme-app-pricing-s1").at(-1), "sequence pricing, s1");
  assert.equal(facts("acme-app-pricing-s2").at(-1), "sequence pricing, s2");
  assert.equal(facts("acme-app-pricing-s3").at(-1), "sequence pricing, s3");
  assert.ok(!facts("acme-app-nav-rework").some((f) => f.startsWith("sequence ")));
});

test("a block with no sequence has no sequences key, so it is built exactly as before", () => {
  const [block] = worktreeBlocks(THREE, [], NOW);
  assert.equal("sequences" in block, false);
  assert.ok(!block.rows.some((r) => r.facts.some((f) => f.startsWith("sequence "))));
});

test("a sequence never crosses repos: one prefix in two repos is no sequence", () => {
  const scan = scanOf([
    scannedRepo("/work/acme-app", [main("/work/acme-app"), scannedWt("/work/acme-app-pricing-s1", "feat/pricing-s1")]),
    scannedRepo("/work/field-notes", [main("/work/field-notes"), scannedWt("/work/field-notes-pricing-s2", "feat/pricing-s2")]),
  ]);
  assert.deepEqual(worktreeBlocks(scan, [], NOW).map((b) => "sequences" in b), [false, false]);
});

test("withoutWorktrees drops only the removed linked worktree, matched without regard to case or slashes", () => {
  const scan = scanOf([
    scannedRepo("C:/work/app", [
      main("C:/work/app"),
      scannedWt("C:/work/app.git", "", { bare: true }),
      closable("C:/work/app-a"),
      closable("C:/work/app-b"),
      closable("C:/work/app-c"),
    ]),
    scannedRepo("C:/work/other", [main("C:/work/other"), closable("C:/work/other-b")]),
  ]);
  const after = withoutWorktrees(scan, ["c:\\WORK\\app-b", "C:/work/app", "C:/work/app.git", "", 5 as unknown as string]);
  assert.deepEqual(after.repos.map((r) => r.worktrees.map((w) => w.path)), [
    ["C:/work/app", "C:/work/app.git", "C:/work/app-a", "C:/work/app-c"],
    ["C:/work/other", "C:/work/other-b"],
  ]);
  assert.equal(withoutWorktrees(scan, []), scan);
});

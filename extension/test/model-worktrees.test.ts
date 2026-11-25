// The worktree scan joined to the sidebar's model: blocks in repo groups, live slice facts on plan cards,
// the note above the groups, and the size of what is sent to the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, parseMessage, WT_ROWS_SHOWN, worktreeRowsOf } from "../src/model.ts";
import { GONE_MS, STALE_MS, type Row } from "../src/rows.ts";
import type { ParentPlan } from "../src/plans.ts";
import { FOLDER_NOT_FOUND } from "../src/worktrees/run.ts";
import type { ScanFile, ScannedRepo } from "../src/worktrees/scan.ts";
import { scannedRepo, scannedWt } from "./worktrees-fixtures.ts";

const NOW = 10 * GONE_MS;
const row = (o: Partial<Row>): Row => ({ id: "x", repo: "r", where: "", plan: "Plan", done: 0, total: 0, now: "", updatedAt: NOW, ...o });
const input = (rows: Row[], extra: { plans?: ParentPlan[] } = {}) => ({ rows, plans: extra.plans ?? [], note: [], now: NOW });

const scanOf = (repos: ScannedRepo[], scannedAt = NOW): ScanFile => ({ version: 1, scannedAt, repos });
const acme = (root = "/work/acme-app") => scannedRepo(root, [
  scannedWt(root, "main", { main: true }),
  scannedWt(`${root}-feature-a`, "feat/a", { dirty: 1, changed: 1 }),
  scannedWt(`${root}-feature-b`, "feat/b", { pr: { state: "open", number: 9 } }),
  scannedWt(`${root}-feature-c`, "feat/c", { pr: { state: "merged", number: 5 } }),
]);

test("buildModel with no scan has no worktree blocks and an empty worktree note", () => {
  const m = buildModel(input([row({ repo: "acme-app" })]));
  assert.equal(m.worktreeNote, "");
  assert.equal(m.groups.some((g) => "worktrees" in g), false);
});

test("buildModel joins a scanned repo to the session group of its name, whatever the letter case", () => {
  const m = buildModel({ ...input([row({ repo: "Acme-App" })]), scan: scanOf([acme()]) });
  assert.deepEqual(m.groups.map((g) => g.repo), ["Acme-App"]);
  const [block] = m.groups[0].worktrees!;
  assert.equal(block.repoPath, "/work/acme-app");
  assert.equal(block.count, "3 worktrees: 1 closable, 1 needs you, 1 in flight");
  // Three worktrees of one repo in one parent folder, each keyed by its own path: the two shown before a click
  // travel with the model, the Closable one is counted and sent when its toggle is opened
  assert.deepEqual(block.rows.map((r) => r.path), ["/work/acme-app-feature-a", "/work/acme-app-feature-b"]);
  assert.equal(block.closable, 1);
  assert.equal(block.more, 0);
  assert.deepEqual(worktreeRowsOf(scanOf([acme()]), [], NOW, "/work/acme-app")!.map((r) => r.path), ["/work/acme-app-feature-a", "/work/acme-app-feature-b", "/work/acme-app-feature-c"]);
  assert.equal(m.groups[0].cards.length, 1);
  assert.equal(m.summary.sessions, 1);
});

test("buildModel joins a scanned repo to a group that holds only ended tabs, and keeps the ended cards apart", () => {
  const ended = row({ id: "e", repo: "acme-app", total: 3, done: 1, ended: true, updatedAt: NOW - STALE_MS - 1 });
  const m = buildModel({ ...input([ended]), scan: scanOf([acme()]) });
  const g = m.groups.find((x) => x.repo === "acme-app")!;
  assert.equal(m.groups.filter((x) => x.repo.toLowerCase() === "acme-app").length, 1);
  assert.equal(g.worktrees!.length, 1);
  assert.deepEqual(g.ended.map((c) => c.id), ["e"]);
  assert.equal(g.cards.some((c) => c.id === "e"), false);
});

test("buildModel gives a scanned repo with no session its own group, after the others and in name order", () => {
  const zeta = scannedRepo("/work/zeta", [scannedWt("/work/zeta", "main", { main: true }), scannedWt("/work/zeta-a", "feat/a")]);
  const beta = scannedRepo("/work/Beta", [scannedWt("/work/Beta", "main", { main: true }), scannedWt("/work/Beta-a", "feat/a")]);
  const solo = scannedRepo("/work/solo", [scannedWt("/work/solo", "main", { main: true })]);
  const broken = scannedRepo("/work/broken", [], { error: "git worktree list timed out" });
  const plan: ParentPlan = { name: "Big job", repo: "other", slices: [] };
  const m = buildModel({ ...input([row({ repo: "r" })], { plans: [plan] }), scan: scanOf([zeta, solo, broken, beta]) });
  assert.deepEqual(m.groups.map((g) => g.repo), ["r", "other", "Beta", "zeta"]);
  assert.deepEqual(m.groups.map((g) => g.worktrees?.length ?? 0), [0, 0, 1, 1]);
  assert.deepEqual(m.groups[2].cards, []);
  assert.deepEqual(m.groups[2].ended, []);
  assert.equal(m.summary.sessions, 1);
});

test("buildModel shows an unreadable repo's error in the group of its name", () => {
  const broken = scannedRepo("/work/acme-app", [], { error: "git worktree list timed out" });
  const m = buildModel({ ...input([row({ repo: "acme-app" })]), scan: scanOf([broken]) });
  assert.equal(m.groups[0].worktrees![0].count, "could not read: git worktree list timed out");
  assert.deepEqual(m.groups[0].worktrees![0].rows, []);
});

test("buildModel puts two scanned repos of one name in one group, each block named by its main checkout", () => {
  const m = buildModel({ ...input([row({ repo: "acme-app" })]), scan: scanOf([acme("/work/acme-app"), acme("/other/acme-app")]) });
  assert.deepEqual(m.groups.map((g) => g.repo), ["acme-app"]);
  assert.deepEqual(m.groups[0].worktrees!.map((b) => b.repoPath), ["/work/acme-app", "/other/acme-app"]);
  const none = buildModel({ ...input([]), scan: scanOf([acme("/work/acme-app"), acme("/other/Acme-App")]) });
  assert.deepEqual(none.groups.map((g) => g.repo), ["acme-app"]);
  assert.equal(none.groups[0].worktrees!.length, 2);
});

test("buildModel gives a folder that is no repo neither a block nor a group", () => {
  const m = buildModel({ ...input([]), scan: scanOf([scannedRepo("/work/gone", [], { error: FOLDER_NOT_FOUND })]) });
  assert.deepEqual(m.groups, []);
});

test("buildModel takes a row's plan and wave from the plans it already holds", () => {
  const plan: ParentPlan = { name: "Pricing", repo: "acme-app", slices: [{ slug: "a", label: "S2", wave: "1", state: "working", why: "", resume: "", worktree: "/work/acme-app-feature-a" }] };
  const m = buildModel({ ...input([], { plans: [plan] }), scan: scanOf([acme()]) });
  assert.deepEqual(m.groups.map((g) => g.repo), ["acme-app"]);
  assert.ok(m.groups[0].worktrees![0].rows[0].facts.includes("plan Pricing, S2"));
});

test("buildModel carries the worktree note for a first scan and for an old one", () => {
  assert.equal(buildModel({ ...input([]), scanning: true }).worktreeNote, "Reading worktrees for the first time");
  assert.equal(buildModel({ ...input([]), scan: scanOf([], NOW - 26 * 60 * 60 * 1000) }).worktreeNote, "Worktree scan is 26 hours old");
  assert.equal(buildModel({ ...input([]), scan: scanOf([]), scanning: true }).worktreeNote, "");
});

test("parseMessage takes copyPath with a path only", () => {
  assert.deepEqual(parseMessage({ type: "copyPath", path: "/work/acme-app-feature-a" }), { type: "copyPath", path: "/work/acme-app-feature-a" });
  assert.equal(parseMessage({ type: "copyPath" }), undefined);
  assert.equal(parseMessage({ type: "copyPath", path: "" }), undefined);
  assert.equal(parseMessage({ type: "copyPath", path: 3 }), undefined);
});

test("parseMessage has no close message for a worktree", () => {
  assert.equal(parseMessage({ type: "closeWorktree", path: "/work/acme-app-feature-c" }), undefined);
  assert.equal(parseMessage({ type: "closeAllSafe", repoPath: "/work/acme-app" }), undefined);
});

// Plan cards with live slice facts: the scan's verdict on a slice's worktree, on the registry's card.
const pricing = (): ParentPlan => ({ name: "Pricing", repo: "acme-app", slices: [
  { slug: "tokens", label: "S0", wave: "0", state: "done", why: "merged", resume: "", worktree: "" },
  { slug: "feature-c", label: "S1", wave: "1", state: "working", why: "in progress, worktree on disk", resume: "/work/acme-app-feature-c", worktree: "/work/acme-app-feature-c" },
  { slug: "feature-a", label: "S2", wave: "1", state: "working", why: "in progress, worktree on disk", resume: "/work/acme-app-feature-a", worktree: "/work/acme-app-feature-a" },
  { slug: "later", label: "S3", wave: "2", state: "held", why: "waits on feature-a", resume: "mint later", worktree: "" },
] });
const planCardOf = (plan: ParentPlan, scan?: ScanFile) =>
  buildModel({ ...input([], { plans: [plan] }), ...(scan ? { scan } : {}) }).groups[0].cards.find((c) => c.kind === "plan")!;

test("a plan card built with no scan is the registry's card", () => {
  const registry = {
    id: "plan:acme-app:Pricing", kind: "plan", title: "Pricing", state: "run", age: "", done: 1, total: 4, held: 1, where: "", now: "",
    steps: [
      { status: "now", text: "S1 feature-c", detail: "in progress, worktree on disk", resume: "/work/acme-app-feature-c", worktree: "/work/acme-app-feature-c" },
      { status: "now", text: "S2 feature-a", detail: "in progress, worktree on disk", resume: "/work/acme-app-feature-a", worktree: "/work/acme-app-feature-a" },
      { status: "todo", text: "S3 later", detail: "waits on feature-a", resume: "mint later", worktree: undefined },
    ],
    open: false, canResume: false,
  };
  assert.deepEqual(planCardOf(pricing()), registry);
  // A scan that holds none of the plan's worktrees changes nothing either
  const elsewhere = scanOf([scannedRepo("/work/zeta", [scannedWt("/work/zeta", "main", { main: true }), scannedWt("/work/zeta-a", "feat/a")])]);
  assert.deepEqual(planCardOf(pricing(), elsewhere), registry);
});

test("a slice done by live facts raises the card's done count and stays listed with Open worktree; one that needs you takes the needs mark", () => {
  const card = planCardOf(pricing(), scanOf([acme()]));
  assert.equal(card.done, 2);
  assert.equal(card.total, 4);
  assert.equal(card.state, "run");
  assert.deepEqual(card.steps, [
    { status: "done", text: "S1 feature-c", detail: "PR #5 merged, clean", resume: undefined, worktree: "/work/acme-app-feature-c" },
    { status: "needs", text: "S2 feature-a", detail: "needs you: 1 changed file", resume: "/work/acme-app-feature-a", worktree: "/work/acme-app-feature-a" },
    { status: "todo", text: "S3 later", detail: "waits on feature-a", resume: "mint later", worktree: undefined },
  ]);
});

test("a plan whose only working slice has merged is no longer running", () => {
  const plan = pricing();
  plan.slices = plan.slices.filter((s) => s.slug !== "feature-a");
  const card = planCardOf(plan, scanOf([acme()]));
  assert.equal(card.state, "held");
  assert.equal(card.done, 2);
});

test("a slice the registry calls done whose worktree needs you is listed again, with Open worktree and no resume", () => {
  const plan = pricing();
  plan.slices[0] = { slug: "feature-a", label: "S0", wave: "0", state: "done", why: "merged", resume: "", worktree: "/work/acme-app-feature-a" };
  plan.slices = plan.slices.filter((s, i) => i === 0 || s.slug !== "feature-a");
  const card = planCardOf(plan, scanOf([acme()]));
  assert.equal(card.done, 1);
  assert.equal(card.state, "run");
  assert.deepEqual(card.steps[0], { status: "needs", text: "S0 feature-a", detail: "registry says merged; needs you: 1 changed file", resume: undefined, worktree: "/work/acme-app-feature-a" });
});

// The model is posted to the page on every refresh. One machine here holds 320 worktrees: the worktree part
// of the model has to stay small enough to send every time.
const SIZE_LIMIT = 100 * 1024;
const VERDICT_MIX = [
  { dirty: 2, changed: 1, untracked: 1 },
  { pr: { state: "open" as const, number: 41 } },
  { pr: { state: "merged" as const, number: 12 } },
  { detached: true },
  { unpushed: 3 },
];

const many = () => {
  const repos: ScannedRepo[] = [];
  for (let r = 0; r < 16; r++) {
    const root = `/work/repo-${String(r).padStart(2, "0")}-example`;
    const wts = [scannedWt(root, "main", { main: true })];
    for (let i = 0; i < 20; i++) {
      const slug = `${root}-feature-${String(i).padStart(2, "0")}-${["pricing-table", "checkout-copy", "search-results", "settings-page"][i % 4]}`;
      wts.push(scannedWt(slug, `feat/${slug.split("/").pop()}`, { ...VERDICT_MIX[(r + i) % VERDICT_MIX.length], lastCommitAt: NOW - (i + 1) * 3_600_000, size: { bytes: 1_200_000_000 + i * 1000, measuredAt: NOW, key: `k${i}`, ...(i % 3 === 0 ? { sharesNodeModules: true as const } : {}) } }));
    }
    repos.push(scannedRepo(root, wts));
  }
  return repos;
};

test("with 320 seeded worktrees the worktree part of the model stays under 100 KB, and every row is still reachable", () => {
  const repos = many();
  const scan = scanOf(repos);
  const m = buildModel({ ...input(repos.map((x, i) => row({ id: `s${i}`, repo: x.path.split("/").pop()! }))), scan });
  const blocks = m.groups.flatMap((g) => g.worktrees ?? []);
  assert.equal(blocks.length, 16);
  // Every block counts all 20 of its worktrees: the rows sent, plus the ones behind Show more and the closable toggle
  for (const b of blocks) {
    assert.ok(b.rows.length <= WT_ROWS_SHOWN);
    assert.equal(b.rows.every((r) => r.verdict !== "closable"), true);
    assert.equal(b.rows.length + b.more + b.closable, 20);
    assert.equal(worktreeRowsOf(scan, [], NOW, b.repoPath)!.length, 20);
  }
  const bytes = Buffer.byteLength(JSON.stringify(blocks));
  const every = Buffer.byteLength(JSON.stringify(repos.map((r) => worktreeRowsOf(scan, [], NOW, r.path))));
  console.log(`worktree model: ${bytes} bytes sent for 320 worktrees (every row would be ${every})`);
  assert.ok(bytes < SIZE_LIMIT, `${bytes} bytes is over ${SIZE_LIMIT}`);
});

test("worktreeRowsOf answers only for a block the scan holds, either slash and any letter case", () => {
  const scan = scanOf([acme()]);
  assert.equal(worktreeRowsOf(scan, [], NOW, "\\WORK\\Acme-App\\")!.length, 3);
  for (const p of ["/work/acme-app-feature-a", "/work/other", "", undefined as never]) assert.equal(worktreeRowsOf(scan, [], NOW, p), undefined, String(p));
  assert.equal(worktreeRowsOf(undefined, [], NOW, "/work/acme-app"), undefined);
});

test("parseMessage takes worktreeRows with a repo path only", () => {
  assert.deepEqual(parseMessage({ type: "worktreeRows", repoPath: "/work/acme-app" }), { type: "worktreeRows", repoPath: "/work/acme-app" });
  assert.equal(parseMessage({ type: "worktreeRows" }), undefined);
  assert.equal(parseMessage({ type: "worktreeRows", repoPath: "" }), undefined);
  assert.equal(parseMessage({ type: "worktreeRows", repoPath: "x".repeat(1025) }), undefined);
});

test("the model carries when its scan was written, so the page knows when to ask for rows again", () => {
  assert.equal(buildModel(input([])).worktreeScanAt, 0);
  assert.equal(buildModel({ ...input([]), scan: scanOf([acme()], 1234) }).worktreeScanAt, 1234);
});

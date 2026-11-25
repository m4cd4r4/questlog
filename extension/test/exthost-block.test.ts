// The extension host is shared by every extension in the window. On 2026-11-04 VS Code's profiler blamed Questlog
// for blocking it, and 40 saved host profiles put 5.4 s inside its `update` (readRows 3.9 s): a sync read of every
// file in ~/.claude/questlog on each watcher burst and each 30 s tick. This measures the longest stretch the event
// loop is held during one refresh, on a folder the size of the real one, after a session writes its row.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refresher } from "../src/refresh.ts";
import { buildModel } from "../src/model.ts";
import { scanReader } from "../src/worktrees/scan.ts";
import { scannedRepo, scannedWt } from "./worktrees-fixtures.ts";
import { FOLDER, NOW, SESSIONS, buildFolder, longestBlock, row } from "./fixtures/big-folder.ts";

const BUDGET_MS = 50;
const RUNS = 20;

let root = "";
let dir = "";
before(() => {
  root = mkdtempSync(join(tmpdir(), "ql-block-"));
  dir = buildFolder(root);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("one refresh after a row write holds the extension host under 50 ms (median of 20)", async () => {
  const refresher = new Refresher(() => dir);
  const input = { now: NOW, live: new Map([[SESSIONS[0], { status: "busy" as const }]]), registryPath: join(root, "workspaces", "registry.json"), resumeCommand: "x {slug}" };
  const update = async () => {
    const snap = await refresher.refresh(input);
    const model = buildModel({ rows: snap.rows, plans: snap.plans, note: snap.note, now: NOW, focusedId: SESSIONS[0], dismissed: snap.dismissed, openTags: new Set(), folders: [FOLDER], live: input.live });
    // postMessage serialises the model on the host too
    JSON.stringify({ type: "model", model });
    return snap;
  };
  const first = await update();
  const blocks: number[] = [];
  for (let n = 0; n < RUNS; n++) {
    // The live session reports a new step: the mod rewrites its row, the watcher names the file
    const name = `${SESSIONS[0]}.json`;
    writeFileSync(join(dir, name), JSON.stringify({ ...row(0, NOW + n + 1), now: `Run ${n}` }));
    refresher.changed(name);
    let snap: Awaited<ReturnType<typeof update>> | undefined;
    blocks.push(await longestBlock(async () => (snap = await update())));
    assert.equal(snap!.rows.length, first.rows.length);
    assert.equal(snap!.rows.find((r) => r.id === SESSIONS[0])!.now, `Run ${n}`);
  }
  const sorted = [...blocks].sort((a, b) => a - b);
  const median = sorted[Math.floor(RUNS / 2)];
  console.log(`refresh: longest block median ${median.toFixed(1)} ms, max ${sorted[RUNS - 1].toFixed(1)} ms over ${RUNS} runs`);
  assert.ok(median < BUDGET_MS, `median block ${median.toFixed(1)} ms is over ${BUDGET_MS} ms`);
});

test("a 5-minute rescan that rereads every recently updated row holds the extension host under 50 ms (median of 20)", async () => {
  const refresher = new Refresher(() => dir);
  const input = { now: NOW, live: new Map([[SESSIONS[0], { status: "busy" as const }]]), registryPath: join(root, "workspaces", "registry.json"), resumeCommand: "x {slug}" };
  // Far more sessions active in the last few minutes than a real day has: each is reread on every rescan
  for (let i = 0; i < 30; i++) writeFileSync(join(dir, `${row(i).id}.json`), JSON.stringify(row(i, NOW - i * 1000)));
  await refresher.refresh(input);
  const blocks: number[] = [];
  for (let n = 0; n < RUNS; n++) {
    refresher.changed();
    blocks.push(await longestBlock(() => refresher.refresh(input)));
  }
  const sorted = [...blocks].sort((a, b) => a - b);
  const median = sorted[Math.floor(RUNS / 2)];
  console.log(`rescan: longest block median ${median.toFixed(1)} ms, max ${sorted[RUNS - 1].toFixed(1)} ms over ${RUNS} runs`);
  assert.ok(median < BUDGET_MS, `median block ${median.toFixed(1)} ms is over ${BUDGET_MS} ms`);
});

test("a refresh that also reads a 320-worktree scan and draws its blocks holds the extension host under 50 ms (median of 20)", async () => {
  const refresher = new Refresher(() => dir);
  const input = { now: NOW, live: new Map([[SESSIONS[0], { status: "busy" as const }]]), registryPath: join(root, "workspaces", "registry.json"), resumeCommand: "x {slug}" };
  const repos = Array.from({ length: 16 }, (_, r) => {
    const top = join(root, `repo-${r}`);
    return scannedRepo(top, [scannedWt(top, "main", { main: true }), ...Array.from({ length: 20 }, (_, i) =>
      scannedWt(`${top}-feature-${i}`, `feat/feature-${i}`, i % 4 === 0 ? { dirty: 2, changed: 2 } : i % 4 === 1 ? { pr: { state: "merged", number: i } } : { pr: { state: "open", number: i } }))]);
  });
  const cache = join(dir, "worktrees", "scan.cache");
  mkdirSync(join(dir, "worktrees"), { recursive: true });
  const read = scanReader();
  const update = async () => {
    const snap = await refresher.refresh(input);
    const scan = await read(cache);
    const model = buildModel({ rows: snap.rows, plans: snap.plans, note: snap.note, now: NOW, focusedId: SESSIONS[0], dismissed: snap.dismissed, openTags: new Set(), folders: [FOLDER], live: input.live, scan });
    JSON.stringify({ type: "model", model });
    return scan;
  };
  await update();
  const blocks: number[] = [];
  for (let n = 0; n < RUNS; n++) {
    // A new scan lands each time, so the cache is parsed again on every run
    writeFileSync(cache, JSON.stringify({ version: 1, scannedAt: NOW + n, repos }));
    // Same size each time: a distinct modified time is what tells the reader the file moved
    utimesSync(cache, new Date(NOW + n * 1000), new Date(NOW + n * 1000));
    let scan: Awaited<ReturnType<typeof update>>;
    blocks.push(await longestBlock(async () => (scan = await update())));
    assert.equal(scan!.scannedAt, NOW + n);
  }
  const sorted = [...blocks].sort((a, b) => a - b);
  const median = sorted[Math.floor(RUNS / 2)];
  console.log(`refresh with worktrees: longest block median ${median.toFixed(1)} ms, max ${sorted[RUNS - 1].toFixed(1)} ms over ${RUNS} runs`);
  assert.ok(median < BUDGET_MS, `median block ${median.toFixed(1)} ms is over ${BUDGET_MS} ms`);
});

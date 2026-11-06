import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refresher } from "../src/refresh.ts";

const NOW = Date.parse("2026-11-05T00:00:00Z");
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const row = (id: string, extra: object = {}) => ({ id, repo: "app", where: "", plan: `Plan ${id.slice(0, 1)}`, done: 0, total: 1, now: "", updatedAt: NOW - 1000, ...extra });

let root = "";
let dir = "";
const input = () => ({ now: NOW, live: undefined, registryPath: join(root, "none.json"), resumeCommand: "x" });
const put = (name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ql-refresh-"));
  dir = join(root, "questlog");
  mkdirSync(dir);
  // Three sessions in one folder
  for (const id of ids) put(`${id}.json`, row(id, { cwd: root }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a gone session whose open step's path exists is closed, on disk and in the snapshot", async () => {
  mkdirSync(join(root, "out"));
  put(`${ids[1]}.json`, row(ids[1], { cwd: root, ended: true, steps: [{ text: "Build", status: "now", check: { exists: "out" } }] }));
  const snap = await new Refresher(() => dir).refresh(input());
  assert.equal(snap.rows.find((r) => r.id === ids[1])!.closed?.by, "check");
  assert.equal(snap.rows.filter((r) => r.closed).length, 1);
  assert.ok(existsSync(join(dir, `${ids[1]}.close`)));
});

test("only named files are reread; a nameless change rescans and finds files nobody named", async () => {
  const r = new Refresher(() => dir);
  assert.equal((await r.refresh(input())).rows.length, 3);
  rmSync(join(dir, `${ids[0]}.json`));
  const fourth = "44444444-4444-4444-8444-444444444444";
  put(`${fourth}.json`, row(fourth));
  r.changed(`${ids[0]}.json`);
  // The removed file was named and goes; the new one was not, so memory does not have it yet
  assert.deepEqual((await r.refresh(input())).rows.map((x) => x.id).sort(), [ids[1], ids[2]]);
  r.changed();
  assert.deepEqual((await r.refresh(input())).rows.map((x) => x.id).sort(), [ids[1], ids[2], fourth]);
});

test("a file that failed to read is read again by the next rescan, even with its size and mtime unchanged", async () => {
  const r = new Refresher(() => dir);
  const path = join(dir, `${ids[0]}.json`);
  const good = JSON.stringify(row(ids[0]));
  // Whole seconds, so both versions carry exactly the same mtime
  const t = Math.floor(Date.now() / 1000);
  writeFileSync(path, good.slice(0, -1) + " ");
  utimesSync(path, t, t);
  assert.equal((await r.refresh(input())).rows.length, 2);
  writeFileSync(path, good);
  utimesSync(path, t, t);
  assert.equal(statSync(path).mtimeMs, t * 1000);
  r.changed();
  assert.equal((await r.refresh(input())).rows.length, 3);
});

test("a recent row rewritten at the same size and mtime is seen by the next rescan", async () => {
  const r = new Refresher(() => dir);
  const path = join(dir, `${ids[0]}.json`);
  // Whole seconds, so both versions carry exactly the same mtime, as on a 1-2 s filesystem
  const t = Math.floor(Date.now() / 1000);
  writeFileSync(path, JSON.stringify(row(ids[0], { now: "aaa" })));
  utimesSync(path, t, t);
  await r.refresh(input());
  writeFileSync(path, JSON.stringify(row(ids[0], { now: "bbb" })));
  utimesSync(path, t, t);
  r.changed();
  assert.equal((await r.refresh(input())).rows.find((x) => x.id === ids[0])!.now, "bbb");
});

test("a file the watcher names is reread even at the same size and mtime", async () => {
  const r = new Refresher(() => dir);
  const name = `${ids[0]}.json`;
  const path = join(dir, name);
  const t = Math.floor(Date.now() / 1000);
  // Old enough that the rescan's recent-row reread would not cover it
  writeFileSync(path, JSON.stringify(row(ids[0], { now: "aaa", updatedAt: NOW - 3_600_000 })));
  utimesSync(path, t, t);
  await r.refresh(input());
  writeFileSync(path, JSON.stringify(row(ids[0], { now: "bbb", updatedAt: NOW - 3_600_000 })));
  utimesSync(path, t, t);
  r.changed(name);
  assert.equal((await r.refresh(input())).rows.find((x) => x.id === ids[0])!.now, "bbb");
});

test("fresh reads one session's row and close from disk before any watcher event, for the hand-close check", async () => {
  const r = new Refresher(() => dir);
  await r.refresh(input());
  put(`${ids[2]}.json`, row(ids[2], { updatedAt: NOW, reportedAt: NOW }));
  put(`${ids[2]}.close`, { by: ids[0], byPlan: "Plan 1", evidence: "merged", at: NOW, rowReportedAt: NOW });
  const f = await r.fresh(ids[2]);
  assert.equal(f.row?.reportedAt, NOW);
  assert.equal(f.close?.by, ids[0]);
});

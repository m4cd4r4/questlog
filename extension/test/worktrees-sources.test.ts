import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { questlogDir, configDir, defaultRegistryPath, readRegistry, readRows, type SourcesFs } from "../src/worktrees/sources.ts";
import { defaultScanPath } from "../src/worktrees/scan.ts";

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "questlog-wt-sources-"));
  dirs.push(d);
  return d;
};
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("Questlog's folder, the registry and the scan cache all sit under the Claude config folder: CLAUDE_CONFIG_DIR, else ~/.claude", () => {
  const set = { CLAUDE_CONFIG_DIR: join("/cfg", "claude") };
  assert.equal(configDir(set, "/home/me"), join("/cfg", "claude"));
  assert.equal(configDir({}, "/home/me"), join("/home/me", ".claude"));
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: "" }, "/home/me"), join("/home/me", ".claude"));
  assert.equal(questlogDir(set, "/home/me"), join("/cfg", "claude", "questlog"));
  assert.equal(questlogDir({}, "/home/me"), join("/home/me", ".claude", "questlog"));
  assert.equal(defaultRegistryPath(set, "/home/me"), join("/cfg", "claude", "workspaces", "registry.json"));
  assert.equal(defaultRegistryPath({}, "/home/me"), join("/home/me", ".claude", "workspaces", "registry.json"));
  // One folder rule: the scan cache is inside Questlog's folder, whichever way that was found.
  assert.equal(defaultScanPath(set, "/home/me"), join(questlogDir(set, "/home/me"), "worktrees", "scan.cache"));
  assert.equal(defaultScanPath({}, "/home/me"), join(questlogDir({}, "/home/me"), "worktrees", "scan.cache"));
});


// Session rows are named by their session's UUID; anything else in the folder is not a row.
const ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ID_C = "cccccccc-0000-4000-8000-000000000003";

test("readRows: every session row file of the folder; a half-written one, a non-row and a non-.json name are skipped; no folder gives none", async () => {
  const dir = temp();
  writeFileSync(join(dir, `${ID_A}.json`), JSON.stringify({ id: ID_A, updatedAt: 5, cwd: "/work/acme-app-feature-a" }));
  writeFileSync(join(dir, `${ID_B}.json`), JSON.stringify({ id: ID_B, updatedAt: 6, cwd: "/work/acme-app-feature-b" }));
  writeFileSync(join(dir, `${ID_C}.json`), JSON.stringify({ id: ID_C, updatedAt: 7, cwd: "/work/acme-app-feature-c" }));
  writeFileSync(join(dir, "half.json"), '{ "id": "half", "upda');
  writeFileSync(join(dir, "dismissed.json"), JSON.stringify({ a: 5 }));
  writeFileSync(join(dir, "not-a-uuid.json"), JSON.stringify({ id: "s1", updatedAt: 5 }));
  writeFileSync(join(dir, "live.cache"), JSON.stringify({ id: "cache", updatedAt: 1 }));
  mkdirSync(join(dir, "worktrees"));
  writeFileSync(join(dir, "worktrees", "scan.cache"), JSON.stringify({ id: "scan", updatedAt: 1 }));
  assert.deepEqual((await readRows(dir)).map((r) => r.id).sort(), [ID_A, ID_B, ID_C]);
  assert.deepEqual(await readRows(join(dir, "not-there")), []);
});

test("readRegistry: the entries of the file; none for a missing file, a damaged one, null, or one with no entries list", async () => {
  const dir = temp();
  const file = join(dir, "registry.json");
  assert.deepEqual(await readRegistry(file), []);
  writeFileSync(file, JSON.stringify({ entries: [{ slug: "a", repo_path: "/work/acme-app" }] }));
  assert.deepEqual(await readRegistry(file), [{ slug: "a", repo_path: "/work/acme-app" }]);
  for (const bad of [JSON.stringify({ entries: "nope" }), "{ half", "null"]) {
    writeFileSync(file, bad);
    assert.deepEqual(await readRegistry(file), []);
  }
});

test("the readers take their file calls from the fs passed in", async () => {
  const asked: string[] = [];
  const fs: SourcesFs = {
    readdir: async (p) => { asked.push(`dir ${p}`); return [`${ID_A}.json`, "notes.txt"]; },
    readFile: async (p) => { asked.push(`read ${p.replace(/\\/g, "/")}`); return JSON.stringify({ id: ID_A, updatedAt: 1, entries: [{ slug: "x" }] }); },
  };
  assert.deepEqual((await readRows("/config/questlog", fs)).map((r) => r.id), [ID_A]);
  assert.deepEqual(await readRegistry("/config/workspaces/registry.json", fs), [{ slug: "x" }]);
  assert.deepEqual(asked, ["dir /config/questlog", `read /config/questlog/${ID_A}.json`, "read /config/workspaces/registry.json"]);
});

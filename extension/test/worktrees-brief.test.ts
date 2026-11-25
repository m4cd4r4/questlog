import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BRIEF_MAX_AGE_MS, BRIEF_MAX_CHARS, briefLine } from "../src/worktrees/brief.ts";
import { main } from "../src/worktrees/cli.ts";
import { type ScanFile, type ScannedRepo, type ScannedWorktree } from "../src/worktrees/scan.ts";
import { scannedRepo as repo, scannedWt as wt } from "./worktrees-fixtures.ts";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";

const main_ = () => wt(MAIN, "main", { main: true });
const merged = (path: string, number: number, over: Parameters<typeof wt>[2] = {}) => wt(path, `fix/pr-${number}`, { pr: { state: "merged", number }, ...over });
const open = (path: string, number: number, over: Parameters<typeof wt>[2] = {}) => wt(path, `feat/pr-${number}`, { pr: { state: "open", number }, ...over });

const scanOf = (repos: ScannedRepo[], scannedAt = NOW - HOUR): ScanFile => ({ version: 1, scannedAt, repos });
const acme = (worktrees: ScannedWorktree[], over: Partial<ScannedRepo> = {}) => scanOf([repo(MAIN, [main_(), ...worktrees], over)]);

/** Three worktrees of one repo in one parent folder: A needs you and shares files with B, B is in flight, C is closable. */
const THREE = acme([
  wt(A, "feat/feature-a", { dirty: 2, changed: 2, pr: { state: "open", number: 12 }, overlaps: [{ path: B, count: 5, files: ["src/app.ts"] }] }),
  open(B, 13, { overlaps: [{ path: A, count: 5, files: ["src/app.ts"] }] }),
  merged(C, 9),
]);

test("three worktrees of one repo in one folder: each folder gets the line for its own worktree", () => {
  assert.equal(briefLine(THREE, A, NOW),
    "Worktrees: this worktree needs you (2 changed files); 1 of acme-app's 3 worktrees can be closed; shares 5 files with acme-app-feature-b");
  assert.equal(briefLine(THREE, B, NOW),
    "Worktrees: this worktree is in flight (PR #13 open); 1 of acme-app's 3 worktrees can be closed; shares 5 files with acme-app-feature-a");
  assert.equal(briefLine(THREE, C, NOW),
    "Worktrees: this worktree is closable (PR #9 merged, clean); 1 of acme-app's 3 worktrees can be closed");
});

test("the quiet case prints nothing: no closable worktree in the repo and no shared files", () => {
  const quiet = acme([wt(A, "feat/feature-a", { dirty: 1, changed: 1 }), open(B, 13, { overlaps: [] }), wt(C, "feat/feature-c")]);
  for (const folder of [MAIN, A, B, C]) assert.equal(briefLine(quiet, folder, NOW), "");
});

test("the main checkout has no verdict of its own: only the closable count, and nothing when that is zero", () => {
  assert.equal(briefLine(THREE, MAIN, NOW), "Worktrees: 1 of acme-app's 3 worktrees can be closed");
  assert.equal(briefLine(acme([merged(A, 7), merged(B, 8), open(C, 9)]), MAIN, NOW), "Worktrees: 2 of acme-app's 3 worktrees can be closed");
  assert.equal(briefLine(acme([open(A, 7)]), MAIN, NOW), "");
});

test("a subfolder of a worktree counts as that worktree; a worktree nested in the main checkout wins over the checkout", () => {
  assert.equal(briefLine(THREE, `${C}/extension/src`, NOW), briefLine(THREE, C, NOW));
  assert.equal(briefLine(THREE, `${MAIN}/docs`, NOW), briefLine(THREE, MAIN, NOW));
  const NESTED = `${MAIN}/.worktrees/fix-x`;
  const nested = acme([merged(NESTED, 4)]);
  assert.equal(briefLine(nested, `${NESTED}/src`, NOW), "Worktrees: this worktree is closable (PR #4 merged, clean); 1 of acme-app's 1 worktree can be closed");
});

test("mixed slashes and drive-letter case on the folder still find the worktree", () => {
  const scan = scanOf([repo("I:/work/acme-app", [wt("I:/work/acme-app", "main", { main: true }), merged("I:/work/acme-app-feature-c", 9)])]);
  const want = "Worktrees: this worktree is closable (PR #9 merged, clean); 1 of acme-app's 1 worktree can be closed";
  assert.equal(briefLine(scan, "i:\\work\\acme-app-feature-c\\src\\", NOW), want);
  assert.equal(briefLine(scan, "I:/work/acme-app-feature-c", NOW), want);
});

test("nothing for a folder in no scanned repo, with no cache, or in a repo that errored", () => {
  assert.equal(briefLine(THREE, "/work/other-thing", NOW), "");
  assert.equal(briefLine(THREE, "/work/acme-app-feature-cc", NOW), "");
  assert.equal(briefLine(undefined, C, NOW), "");
  assert.equal(briefLine(acme([merged(C, 9)], { error: "gh failed" }), C, NOW), "");
});

test("a cache past the age limit says nothing; one at the limit still does", () => {
  const at = (age: number) => briefLine({ ...THREE, scannedAt: NOW - age }, C, NOW);
  assert.equal(BRIEF_MAX_AGE_MS, 24 * HOUR);
  assert.notEqual(at(BRIEF_MAX_AGE_MS), "");
  assert.equal(at(BRIEF_MAX_AGE_MS + 60_000), "");
});

test("a worktree the scan did not read gets no verdict part; the closable count is still given", () => {
  const scan = acme([wt(A, "feat/feature-a", { unread: true }), merged(C, 9)], { timedOut: true });
  assert.equal(briefLine(scan, A, NOW), "Worktrees: 1 of acme-app's 2 worktrees can be closed");
  assert.equal(briefLine(acme([wt(A, "feat/feature-a", { unread: true })]), A, NOW), "");
});

test("a closable worktree with siblings that share files: the first sibling by name, and a count of the others", () => {
  const D = "/work/acme-app-feature-d";
  const scan = acme([
    merged(C, 9, { overlaps: [{ path: D, count: 1, files: ["x.ts"] }, { path: B, count: 2, files: ["x.ts", "y.ts"] }, { path: A, count: 3, files: ["x.ts"] }] }),
    open(A, 1), open(B, 2), open(D, 3),
  ]);
  assert.equal(briefLine(scan, C, NOW),
    "Worktrees: this worktree is closable (PR #9 merged, clean); 1 of acme-app's 4 worktrees can be closed; shares 3 files with acme-app-feature-a and 2 other worktrees");
  const one = acme([open(A, 1, { overlaps: [{ path: B, count: 1, files: ["x.ts"] }, { path: C, count: 1, files: ["x.ts"] }] }), open(B, 2), open(C, 3)]);
  assert.equal(briefLine(one, A, NOW), "Worktrees: this worktree is in flight (PR #1 open); shares 1 file with acme-app-feature-b and 1 other worktree");
});

test("an orphan is worth a line on its own", () => {
  const scan = acme([wt(A, "", { detached: true })]);
  assert.equal(briefLine(scan, A, NOW), "Worktrees: this worktree is an orphan (detached HEAD, clean)");
});

test("never more than one line, never over the length limit", () => {
  const LONG = `/work/${"very-long-folder-name-".repeat(8)}a`;
  const scan = acme([
    wt(LONG, "feat/long", { locked: true, lockedReason: "first line\nsecond line\r\nthird", overlaps: [{ path: `/work/${"sibling-".repeat(30)}b`, count: 2, files: ["x.ts"] }] }),
    merged(C, 9),
  ]);
  const line = briefLine(scan, LONG, NOW);
  assert.equal(line.startsWith("Worktrees: this worktree is busy (locked: first line second line third)"), true);
  assert.equal(/[\r\n]/.test(line), false);
  assert.equal(line.length <= BRIEF_MAX_CHARS, true);
  assert.equal(BRIEF_MAX_CHARS, 200);
});

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "questlog-wt-brief-"));
  dirs.push(d);
  return d;
};
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const cli = async (args: string[], cwd?: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    out: (t) => out.push(t), err: (t) => err.push(t), now: () => NOW, env: { CLAUDE_CONFIG_DIR: join(temp(), "config") }, home: temp(),
    run: async () => { throw new Error("no run in this test"); }, listServers: async () => undefined, ...(cwd === undefined ? {} : { cwd }),
  });
  return { code, out, err };
};

test("questlog-wt brief: prints the line for the folder given, or for the current folder; exit 0 whatever happens", async () => {
  const cache = join(temp(), "worktrees", "scan.cache");
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify(THREE));
  const want = "Worktrees: this worktree is closable (PR #9 merged, clean); 1 of acme-app's 3 worktrees can be closed";

  assert.deepEqual(await cli(["brief", C, "--cache", cache]), { code: 0, out: [want], err: [] });
  assert.deepEqual(await cli(["brief", "--cache", cache], `${C}/src`), { code: 0, out: [want], err: [] });
  assert.deepEqual(await cli(["brief", C, "--cache", cache, "--json"]), { code: 0, out: [JSON.stringify({ line: want })], err: [] });

  // Nothing to say, no cache, a folder in no repo, a wrong command line: silent on stdout, still 0.
  assert.deepEqual(await cli(["brief", "/work/other-thing", "--cache", cache]), { code: 0, out: [], err: [] });
  assert.deepEqual(await cli(["brief", C, "--cache", join(temp(), "none.cache")]), { code: 0, out: [], err: [] });
  assert.deepEqual(await cli(["brief", "--cache", join(temp(), "none.cache"), "--json"], C), { code: 0, out: [JSON.stringify({ line: "" })], err: [] });
  const extra = await cli(["brief", A, C, "--cache", cache]);
  assert.deepEqual([extra.code, extra.out], [0, []]);
  const badFlag = await cli(["brief", C, "--no-such-flag"]);
  assert.deepEqual([badFlag.code, badFlag.out], [0, []]);
});

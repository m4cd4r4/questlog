import { test } from "node:test";
import assert from "node:assert/strict";
import { folderOfPid, markServers, parseLsofCwd, parseLsofListen, parseNetstat, parseProcessTable, type Proc } from "../src/worktrees/servers.ts";
import { portpilotListeners } from "../src/worktrees/portpilot.ts";
import { verdictOf, type Facts } from "../src/worktrees/verdict.ts";

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";
const HEAD = "2222222222222222222222222222222222222222";

/** A clean, pushed worktree on a branch with commits of its own and an open pull request. */
const facts = (over: Partial<Facts> = {}): Facts => ({
  path: A, branch: "feat/feature-a", head: HEAD, main: false,
  detached: false, locked: false, lockedReason: "", bare: false, prunable: false, prunableReason: "",
  dirty: 0, unpushed: 0, stashes: 0, ownCommits: 2, pr: { state: "open", number: 7 },
  ...over,
});
const main = (path = MAIN) => facts({ path, branch: "main", main: true, pr: { state: "none" } });
const byPath = (list: Facts[], path: string) => list.find((w) => w.path === path)!;

test("three worktrees of one repo in one folder: only the one a server runs in is marked, with its port", () => {
  const wts = [main(), facts({ path: A }), facts({ path: B }), facts({ path: C })];
  const out = markServers(wts, [{ port: 3000, folder: `${B}/apps/web` }]);
  assert.deepEqual(out.map((w) => w.server), [undefined, undefined, { port: 3000 }, undefined]);
  assert.deepEqual(verdictOf(byPath(out, B)), { verdict: "busy", reason: "dev server on port 3000", closeOffered: false, safeForBulk: false });
  assert.equal(verdictOf(byPath(out, A))?.verdict, "in-flight");
  assert.equal("server" in byPath(out, A), false);
  // the input is left as it was
  assert.equal(wts[2].server, undefined);
});

test("a server in the main checkout marks no worktree, and the main checkout gets no server field", () => {
  const wts = [main(), facts({ path: A }), facts({ path: B })];
  const out = markServers(wts, [{ port: 3000, folder: MAIN }, { port: 3001, folder: `${MAIN}/packages/site` }]);
  assert.deepEqual(out.map((w) => "server" in w), [false, false, false]);
});

test("no lister available: every entered worktree reads unknown and no verdict changes", () => {
  const gone = facts({ path: C, prunable: true });
  const wts = [main(), facts({ path: A }), facts({ path: B, dirty: 2, changed: 2 }), gone];
  const out = markServers(wts, undefined);
  assert.deepEqual(out.map((w) => w.server), [undefined, "unknown", "unknown", undefined]);
  assert.deepEqual(out.map((w) => verdictOf(w)), wts.map((w) => verdictOf(w)));
});

test("a worktree nested inside the main checkout gets its own server; the main checkout's stays the main checkout's", () => {
  const nested = `${MAIN}/.claude/worktrees/feature-a`;
  const wts = [main(), facts({ path: nested }), facts({ path: B })];
  const out = markServers(wts, [{ port: 5173, folder: nested }, { port: 3000, folder: `${MAIN}/src` }]);
  assert.deepEqual(byPath(out, nested).server, { port: 5173 });
  assert.equal(byPath(out, B).server, undefined);
});

test("a worktree that owns several listeners shows the lowest port; spelling of the folder does not matter", () => {
  const wts = [main("I:/work/acme-app"), facts({ path: "I:/work/acme-app-feature-a" })];
  const out = markServers(wts, [{ port: 9229, folder: "i:\\work\\acme-app-feature-a" }, { port: 3000, folder: "I:/work/acme-app-feature-a/" }]);
  assert.deepEqual(out[1].server, { port: 3000 });
});

test("a listener in a folder with a longer name than a worktree's is not that worktree's", () => {
  const out = markServers([main(), facts({ path: A })], [{ port: 3000, folder: `${A}-old` }]);
  assert.equal(out[1].server, undefined);
});

// Captured from `netstat -ano -p TCP` and `-p TCPv6` on Windows 11; the addresses are any-address and loopback.
const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1320",
  "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       53716",
  "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       61196",
  "  TCP    127.0.0.1:49710        127.0.0.1:49711        ESTABLISHED     6248",
  "  TCP    [::]:135               [::]:0                 LISTENING       1320",
  "  TCP    [::]:3000              [::]:0                 LISTENING       53716",
  "  TCP    [::1]:4321             [::]:0                 LISTENING       7004",
  "",
].join("\r\n");

test("parseNetstat keeps listening rows, IPv4 and IPv6, each port and pid once", () => {
  assert.deepEqual(parseNetstat(NETSTAT), [
    { port: 135, pid: 1320 },
    { port: 3000, pid: 53716 },
    { port: 5173, pid: 61196 },
    { port: 4321, pid: 7004 },
  ]);
  assert.deepEqual(parseNetstat(""), []);
  assert.deepEqual(parseNetstat("not the table"), []);
});

test("parseLsofListen and parseLsofCwd read lsof's field output", () => {
  assert.deepEqual(parseLsofListen("p812\nn*:3000\nn[::1]:3000\np901\nn127.0.0.1:5173\n"), [
    { port: 3000, pid: 812 },
    { port: 5173, pid: 901 },
  ]);
  assert.equal(parseLsofCwd("p812\nfcwd\nn/work/acme-app-feature-a\n"), "/work/acme-app-feature-a");
  assert.equal(parseLsofCwd(""), undefined);
});

test("parseProcessTable reads the JSON list, a single object too, and gives nothing for anything else", () => {
  const text = JSON.stringify([{ ProcessId: 10, ParentProcessId: 4, CommandLine: "node a.js" }, { ProcessId: 4, ParentProcessId: 0, CommandLine: null }, { ProcessId: "x" }]);
  assert.deepEqual(parseProcessTable(text), [{ pid: 10, ppid: 4, commandLine: "node a.js" }, { pid: 4, ppid: 0, commandLine: "" }]);
  assert.deepEqual(parseProcessTable(JSON.stringify({ ProcessId: 10, ParentProcessId: 4, CommandLine: "x" })), [{ pid: 10, ppid: 4, commandLine: "x" }]);
  assert.deepEqual(parseProcessTable("oops"), []);
});

const WMAIN = "I:/work/acme-app";
const WA = "I:/work/acme-app-feature-a";
const WB = "I:/work/acme-app-feature-b";
const KNOWN = [WMAIN, WA, WB];

test("folderOfPid: the first path in the command line that sits in a known folder names it, whatever its slashes or case", () => {
  const procs: Proc[] = [{ pid: 10, ppid: 1, commandLine: '"C:\\Program Files\\nodejs\\node.exe" i:\\work\\acme-app-feature-b\\scripts\\serve.mjs --port 3000' }];
  assert.equal(folderOfPid(10, procs, KNOWN), WB);
  assert.equal(folderOfPid(99, procs, KNOWN), undefined);
});

test("folderOfPid: a path outside node_modules anywhere in the chain wins over a node_modules path in the process itself", () => {
  // through a junctioned node_modules the child's path names the main checkout; the parent names the worktree
  const procs: Proc[] = [
    { pid: 30, ppid: 20, commandLine: `node ${WMAIN}/node_modules/next/dist/bin/next dev` },
    { pid: 20, ppid: 10, commandLine: "cmd.exe /d /s /c next dev" },
    { pid: 10, ppid: 1, commandLine: `"C:\\Program Files\\nodejs\\node.exe" "${WA}/tools/run dev.mjs"` },
  ];
  assert.equal(folderOfPid(30, procs, KNOWN), WA);
});

test("folderOfPid: when the whole chain names only node_modules paths, the first one names the folder", () => {
  const vite: Proc[] = [
    { pid: 30, ppid: 20, commandLine: `"node"   "I:\\work\\acme-app-feature-a\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js" --port 3304 --strictPort --host` },
    { pid: 20, ppid: 10, commandLine: "C:\\WINDOWS\\system32\\cmd.exe /d /s /c vite --port 3304 --strictPort --host" },
    { pid: 10, ppid: 1, commandLine: '"C:\\Program Files\\nodejs\\\\node.exe"  "C:\\Program Files\\nodejs\\\\node_modules\\npm\\bin\\npx-cli.js" vite --port 3304' },
  ];
  assert.equal(folderOfPid(30, vite, KNOWN), WA);
  assert.equal(folderOfPid(1, [{ pid: 1, ppid: 0, commandLine: `node ${WB}/node_modules/vite/bin/vite.js` }], KNOWN), WB);
  // the process's own node_modules path comes before a parent's
  const two: Proc[] = [
    { pid: 2, ppid: 1, commandLine: `node ${WB}/node_modules/vite/bin/vite.js` },
    { pid: 1, ppid: 0, commandLine: `node ${WA}/node_modules/npm/bin/npx-cli.js vite` },
  ];
  assert.equal(folderOfPid(2, two, KNOWN), WB);
  // and a chain that names no known folder at all still maps to nothing
  assert.equal(folderOfPid(20, vite, KNOWN), undefined);
});

test("folderOfPid: a folder whose name only starts like a known one is not it, and the longest known folder wins", () => {
  const nested = `${WMAIN}/.claude/worktrees/feature-c`;
  assert.equal(folderOfPid(1, [{ pid: 1, ppid: 0, commandLine: `node ${WA}-old/serve.js` }], KNOWN), undefined);
  assert.equal(folderOfPid(1, [{ pid: 1, ppid: 0, commandLine: `node ${nested}/serve.js` }], [...KNOWN, nested]), nested);
  assert.equal(folderOfPid(1, [{ pid: 1, ppid: 0, commandLine: `node "${WA}"` }], KNOWN), WA);
});

test("folderOfPid stops on a parent loop and after eight levels", () => {
  const loop: Proc[] = [{ pid: 1, ppid: 2, commandLine: "a" }, { pid: 2, ppid: 1, commandLine: "b" }];
  assert.equal(folderOfPid(1, loop, KNOWN), undefined);
  // a chain of ten: the path sits on the tenth, too far up to count
  const chain: Proc[] = Array.from({ length: 10 }, (_, i) => ({ pid: i + 1, ppid: i + 2, commandLine: i === 9 ? `node ${WA}/x.js` : "sh" }));
  assert.equal(folderOfPid(1, chain, KNOWN), undefined);
  assert.equal(folderOfPid(3, chain, KNOWN), WA);
});

const DIR = "C:/Users/someone/AppData/Roaming/portpilot";
const reader = (files: Record<string, string>) => (path: string) => {
  const key = Object.keys(files).find((k) => path.replace(/\\/g, "/").endsWith(k));
  if (key === undefined) throw new Error("ENOENT");
  return files[key];
};
const CONFIG = JSON.stringify({ apps: [
  { id: "app_1", name: "site", cwd: WMAIN },
  { id: "app_2", name: "feature a", cwd: WMAIN, worktreePath: WA },
  { id: "app_3", name: "feature b", cwd: WB },
  { id: "app_4", name: "no folder" },
] });

test("PortPilot: an app is running when it has not crashed, its port is a number and the OS says that port is listened on", async () => {
  const runtime = JSON.stringify({ apps: {
    app_1: { pid: null, port: 3000 },         // PortPilot writes a null pid for a running app: still running
    app_2: { pid: 200, port: 3001 },
    app_3: { pid: 300, port: 3002 },          // nothing listens on 3002: not running
    app_4: { pid: 400, port: 3003 },          // no folder in the config
    app_5: { pid: null, port: null },         // never got a port
    app_6: { crashed: { exitCode: 1, port: 3000 } },
  } });
  const read = reader({ "portpilot-runtime.json": runtime, "portpilot-config.json": CONFIG });
  assert.deepEqual(await portpilotListeners(DIR, read, new Set([3000, 3001, 3003])), [
    { port: 3000, folder: WMAIN },
    { port: 3001, folder: WA },
  ]);
});

test("PortPilot: a crashed entry is not running even with a listening port of its own", async () => {
  const runtime = JSON.stringify({ apps: { app_3: { pid: null, port: 3002, crashed: { exitCode: 1, at: 1, port: 3002 } } } });
  const read = reader({ "portpilot-runtime.json": runtime, "portpilot-config.json": CONFIG });
  assert.deepEqual(await portpilotListeners(DIR, read, new Set([3002])), []);
});

test("PortPilot: missing or damaged files give nothing and do not throw", async () => {
  const ports = new Set([3000]);
  assert.deepEqual(await portpilotListeners(DIR, reader({}), ports), []);
  assert.deepEqual(await portpilotListeners(DIR, reader({ "portpilot-runtime.json": "{oops", "portpilot-config.json": CONFIG }), ports), []);
  assert.deepEqual(await portpilotListeners(DIR, reader({ "portpilot-runtime.json": JSON.stringify({ apps: { app_1: { pid: 1, port: 3000 } } }), "portpilot-config.json": "[]" }), ports), []);
  assert.deepEqual(await portpilotListeners(DIR, reader({ "portpilot-runtime.json": "null", "portpilot-config.json": "null" }), ports), []);
});

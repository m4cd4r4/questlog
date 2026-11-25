import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepos, writeScan, readScan, scanReader, defaultScanPath, type ScanFile, type ScanReadFs } from "../src/worktrees/scan.ts";
import { repoList } from "../src/worktrees/repos.ts";
import { DIFF_BASE, DIFF_HEAD, fakeRun as fake, fakeSizeFs, good, bad, porcelain, repoTable as repo, SHA, type Table, type Wt } from "./worktrees-fixtures.ts";

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";
const OTHER = "/work/beta-site";
const OTHER_A = "/work/beta-site-fix-a";

const ACME: Wt[] = [
  { path: MAIN, branch: "main" },
  { path: A, branch: "feat/feature-a" },
  { path: B, branch: "feat/feature-b" },
  { path: C, branch: "fix/feature-c" },
];
const BETA: Wt[] = [
  { path: OTHER, branch: "main" },
  { path: OTHER_A, branch: "fix/a" },
];

test("a repo named by its main checkout and by two of its worktrees is one entry, read once", async () => {
  const { run, calls } = fake(repo(ACME));
  const scan = await scanRepos([A, MAIN, B], run, { now: () => 1000 });
  assert.equal(scan.repos.length, 1);
  assert.equal(scan.repos[0].path, MAIN);
  assert.deepEqual(scan.repos[0].worktrees.map((w) => w.path), [MAIN, A, B, C]);
  assert.equal(calls.filter((c) => c.cmd === "gh").length, 1);
  assert.equal(calls.filter((c) => c.args[0] === "status" && c.cwd === A).length, 1);
});

test("each linked worktree carries its verdict; the main checkout carries none", async () => {
  const { run } = fake(repo(ACME, [{ number: 7, state: "OPEN", headRefName: "feat/feature-a", headRefOid: SHA(1), updatedAt: "2026-01-02T00:00:00Z", isCrossRepository: false }]));
  const scan = await scanRepos([MAIN], run, { now: () => 1000 });
  const [main, a, b] = scan.repos[0].worktrees;
  assert.equal(main.verdict, undefined);
  assert.equal(a.verdict?.verdict, "in-flight");
  assert.equal(a.verdict?.reason, "PR #7 open");
  assert.equal(b.verdict?.verdict, "in-flight");
  assert.equal(scan.repos[0].defaultBranch, "main");
  assert.equal(scan.version, 1);
  assert.equal(scan.scannedAt, 1000);
});

test("the same repo reached with other slashes or drive-letter case is still one entry", async () => {
  const wts: Wt[] = [{ path: "C:/work/acme-app", branch: "main" }, { path: "C:/work/acme-app-feature-a", branch: "feat/feature-a" }];
  const table = repo(wts);
  // the second folder spells the same checkout differently and git answers with a lower-case drive
  table["c:\\work\\acme-app-feature-a|git worktree list --porcelain"] = good(porcelain([{ path: "c:/work/acme-app", branch: "main" }, wts[1]]));
  const { run } = fake(table);
  const scan = await scanRepos(["C:/work/acme-app", "c:\\work\\acme-app-feature-a"], run);
  assert.equal(scan.repos.length, 1);
});

test("a repo that throws keeps its place with an error and does not lose the others", async () => {
  const { run } = fake({ ...repo(ACME), ...repo(BETA) }, (c) => {
    if (c.cmd === "gh" && c.cwd === MAIN) throw new Error("spawn failed");
  });
  const scan = await scanRepos([MAIN, OTHER], run);
  assert.equal(scan.repos.length, 2);
  const acme = scan.repos.find((r) => r.path === MAIN)!;
  const beta = scan.repos.find((r) => r.path === OTHER)!;
  assert.equal(acme.error, "spawn failed");
  assert.deepEqual(acme.worktrees, []);
  assert.equal(beta.error, undefined);
  assert.deepEqual(beta.worktrees.map((w) => w.path), [OTHER, OTHER_A]);
});

test("a folder git cannot list is kept with the reason, and one that throws on listing too", async () => {
  const { run } = fake({ ...repo(BETA), "/work/not-a-repo|git worktree list --porcelain": bad(128, "fatal: not a git repository\nmore") }, (c) => {
    if (c.cwd === "/work/broken") throw new Error("no such folder");
  });
  const scan = await scanRepos(["/work/not-a-repo", "/work/broken", OTHER], run);
  assert.equal(scan.repos.length, 3);
  assert.equal(scan.repos.find((r) => r.path === "/work/not-a-repo")?.error, "fatal: not a git repository");
  assert.equal(scan.repos.find((r) => r.path === "/work/broken")?.error, "no such folder");
  assert.equal(scan.repos.find((r) => r.path === OTHER)?.worktrees.length, 2);
});

test("a repo that runs out of time keeps what it gathered and is marked timedOut", async () => {
  let clock = 0;
  // every status call takes 15 seconds of the 20 the repo has
  const { run, calls } = fake(repo(ACME), (c) => {
    if (c.args[0] === "status") clock += 15_000;
  });
  const scan = await scanRepos([MAIN], run, { perRepoMs: 20_000, worktreeParallel: 1, now: () => clock });
  const r = scan.repos[0];
  assert.equal(r.timedOut, true);
  assert.equal(r.tookMs, 30_000);
  const [, a, b, c] = r.worktrees;
  assert.equal(a.unpushed, 0);
  assert.equal(b.unpushed, 0);
  assert.equal(a.verdict?.verdict, "in-flight");
  assert.equal(a.verdict?.reason, "pushed, no PR yet");
  // the third was never reached: marked unread, in flight with its own reason, and its folder was never entered
  assert.equal(c.unread, true);
  assert.equal(c.unpushed, "unknown");
  assert.equal(c.verdict?.reason, "not read yet");
  assert.equal(c.verdict?.verdict, "in-flight");
  assert.equal(c.verdict?.closeOffered, false);
  assert.equal(calls.filter((x) => x.cwd === C && x.args[0] !== "worktree").length, 0);
});

test("a repo inside its time limit is not marked timedOut", async () => {
  const { run } = fake(repo(BETA));
  const scan = await scanRepos([OTHER], run, { now: () => 5 });
  assert.equal(scan.repos[0].timedOut, undefined);
  assert.equal("timedOut" in scan.repos[0], false);
});

test("never more repos at once than the limit", async () => {
  const names = ["one", "two", "three", "four", "five", "six"];
  let table: Table = {};
  for (const n of names) table = { ...table, ...repo([{ path: `/work/${n}`, branch: "main" }, { path: `/work/${n}-a`, branch: "feat/a" }]) };
  let active = 0;
  let most = 0;
  const { run } = fake(table, async () => {
    active++;
    most = Math.max(most, active);
    await new Promise((r) => setImmediate(r));
    active--;
  });
  const scan = await scanRepos(names.map((n) => `/work/${n}`), run, { parallel: 2 });
  assert.equal(scan.repos.length, 6);
  assert.deepEqual(scan.repos.map((r) => r.path), names.map((n) => `/work/${n}`));
  assert.equal(most, 2);
});

test("no folders gives an empty scan", async () => {
  const { run, calls } = fake({});
  const scan = await scanRepos([], run, { now: () => 9 });
  assert.deepEqual(scan, { version: 1, scannedAt: 9, repos: [] });
  assert.equal(calls.length, 0);
});

test("repoList: each folder once whatever its slashes or case, junk dropped, first spelling and order kept", () => {
  assert.deepEqual(
    repoList({
      sessionCwds: ["C:/work/acme-app", "", "c:\\work\\acme-app\\", undefined, 7, "/work/beta-site"],
      registryRepoPaths: ["/work/beta-site/", null, "  ", "/work/gamma", "C:/WORK/acme-app"],
    }),
    ["C:/work/acme-app", "/work/beta-site", "/work/gamma"],
  );
  assert.deepEqual(repoList({}), []);
});

const sample = (): ScanFile => ({
  version: 1,
  scannedAt: 1767225600000,
  repos: [{
    path: MAIN, defaultBranch: "main", tookMs: 12,
    worktrees: [{
      path: A, branch: "feat/feature-a", head: SHA(2), main: false, detached: false, locked: false, lockedReason: "", bare: false,
      prunable: false, prunableReason: "", dirty: 0, unpushed: 0, stashes: 0, ownCommits: 2, pr: { state: "merged", number: 12 },
      verdict: { verdict: "closable", reason: "PR #12 merged, clean", closeOffered: true, safeForBulk: true },
    }],
  }],
});

test("writeScan then readScan round-trips under the OS temp folder, with no id or updatedAt and no temp file left", async () => {
  const dir = mkdtempSync(join(tmpdir(), "questlog-scan-"));
  try {
    const file = join(dir, "questlog", "worktrees", "scan.cache");
    await writeScan(file, sample());
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal("id" in parsed, false);
    assert.equal("updatedAt" in parsed, false);
    assert.deepEqual(await readScan(file), sample());
    await writeScan(file, { ...sample(), scannedAt: 2 });
    assert.equal((await readScan(file))?.scannedAt, 2);
    assert.deepEqual(readdirSync(join(dir, "questlog", "worktrees")), ["scan.cache"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readScan gives undefined for a missing, damaged or other-version file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "questlog-scan-"));
  try {
    assert.equal(await readScan(join(dir, "none.cache")), undefined);
    const file = join(dir, "scan.cache");
    writeFileSync(file, "{ not json");
    assert.equal(await readScan(file), undefined);
    writeFileSync(file, JSON.stringify({ ...sample(), version: 2 }));
    assert.equal(await readScan(file), undefined);
    writeFileSync(file, JSON.stringify({ version: 1, scannedAt: 1 }));
    assert.equal(await readScan(file), undefined);
    writeFileSync(file, "null");
    assert.equal(await readScan(file), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeScan writes a temp file beside the target, then renames it", async () => {
  const steps: string[] = [];
  await writeScan("/cfg/questlog/worktrees/scan.cache", sample(), {
    mkdir: async (p) => steps.push(`mkdir ${String(p).replace(/\\/g, "/")}`),
    writeFile: async (p) => steps.push(`write ${String(p).replace(/\\/g, "/").replace(/\.\d+\.\d+\.tmp$/, ".tmp")}`),
    rename: async (from, to) => steps.push(`rename ${String(from).replace(/\\/g, "/").replace(/\.\d+\.\d+\.tmp$/, ".tmp")} ${String(to).replace(/\\/g, "/")}`),
    readFile: async () => "",
  });
  assert.deepEqual(steps, [
    "mkdir /cfg/questlog/worktrees",
    "write /cfg/questlog/worktrees/scan.cache.tmp",
    "rename /cfg/questlog/worktrees/scan.cache.tmp /cfg/questlog/worktrees/scan.cache",
  ]);
});

test("defaultScanPath is in Questlog's folder: CLAUDE_CONFIG_DIR when set, else .claude under home", () => {
  const flat = (p: string) => p.replace(/\\/g, "/");
  assert.equal(flat(defaultScanPath({ CLAUDE_CONFIG_DIR: "/sandbox/cfg" }, "/home/sam")), "/sandbox/cfg/questlog/worktrees/scan.cache");
  assert.equal(flat(defaultScanPath({}, "/home/sam")), "/home/sam/.claude/questlog/worktrees/scan.cache");
  assert.equal(flat(defaultScanPath({ CLAUDE_CONFIG_DIR: "" }, "/home/sam")), "/home/sam/.claude/questlog/worktrees/scan.cache");
  assert.equal(defaultScanPath({}, "/home/sam").endsWith(".json"), false);
});

test("listServers is asked once per scan with every known folder; the worktree a server runs in reads busy with its port", async () => {
  const { run } = fake({ ...repo(ACME), ...repo(BETA) });
  const asked: string[][] = [];
  const scan = await scanRepos([MAIN, OTHER], run, {
    listServers: async (known) => {
      asked.push([...known]);
      return [{ port: 3000, folder: `${B}/apps/web` }, { port: 4000, folder: OTHER }];
    },
  });
  assert.equal(asked.length, 1);
  assert.deepEqual([...asked[0]].sort(), [MAIN, A, B, C, OTHER, OTHER_A].sort());
  const acme = scan.repos.find((r) => r.path === MAIN)!;
  const b = acme.worktrees.find((w) => w.path === B)!;
  assert.deepEqual(b.server, { port: 3000 });
  assert.deepEqual(b.verdict, { verdict: "busy", reason: "dev server on port 3000", closeOffered: false, safeForBulk: false });
  assert.equal("server" in acme.worktrees.find((w) => w.path === A)!, false);
  // a server in a main checkout marks nothing
  assert.deepEqual(scan.repos.find((r) => r.path === OTHER)!.worktrees.map((w) => "server" in w), [false, false]);
});

test("registry: each worktree the registry knows carries its brief flag, never the text, and no verdict changes", async () => {
  const TEXT = "the whole brief, word for word";
  const plain = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000 });
  assert.equal(plain.repos[0].worktrees.some((w) => "brief" in w), false);

  const entries = [
    { slug: "a", worktree_path: A, brief_local_path: "/work/briefs/a.md", brief_full_text: TEXT },
    { slug: "b", worktree_path: "\\work\\acme-app-feature-b\\", brief_local_path: "/work/briefs/b.md" },
    { slug: "main", worktree_path: MAIN, brief_local_path: "/work/briefs/main.md" },
  ];
  const scan = await scanRepos([MAIN], fake(repo(ACME)).run, {
    now: () => 1000,
    registry: { entries, exists: (p) => { if (p.endsWith("a.md")) throw new Error("disk gone"); return p === "/work/briefs/b.md"; } },
  });
  const wts = scan.repos[0].worktrees;
  assert.deepEqual(wts.map((w) => w.brief), [undefined, "recoverable", "present", undefined]);
  assert.deepEqual(wts.map((w) => "brief" in w), [false, true, true, false]);
  assert.deepEqual(wts.map((w) => w.verdict), plain.repos[0].worktrees.map((w) => w.verdict));
  assert.equal(JSON.stringify(scan).includes(TEXT), false);
});

test("a listServers that never answers is given up on after listServersMs: the scan returns, servers read unknown, verdicts stay", async () => {
  const plain = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000 });
  const never = () => new Promise<undefined>(() => {});
  const scan = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000, listServers: never, listServersMs: 20 });
  assert.deepEqual(scan.repos[0].worktrees.map((w) => w.server), [undefined, "unknown", "unknown", "unknown"]);
  assert.deepEqual(scan.repos[0].worktrees.map((w) => w.verdict), plain.repos[0].worktrees.map((w) => w.verdict));
});

test("a listServers that answers in time is used, and its time limit is cleared", async (t) => {
  const cleared: unknown[] = [];
  const realClear = globalThis.clearTimeout;
  t.mock.method(globalThis, "clearTimeout", (id: Parameters<typeof clearTimeout>[0]) => { cleared.push(id); realClear(id); });
  const scan = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000, listServers: async () => [{ port: 5173, folder: A }], listServersMs: 60_000 });
  assert.deepEqual(scan.repos[0].worktrees.map((w) => w.server), [undefined, { port: 5173 }, undefined, undefined]);
  assert.equal(cleared.filter((id) => id !== undefined).length >= 1, true);
});

test("a listServers that throws, or gives something that is not a list, reads unknown and leaves every verdict alone", async () => {
  const plain = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000 });
  assert.equal(plain.repos[0].worktrees.some((w) => "server" in w), false);

  for (const listServers of [async () => { throw new Error("no port table"); }, async () => undefined, async () => "oops" as never]) {
    const scan = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000, listServers });
    assert.deepEqual(scan.repos[0].worktrees.map((w) => w.server), [undefined, "unknown", "unknown", "unknown"]);
    assert.deepEqual(scan.repos[0].worktrees.map((w) => w.verdict), plain.repos[0].worktrees.map((w) => w.verdict));
  }
});

test("overlap: needs you, in flight and busy worktrees name the files they share; a closable one and one whose diff failed carry no field; no verdict changes", async () => {
  const D = "/work/acme-app-feature-d";
  const E = "/work/acme-app-feature-e";
  const F = "/work/acme-app-feature-f";
  const wts: Wt[] = [...ACME, { path: D, branch: "feat/feature-d" }, { path: E, branch: "feat/feature-e" }, { path: F, branch: "feat/feature-f" }];
  const merged = (number: number, headRefName: string) => ({ number, state: "MERGED", headRefName, headRefOid: SHA(1), updatedAt: "2026-01-02T00:00:00Z", isCrossRepository: false });
  const table = (): Table => {
    const t = repo(wts, [merged(8, "feat/feature-d"), merged(9, "feat/feature-f")]);
    // C is locked, so busy.
    t[`${MAIN}|git worktree list --porcelain`] = good(porcelain(wts).replace("branch refs/heads/fix/feature-c", "branch refs/heads/fix/feature-c\nlocked"));
    // F's pull request is merged and it is clean: closable, so it is never diffed, though it touched the same file.
    t[`${F}|${DIFF_BASE}`] = good("src/app.ts\n");
    t[`${F}|${DIFF_HEAD}`] = good("");
    // D's pull request is merged and it has local changes to the same file: needs you, so it is compared.
    t[`${D}|git status --porcelain`] = good(" M src/app.ts\n");
    t[`${A}|${DIFF_BASE}`] = good("src/app.ts\nsrc/a.ts\n");
    t[`${A}|${DIFF_HEAD}`] = good("");
    t[`${B}|${DIFF_BASE}`] = good("src/app.ts\n");
    t[`${B}|${DIFF_HEAD}`] = good("src/shared.ts\n");
    t[`${C}|${DIFF_BASE}`] = good("src/shared.ts\n");
    t[`${C}|${DIFF_HEAD}`] = good("");
    t[`${D}|${DIFF_BASE}`] = good("src/app.ts\n");
    t[`${D}|${DIFF_HEAD}`] = good("src/app.ts\n");
    // E's diff cannot be read: no entry, so it fails.
    return t;
  };

  const plain = await scanRepos([MAIN], fake(table()).run, { now: () => 1000 });
  assert.equal(plain.repos[0].worktrees.some((w) => "overlaps" in w), false);

  const { run, calls } = fake(table());
  const scan = await scanRepos([MAIN], run, { now: () => 1000, overlap: true });
  const wt = (p: string) => scan.repos[0].worktrees.find((w) => w.path === p)!;
  assert.deepEqual(scan.repos[0].worktrees.map((w) => w.verdict?.verdict), [undefined, "in-flight", "in-flight", "busy", "needs-you", "in-flight", "closable"]);
  const app = (path: string) => ({ path, count: 1, files: ["src/app.ts"] });
  assert.deepEqual(wt(A).overlaps, [app(B), app(D)]);
  assert.deepEqual(wt(B).overlaps, [app(A), { path: C, count: 1, files: ["src/shared.ts"] }, app(D)]);
  assert.deepEqual(wt(C).overlaps, [{ path: B, count: 1, files: ["src/shared.ts"] }]);
  assert.deepEqual(wt(D).overlaps, [app(A), app(B)]);
  assert.deepEqual(scan.repos[0].worktrees.map((w) => "overlaps" in w), [false, true, true, true, true, false, false]);
  assert.equal(calls.some((c) => c.cwd === D && c.args[0] === "diff"), true);
  assert.equal(calls.some((c) => c.cwd === F && c.args[0] === "diff"), false);
  assert.deepEqual(scan.repos[0].worktrees.map((w) => w.verdict), plain.repos[0].worktrees.map((w) => w.verdict));
  assert.equal(JSON.stringify(scan).includes("changedFiles"), false);
  assert.equal(JSON.stringify(scan).includes("src/a.ts"), false);

  // With servers: A is busy over in flight and still compared. F is busy over closable: its files were
  // decided before the servers were known, so it was never diffed and carries no field.
  const served = fake(table());
  const withServers = await scanRepos([MAIN], served.run, {
    now: () => 1000, overlap: true, listServers: async () => [{ port: 5173, folder: A }, { port: 5174, folder: F }],
  });
  const sv = (p: string) => withServers.repos[0].worktrees.find((w) => w.path === p)!;
  assert.deepEqual([sv(A).verdict?.verdict, sv(F).verdict?.verdict], ["busy", "busy"]);
  assert.deepEqual(sv(A).overlaps, [app(B), app(D)]);
  assert.equal("overlaps" in sv(F), false);
  assert.equal(served.calls.some((c) => c.cwd === F && c.args[0] === "diff"), false);
});

test("size: each worktree carries its bytes, the main checkout none, and no verdict changes", async () => {
  const plain = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000 });
  assert.equal(plain.repos[0].worktrees.some((w) => "size" in w), false);

  const { fs } = fakeSizeFs({ [MAIN]: 9, [A]: 10, [B]: 200 });
  const scan = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000, size: { fs } });
  const wts = scan.repos[0].worktrees;
  assert.deepEqual(wts.map((w) => (typeof w.size === "object" ? w.size.bytes : w.size)), [undefined, 10, 200, "unknown"]);
  assert.deepEqual(wts.map((w) => "size" in w), [false, true, true, true]);
  assert.deepEqual(wts.map((w) => w.verdict), plain.repos[0].worktrees.map((w) => w.verdict));
  const a = wts[1].size;
  assert.ok(typeof a === "object");
  assert.deepEqual([a.measuredAt, typeof a.key], [1000, "string"]);

  // No time for a walk: every worktree with a folder reads unknown, across both repos, under the one budget.
  const none = await scanRepos([MAIN, OTHER], fake({ ...repo(ACME), ...repo(BETA) }).run, { now: () => 1000, size: { fs, budgetMs: 0 } });
  assert.deepEqual(none.repos.flatMap((r) => r.worktrees.map((w) => w.size)), [undefined, "unknown", "unknown", "unknown", undefined, "unknown"]);
});

test("size: a figure from the previous scan is reused without a walk while its key holds", async () => {
  const first = fakeSizeFs({ [A]: 10, [B]: 200, [C]: 3000 });
  const before = await scanRepos([MAIN], fake(repo(ACME)).run, { now: () => 1000, size: { fs: first.fs } });

  const second = fakeSizeFs({ [A]: 11, [B]: 201, [C]: 3001 });
  const moved = ACME.map((w) => (w.path === C ? { ...w, head: SHA(2) } : w));
  const after = await scanRepos([MAIN], fake(repo(moved)).run, { now: () => 2000, size: { fs: second.fs, previous: before } });
  const sizes = after.repos[0].worktrees.map((w) => (typeof w.size === "object" ? [w.size.bytes, w.size.measuredAt] : w.size));
  // A and B keep the old figure and its time; C has a new HEAD, so it was walked again.
  assert.deepEqual(sizes, [undefined, [10, 1000], [200, 1000], [3001, 2000]]);
  assert.deepEqual(second.read, [C]);
});

test("scanReader parses the cache again only when its modified time or size moves; a missing file gives nothing and drops what was kept", async () => {
  let reads = 0;
  let stat = { mtimeMs: 1, size: 10 };
  let text = JSON.stringify(sample());
  let missing = false;
  const fs: ScanReadFs = {
    stat: async () => { if (missing) throw new Error("ENOENT"); return stat; },
    readFile: async () => { reads++; return text; },
  };
  const read = scanReader(fs);
  assert.deepEqual(await read("/cfg/scan.cache"), sample());
  assert.deepEqual(await read("/cfg/scan.cache"), sample());
  assert.equal(reads, 1);
  // Same time, new size: read again.
  text = JSON.stringify({ ...sample(), scannedAt: 2 });
  stat = { mtimeMs: 1, size: 11 };
  assert.equal((await read("/cfg/scan.cache"))?.scannedAt, 2);
  assert.equal(reads, 2);
  missing = true;
  assert.equal(await read("/cfg/scan.cache"), undefined);
  missing = false;
  assert.equal((await read("/cfg/scan.cache"))?.scannedAt, 2);
  assert.equal(reads, 3);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatList, formatShow, main, MAX_COLUMNS } from "../src/worktrees/cli.ts";
import { select, sizeText, type ListedRepo } from "../src/worktrees/listing.ts";
import { slugOf } from "../src/worktrees/names.ts";
import { refreshScan } from "../src/worktrees/refresh.ts";
import { readScan, type ScanFile, type ScannedRepo, type ScannedWorktree } from "../src/worktrees/scan.ts";
import { DIFF_BASE, DIFF_HEAD, fakeRun, fakeSizeFs, good, repoTable, scannedRepo as repo, scannedWt as wt, type Wt } from "./worktrees-fixtures.ts";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GB = 1024 ** 3;

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";
const BETA = "/work/beta-site";
const BETA_A = "/work/beta-site-fix-a";

/** Three worktrees of one repo in one parent folder, a second repo, one that could not be read, and one with no linked worktree. */
const acme = (): ScannedRepo => repo(MAIN, [
  wt(MAIN, "main", { main: true }),
  wt(C, "fix/feature-c", { pr: { state: "merged", number: 9 }, lastCommitAt: NOW - 20 * DAY, size: "unknown", brief: "lost" }),
  wt(B, "feat/feature-b", {
    pr: { state: "open", number: 13 }, lastCommitAt: NOW - 5 * HOUR, size: { bytes: 340 * 1024 ** 2, measuredAt: NOW, key: "k" },
    overlaps: [{ path: A, count: 2, files: ["src/app.ts", "src/b.ts"] }],
  }),
  wt(A, "feat/feature-a", {
    dirty: 2, changed: 2, pr: { state: "open", number: 12 }, lastCommitAt: NOW - 3 * DAY,
    size: { bytes: Math.round(1.2 * GB), sharesNodeModules: true, measuredAt: NOW, key: "k" }, brief: "present",
    overlaps: [{ path: B, count: 5, files: ["src/app.ts", "src/b.ts", "src/c.ts"] }],
  }),
]);

const SCAN: ScanFile = {
  version: 1,
  scannedAt: NOW - HOUR,
  repos: [
    acme(),
    repo(BETA, [wt(BETA, "main", { main: true }), wt(BETA_A, "fix/a", { server: { port: 5173 } })]),
    repo("/work/broken", [], { defaultBranch: "", error: "not a git repository" }),
    repo("/work/solo", [wt("/work/solo", "main", { main: true })]),
  ],
};

const LIST_TEXT = [
  "acme-app  3 worktrees: 1 needs you, 1 in flight, 1 closable",
  "  needs you    acme-app-feature-a #12      3d   1.2 GB",
  "  in flight    acme-app-feature-b #13      5h   340 MB",
  "  closable     acme-app-feature-c #9      20d        ?",
  "",
  "beta-site  1 worktree: 1 busy",
  "  busy         beta-site-fix-a -         -        -",
  "",
  "broken",
  "  could not read: not a git repository",
];

const SHOW_A = [
  "acme-app-feature-a",
  "  repo         acme-app (/work/acme-app)",
  "  path         /work/acme-app-feature-a",
  "  branch       feat/feature-a",
  "  verdict      needs you: 2 changed files",
  "  PR           #12 open",
  "  last commit  3d ago",
  "  size         1.2 GB, shares node_modules",
  "  server       none found",
  "  brief        present",
  "  shares files with acme-app-feature-b (5): src/app.ts, src/b.ts, src/c.ts, +2 more",
];

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "questlog-wt-cli-"));
  dirs.push(d);
  return d;
};
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Write `scan` to `file` as the scan writes it, without waiting: these tests read it back at once. */
const putScan = (file: string, scan: ScanFile) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(scan));
};

/** A cache file under the OS temp folder holding `scan`. */
const cacheOf = (scan: ScanFile) => {
  const file = join(temp(), "worktrees", "scan.cache");
  putScan(file, scan);
  return file;
};

/** Run `main` with nothing real behind it: output is collected, and a scan would fail loudly. */
const cli = async (args: string[], io: Parameters<typeof main>[1] = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    out: (t) => out.push(t), err: (t) => err.push(t), now: () => NOW, env: { CLAUDE_CONFIG_DIR: join(temp(), "config") }, home: temp(),
    run: async () => { throw new Error("no run in this test"); }, listServers: async () => undefined, ...io,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

test("list: the stored text, grouped by repo, sorted by verdict, an unreadable repo named, a repo with no linked worktree left out", async () => {
  assert.deepEqual(formatList(select(SCAN).repos, NOW), LIST_TEXT);
  const r = await cli(["list", "--cache", cacheOf(SCAN)]);
  assert.equal(r.code, 0);
  assert.equal(r.out, LIST_TEXT.join("\n"));
  assert.equal(r.err, "");
});

test("folders that are gone or are no git repository are counted in one closing line, not listed; any other error is still named", async () => {
  const scan: ScanFile = {
    version: 1, scannedAt: NOW,
    repos: [
      acme(),
      repo("/work/gone-folder", [], { defaultBranch: "", error: "folder not found" }),
      repo("/work/plain-folder", [], { defaultBranch: "", error: "fatal: not a git repository (or any of the parent directories): .git" }),
      repo("/work/broken-repo", [], { defaultBranch: "", error: "git worktree list timed out" }),
    ],
  };
  assert.deepEqual(select(scan).repos.map((r) => r.path), [MAIN, "/work/broken-repo"]);
  assert.equal(select(scan).skipped, 2);

  const text = await cli(["list", "--cache", cacheOf(scan)]);
  assert.equal(text.code, 0);
  const lines = text.out.split("\n");
  assert.equal(lines.some((l) => l.includes("gone-folder") || l.includes("plain-folder")), false);
  assert.equal(lines.includes("  could not read: git worktree list timed out"), true);
  assert.equal(lines.at(-1), "2 folders skipped: gone, or not a git repository");

  const json = JSON.parse((await cli(["list", "--json", "--cache", cacheOf(scan)])).out);
  assert.deepEqual(json.repos.map((r: ListedRepo) => r.path), [MAIN, "/work/broken-repo"]);
  assert.equal(json.skipped, 2);

  // A name that only a skipped folder carries is no repo.
  assert.equal((await cli(["list", "--repo", "gone-folder", "--cache", cacheOf(scan)])).code, 1);
  // No skipped folders: no closing line and no field.
  assert.equal((await cli(["list", "--cache", cacheOf(SCAN)])).out.includes("skipped"), false);
  assert.equal("skipped" in JSON.parse((await cli(["list", "--json", "--cache", cacheOf(SCAN)])).out), false);
});

test("list --closable keeps only closable worktrees", async () => {
  const r = await cli(["list", "--closable", "--cache", cacheOf(SCAN)]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.split("\n").slice(0, 2), [
    "acme-app  1 worktree: 1 closable",
    "  closable     acme-app-feature-c #9      20d        ?",
  ]);
  assert.equal(r.out.includes("feature-a"), false);
  assert.equal(r.out.includes("beta-site"), false);
  // An orphan may be closed one at a time, but it is not what --closable lists.
  const orphan: ScanFile = { ...SCAN, repos: [repo(MAIN, [wt(MAIN, "main", { main: true }), wt(A, "", { detached: true })])] };
  assert.equal(select(orphan).repos[0].worktrees[0].verdict?.verdict, "orphan");
  assert.deepEqual(select(orphan, { closable: true }).repos, []);
  const none = await cli(["list", "--closable", "--cache", cacheOf(orphan)]);
  assert.deepEqual([none.code, none.out, none.err], [0, "", "no closable worktrees"]);
});

test("list --repo picks the repo by name whatever the letter case; no such repo exits 1", async () => {
  const cache = cacheOf(SCAN);
  const one = await cli(["list", "--repo", "Beta-Site", "--cache", cache]);
  assert.equal(one.code, 0);
  assert.equal(one.out, LIST_TEXT.slice(5, 7).join("\n"));
  const three = await cli(["list", "--repo", "acme-app", "--cache", cache]);
  assert.equal(three.out, LIST_TEXT.slice(0, 4).join("\n"));
  const none = await cli(["list", "--repo", "nothing", "--cache", cache]);
  assert.deepEqual([none.code, none.out], [1, ""]);
  assert.match(none.err, /no repo named nothing/);
});

/** Two repos named acme-app, and one slug that two repos hold. */
const TWINS: ScanFile = {
  version: 1,
  scannedAt: NOW,
  repos: [
    acme(),
    repo("/elsewhere/acme-app", [wt("/elsewhere/acme-app", "main", { main: true }), wt("/elsewhere/trees/acme-app-feature-a", "feat/other")]),
    repo(BETA, [wt(BETA, "main", { main: true }), wt("/other/acme-app-feature-b", "fix/b")]),
  ],
};

test("two repos of one name are both listed, then exit 1 says the name is shared", async () => {
  const r = await cli(["list", "--repo", "acme-app", "--cache", cacheOf(TWINS)]);
  assert.equal(r.code, 1);
  assert.equal(r.out.split("\n").filter((l) => l.startsWith("acme-app  ")).length, 2);
  assert.equal(r.out.includes("beta-site"), false);
  assert.match(r.err, /2 repos are named acme-app/);
});

test("show picks the one worktree of three in one folder, by slug, whatever the letter case", async () => {
  const cache = cacheOf(SCAN);
  const a = await cli(["show", "acme-app-feature-a", "--cache", cache]);
  assert.deepEqual([a.code, a.err], [0, ""]);
  assert.deepEqual(a.out.split("\n"), SHOW_A);

  const b = await cli(["show", "ACME-APP-FEATURE-B", "--cache", cache]);
  assert.equal(b.code, 0);
  assert.equal(b.out.split("\n")[2], "  path         /work/acme-app-feature-b");
  assert.equal(b.out.includes("feature-c"), false);

  const c = await cli(["show", "acme-app-feature-c", "--cache", cache]);
  assert.deepEqual(c.out.split("\n").slice(4), [
    "  verdict      closable: PR #9 merged, clean",
    "  PR           #9 merged",
    "  last commit  20d ago",
    "  size         unknown",
    "  server       none found",
    "  brief        lost",
    "  shares files not compared",
  ]);

  // The main checkout is not a worktree to show.
  const main_ = await cli(["show", "acme-app", "--cache", cache]);
  assert.equal(main_.code, 1);
});

test("show: a slug two repos hold prints each and exits 1; --repo narrows it to one", async () => {
  const cache = cacheOf(TWINS);
  const both = await cli(["show", "acme-app-feature-b", "--cache", cache]);
  assert.equal(both.code, 1);
  assert.deepEqual(both.out.split("\n").filter((l) => l.startsWith("  path")), [
    "  path         /work/acme-app-feature-b",
    "  path         /other/acme-app-feature-b",
  ]);
  assert.match(both.err, /2 worktrees are named acme-app-feature-b/);

  const one = await cli(["show", "acme-app-feature-b", "--repo", "beta-site", "--cache", cache]);
  assert.deepEqual([one.code, one.err], [0, ""]);
  assert.equal(one.out.split("\n")[2], "  path         /other/acme-app-feature-b");

  // Two repos share the name, so --repo cannot tell their worktrees apart: both print, exit 1.
  const twins = await cli(["show", "acme-app-feature-a", "--repo", "acme-app", "--cache", cache]);
  assert.equal(twins.code, 1);
  assert.equal(twins.out.split("\n").filter((l) => l.startsWith("  path")).length, 2);
});

test("--json: list parses and holds the same worktrees as the text, each with its slug; show gives the matches; nothing else on stdout", async () => {
  const cache = cacheOf(SCAN);
  const text = await cli(["list", "--cache", cache]);
  const r = await cli(["list", "--json", "--cache", cache]);
  assert.equal(r.code, 0);
  const got = JSON.parse(r.out) as { scannedAt: number; repos: ListedRepo[] };
  assert.equal(got.scannedAt, SCAN.scannedAt);
  assert.deepEqual(got.repos.map((x) => x.path), [MAIN, BETA, "/work/broken"]);
  const slugs = got.repos.flatMap((x) => x.worktrees.map((w) => w.slug));
  assert.deepEqual(slugs, ["acme-app-feature-a", "acme-app-feature-b", "acme-app-feature-c", "beta-site-fix-a"]);
  assert.deepEqual(slugs, text.out.split("\n").filter((l) => l.startsWith("  ") && !l.includes("could not read")).map((l) => l.trim().split(/\s+/).find((p) => p.includes("-"))));
  assert.equal(got.repos.flatMap((x) => x.worktrees).some((w) => w.main), false);
  assert.equal(got.repos[0].worktrees[0].verdict?.reason, "2 changed files");
  assert.equal(got.repos[2].error, "not a git repository");

  const closable = JSON.parse((await cli(["list", "--json", "--closable", "--cache", cache])).out) as { repos: ListedRepo[] };
  assert.deepEqual(closable.repos.flatMap((x) => x.worktrees.map((w) => w.slug)), ["acme-app-feature-c"]);

  const shown = await cli(["show", "acme-app-feature-b", "--json", "--cache", cache]);
  const list = JSON.parse(shown.out) as (ScannedWorktree & { slug: string; repo: string })[];
  assert.deepEqual(list.map((w) => [w.path, w.slug, w.repo]), [[B, "acme-app-feature-b", MAIN]]);

  const missing = await cli(["show", "nothing-here", "--json", "--cache", cache]);
  assert.deepEqual([missing.code, missing.out], [1, "[]"]);
});

test("an unknown subcommand, an unknown flag and a missing slug print the usage and exit 2; an unknown slug exits 1", async () => {
  const cache = cacheOf(SCAN);
  for (const args of [["prune"], ["list", "--force"], ["show"], ["show", "a", "b"], [], ["list", "extra"], ["scan", "--worktree-parallel", "0"], ["scan", "--per-repo-seconds", "soon"]]) {
    const r = await cli([...args, "--cache", cache]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.out, "");
    assert.match(r.err, /usage: questlog-wt/);
  }
  const unknown = await cli(["show", "no-such-slug", "--cache", cache]);
  assert.deepEqual([unknown.code, unknown.out], [1, ""]);
  assert.match(unknown.err, /no worktree named no-such-slug/);
  const help = await cli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /usage: questlog-wt/);
});

test("a 90-character slug and branch still give lines under 100 columns, in list and in show", async () => {
  const long = "x".repeat(90);
  const scan: ScanFile = {
    version: 1, scannedAt: NOW,
    repos: [repo(`/work/${long}`, [
      wt(`/work/${long}`, "main", { main: true }),
      wt(`/work/${long}-feature-a`, `feat/${long}`, {
        pr: { state: "open", number: 123456 }, lastCommitAt: NOW - 400 * DAY, size: { bytes: 999 * GB, measuredAt: NOW, key: "k" },
        overlaps: [{ path: `/work/${long}-feature-b`, count: 9, files: [`src/${long}.ts`] }],
      }),
      wt(`/work/${long}-feature-b`, `fix/${long}`, { unread: true }),
      wt("/work/c", "fix/c"),
    ], { timedOut: true, error: `could not read ${long} ${long}` })],
  };
  const cache = cacheOf(scan);
  const listed = (await cli(["list", "--cache", cache])).out.split("\n");
  const shown = (await cli(["show", `${long}-feature-a`, "--cache", cache])).out.split("\n");
  assert.equal(listed.length, 5);
  assert.equal(shown.length, 11);
  for (const l of [...listed, ...shown]) assert.ok(l.length < MAX_COLUMNS, `${l.length} columns: ${l}`);
  // The verdict, PR, age and size survive the cut: only the slug is shortened.
  assert.equal(listed[2], "  in flight    c" + " ".repeat(53) + " -         -        -");
  assert.match(listed[3], /^  in flight    x{53}… #123456 400d   999 GB$/);
  assert.match(listed[4], /^  not read yet x+… -/);
});

test("a timed-out repo says so in its heading and its unread worktrees read not read yet", () => {
  const scan: ScanFile = {
    version: 1, scannedAt: NOW,
    repos: [repo(MAIN, [wt(MAIN, "main", { main: true }), wt(A, "feat/feature-a"), wt(B, "feat/feature-b", { unread: true }), wt(C, "fix/feature-c", { prunable: true })], { timedOut: true })],
  };
  assert.deepEqual(formatList(select(scan).repos, NOW), [
    "acme-app  3 worktrees: 1 in flight, 1 missing, 1 not read yet (timed out)",
    "  in flight    acme-app-feature-a -         -        -",
    "  not read yet acme-app-feature-b -         -        -",
    "  missing      acme-app-feature-c -         -        -",
  ]);
});

test("sizeText and slugOf", () => {
  assert.deepEqual([0, 512, 1024, 1536, 150 * 1024, 5 * GB].map(sizeText), ["0 B", "512 B", "1.0 KB", "1.5 KB", "150 KB", "5.0 GB"]);
  assert.deepEqual(["/work/acme-app-feature-a", "I:\\Work\\Acme-App\\", "c:/x/y//"].map(slugOf), ["acme-app-feature-a", "Acme-App", "y"]);
  assert.equal(formatShow(MAIN, { ...wt(A, "", { detached: true }), slug: "acme-app-feature-a" }, NOW)[3], "  branch       (detached)");
  assert.equal(formatShow(MAIN, { ...wt(A, "feat/feature-a", { lastCommitAt: NOW }), slug: "acme-app-feature-a" }, NOW)[6], "  last commit  just now");
});

test("no cache to read: list says so on stderr, prints nothing and exits 0; --json gives an empty list; show exits 1", async () => {
  const dir = temp();
  const damaged = join(dir, "damaged.cache");
  writeFileSync(damaged, "{ not json");
  const other = join(dir, "other.cache");
  writeFileSync(other, JSON.stringify({ version: 2, scannedAt: 1, repos: [] }));
  for (const cache of [join(dir, "missing.cache"), damaged, other]) {
    const r = await cli(["list", "--cache", cache]);
    assert.deepEqual([r.code, r.out, r.err], [0, "", "no scan yet: run questlog-wt scan"]);
    const j = await cli(["list", "--json", "--cache", cache]);
    assert.equal(j.code, 0);
    assert.deepEqual(JSON.parse(j.out), { scannedAt: null, repos: [] });
    const s = await cli(["show", "acme-app-feature-a", "--cache", cache]);
    assert.deepEqual([s.code, s.out], [1, ""]);
  }
});

test("with no --cache the cache is read from Questlog's folder under the config folder passed in", async () => {
  const config = join(temp(), "config");
  putScan(join(config, "questlog", "worktrees", "scan.cache"), SCAN);
  const r = await cli(["list", "--closable"], { env: { CLAUDE_CONFIG_DIR: config } });
  assert.equal(r.out.split("\n")[0], "acme-app  1 worktree: 1 closable");
});

/** A repo of three worktrees where A and C changed the same file, and what the scan is told about it. */
const scanSetup = () => {
  const wts: Wt[] = [{ path: MAIN, branch: "main" }, { path: A, branch: "feat/feature-a" }, { path: B, branch: "feat/feature-b" }, { path: C, branch: "fix/feature-c" }];
  const table = repoTable(wts);
  for (const p of [A, B, C]) table[`${p}|${DIFF_HEAD}`] = good("");
  table[`${A}|${DIFF_BASE}`] = good("src/app.ts\nsrc/a.ts\n");
  table[`${B}|${DIFF_BASE}`] = good("src/b.ts\n");
  table[`${C}|${DIFF_BASE}`] = good("src/app.ts\n");
  const entries = [
    { slug: "a", repo_path: MAIN, worktree_path: A, brief_local_path: "/work/briefs/a.md" },
    { slug: "c", repo_path: MAIN, worktree_path: C, brief_local_path: "/work/briefs/c.md", brief_full_text: "the brief" },
  ];
  return { table, entries };
};

test("refreshScan scans the folders and registry it is handed, with all four extra facts, and writes the cache; list reads them back", async () => {
  const { table, entries } = scanSetup();
  const cachePath = join(temp(), "worktrees", "scan.cache");
  const first = fakeSizeFs({ [A]: 10, [B]: 200, [C]: 3000 });
  const options = {
    // The session names a worktree, the registry names the main checkout: one repo, scanned once.
    sessionCwds: [B], entries, cachePath,
    listServers: async () => [{ port: 5173, folder: B }], now: () => NOW,
    exists: async (p: string) => p === "/work/briefs/a.md",
  };
  const { run, calls } = fakeRun(table);
  const scan = await refreshScan({ ...options, run, sizeFs: first.fs, worktreeParallel: 2, perRepoMs: 60_000 });
  assert.equal(scan.repos.length, 1);
  assert.equal(calls.filter((c) => c.cmd === "gh").length, 1);
  assert.deepEqual(await readScan(cachePath), scan);

  const listed = await cli(["list", "--json", "--cache", cachePath]);
  const [repoOut] = (JSON.parse(listed.out) as { repos: ListedRepo[] }).repos;
  const by = (slug: string) => repoOut.worktrees.find((w) => w.slug === slug)!;
  assert.deepEqual(by("acme-app-feature-b").server, { port: 5173 });
  assert.equal(by("acme-app-feature-b").verdict?.verdict, "busy");
  assert.deepEqual([by("acme-app-feature-a").brief, by("acme-app-feature-b").brief, by("acme-app-feature-c").brief], ["present", undefined, "recoverable"]);
  assert.deepEqual(by("acme-app-feature-a").overlaps, [{ path: C, count: 1, files: ["src/app.ts"] }]);
  assert.deepEqual(by("acme-app-feature-b").overlaps, []);
  assert.deepEqual(["a", "b", "c"].map((x) => { const s = by(`acme-app-feature-${x}`).size; return typeof s === "object" ? s.bytes : s; }), [10, 200, 3000]);

  const text = await cli(["show", "acme-app-feature-a", "--cache", cachePath]);
  assert.deepEqual(text.out.split("\n").slice(7), [
    "  size         10 B",
    "  server       none found",
    "  brief        present",
    "  shares files with acme-app-feature-c (1): src/app.ts",
  ]);

  // A second scan takes the sizes from the cache the first one wrote: no folder is walked again.
  const second = fakeSizeFs({ [A]: 11, [B]: 201, [C]: 3001 });
  const again = await refreshScan({ ...options, run: fakeRun(table).run, sizeFs: second.fs });
  assert.deepEqual(second.read, []);
  assert.deepEqual(again.repos[0].worktrees.map((w) => (typeof w.size === "object" ? w.size.bytes : w.size)), [undefined, 10, 200, 3000]);
});

test("scan: reads rows and registry from the config folder passed in, writes only the cache named, and says what it read", async () => {
  const { table, entries } = scanSetup();
  const root = temp();
  const config = join(root, "config");
  mkdirSync(join(config, "questlog"), { recursive: true });
  writeFileSync(join(config, "questlog", "5e55a0b1-0000-4000-8000-000000000001.json"), JSON.stringify({ id: "5e55a0b1-0000-4000-8000-000000000001", repo: "acme-app", plan: "", done: 0, total: 0, updatedAt: 1, cwd: A }));
  const registry = join(root, "registry.json");
  writeFileSync(registry, JSON.stringify({ entries }));
  const cachePath = join(root, "out", "scan.cache");
  const io = { env: { CLAUDE_CONFIG_DIR: config }, run: fakeRun(table).run, sizeFs: fakeSizeFs({ [A]: 10 }).fs, exists: async () => false };

  const r = await cli(["scan", "--cache", cachePath, "--registry", registry, "--worktree-parallel", "3", "--per-repo-seconds", "30"], io);
  assert.deepEqual([r.code, r.out, r.err], [0, "scanned 1 repo, 3 linked worktrees", ""]);
  const written = (await readScan(cachePath))!;
  assert.deepEqual(written.repos[0].worktrees.map((w) => w.brief), [undefined, "lost", undefined, "recoverable"]);
  assert.deepEqual(written.repos[0].worktrees.map((w) => w.server), [undefined, "unknown", "unknown", "unknown"]);
  // The live cache's place under this config folder was not written.
  assert.equal(await readScan(join(config, "questlog", "worktrees", "scan.cache")), undefined);

  const j = await cli(["scan", "--json", "--cache", cachePath, "--registry", registry], io);
  assert.equal(j.code, 0);
  assert.deepEqual((JSON.parse(j.out) as ScanFile).repos.map((x) => x.path), [MAIN]);

  // A cache that cannot be written is a failed scan, not a crash.
  const blocked = join(root, "file");
  writeFileSync(blocked, "x");
  const failed = await cli(["scan", "--cache", join(blocked, "scan.cache"), "--registry", registry], io);
  assert.equal(failed.code, 1);
  assert.match(failed.err, /^scan failed: /);
});

test("end to end: node runs cli.ts itself and list --json prints the cache", () => {
  const cache = cacheOf(SCAN);
  const script = join(import.meta.dirname, "..", "src", "worktrees", "cli.ts");
  const stdout = execFileSync(process.execPath, [script, "list", "--json", "--cache", cache], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const got = JSON.parse(stdout) as { scannedAt: number; repos: ListedRepo[] };
  assert.equal(got.scannedAt, SCAN.scannedAt);
  assert.deepEqual(got.repos.flatMap((x) => x.worktrees.map((w) => w.slug)), ["acme-app-feature-a", "acme-app-feature-b", "acme-app-feature-c", "beta-site-fix-a"]);
  assert.equal(readFileSync(cache, "utf8").includes('"slug"'), false);
});

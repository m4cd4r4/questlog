import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, rmdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureSizes, realSizeFs, reusable, sizeKey, walkSize, type SizeFs } from "../src/worktrees/size.ts";
import type { Facts } from "../src/worktrees/verdict.ts";
import type { ScanFile } from "../src/worktrees/scan.ts";

const SHA = (n: number) => String(n).repeat(40).slice(0, 40);
const DAY = 24 * 60 * 60 * 1000;

/** A folder under the OS temp folder, removed when `body` ends. Links made inside it must be unlinked by the test first. */
const withTemp = async (body: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), "questlog-size-"));
  try { await body(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

const file = (path: string, bytes: number) => writeFileSync(path, "x".repeat(bytes));

/** A link to a folder: a junction on Windows, a symlink elsewhere. Undefined when the system refuses. */
const linkDir = (target: string, path: string): string | undefined => {
  try { symlinkSync(target, path, "junction"); return undefined; } catch (e) { return e instanceof Error ? e.message : String(e); }
};
/** Take a folder link away without walking through it. */
const unlinkDir = (path: string) => { try { unlinkSync(path); } catch { rmdirSync(path); } };

/** The real file system with every readdir counted. */
const counting = () => {
  const seen: string[] = [];
  const fs: SizeFs = { readdir: (p) => { seen.push(p); return realSizeFs.readdir(p); }, lstat: (p) => realSizeFs.lstat(p) };
  return { fs, seen };
};

const fact = (path: string, over: Partial<Facts> = {}): Facts => ({
  path, branch: "feat/x", head: SHA(1), main: false, detached: false, locked: false, lockedReason: "", bare: false,
  prunable: false, prunableReason: "", dirty: 0, unpushed: 0, stashes: 0, ownCommits: 1, pr: { state: "none" }, ...over,
});

const previousOf = (worktrees: Facts[]): ScanFile =>
  ({ version: 1, scannedAt: 0, repos: [{ path: "/work/acme-app", defaultBranch: "main", tookMs: 0, worktrees }] });

test("walkSize adds up the real files, nested folders included", async () => {
  await withTemp(async (root) => {
    file(join(root, "a.txt"), 10);
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    file(join(root, "src", "b.txt"), 200);
    file(join(root, "src", "deep", "c.txt"), 3000);
    file(join(root, ".git"), 40);
    assert.deepEqual(await walkSize(root), { bytes: 3250 });
  });
});

test("walkSize never follows a junction or symlink to a folder", async (t) => {
  await withTemp(async (root) => {
    const wt = join(root, "wt");
    const outside = join(root, "outside");
    mkdirSync(wt);
    mkdirSync(outside);
    file(join(wt, "a.txt"), 10);
    file(join(outside, "big.bin"), 5000);
    const refused = linkDir(outside, join(wt, "linked"));
    if (refused) { t.skip(`the system refused to make a folder link: ${refused}`); return; }
    try {
      const { fs, seen } = counting();
      assert.deepEqual(await walkSize(wt, fs), { bytes: 10, links: 1 });
      assert.equal(seen.some((p) => p.includes("linked") || p.includes("outside")), false);
    } finally { unlinkDir(join(wt, "linked")); }
  });
});

test("a linked node_modules counts zero and is flagged; a real one is counted and not flagged", async (t) => {
  await withTemp(async (root) => {
    const wt = join(root, "wt");
    const shared = join(root, "main", "node_modules");
    mkdirSync(wt);
    mkdirSync(join(shared, "pkg"), { recursive: true });
    file(join(shared, "pkg", "index.js"), 7000);
    file(join(wt, "a.txt"), 10);

    const own = join(root, "own");
    mkdirSync(join(own, "node_modules", "pkg"), { recursive: true });
    file(join(own, "node_modules", "pkg", "index.js"), 70);
    assert.deepEqual(await walkSize(own), { bytes: 70 });

    const refused = linkDir(shared, join(wt, "node_modules"));
    if (refused) { t.skip(`the system refused to make a folder link: ${refused}`); return; }
    try {
      assert.deepEqual(await walkSize(wt), { bytes: 10, sharesNodeModules: true, links: 1 });
    } finally { unlinkDir(join(wt, "node_modules")); }
  });
});

test("walkSize skips what it cannot read and stops when told to", async () => {
  const dirent = (name: string, kind: "dir" | "file") =>
    ({ name, isDirectory: () => kind === "dir", isFile: () => kind === "file", isSymbolicLink: () => false });
  const stat = (size: number) => ({ size, mtimeMs: 1, isDirectory: () => false, isSymbolicLink: () => false });
  const fs: SizeFs = {
    readdir: async (p) => {
      if (p === "/work/acme-app-feature-a") return [dirent("ok.txt", "file"), dirent("gone.txt", "file"), dirent("locked", "dir"), dirent("src", "dir")];
      if (p.endsWith("src")) return [dirent("b.txt", "file")];
      throw new Error("EACCES");
    },
    lstat: async (p) => { if (p.endsWith("gone.txt")) throw new Error("ENOENT"); return stat(p.endsWith("b.txt") ? 5 : 100); },
  };
  assert.deepEqual(await walkSize("/work/acme-app-feature-a", fs), { bytes: 105, skipped: true });
  assert.deepEqual(await walkSize("/work/acme-app-feature-a", fs, () => true), { bytes: 0, cutShort: true });
});

test("walkSize counts every junction and symlink at any depth, whatever its name, and says when a folder was skipped", async () => {
  const dirent = (name: string, kind: "dir" | "file" | "link") =>
    ({ name, isDirectory: () => kind === "dir", isFile: () => kind === "file", isSymbolicLink: () => kind === "link" });
  const read: string[] = [];
  const fs: SizeFs = {
    readdir: async (p) => {
      read.push(p);
      if (p === "/work/acme-app-feature-a") return [dirent("a.txt", "file"), dirent("src", "dir"), dirent("vendor", "link")];
      if (p.endsWith("src")) return [dirent("deep", "dir"), dirent("alias.txt", "link")];
      if (p.endsWith("deep")) return [dirent("node_modules", "link"), dirent("b.txt", "file")];
      throw new Error("ENOENT");
    },
    lstat: async () => ({ size: 4, mtimeMs: 1 }),
  };
  // Three links: one at the root, a linked file one level down, a linked node_modules two levels down. None is read.
  assert.deepEqual(await walkSize("/work/acme-app-feature-a", fs), { bytes: 8, sharesNodeModules: true, links: 3 });
  assert.equal(read.length, 3);
  // No link and every folder read: neither key is there
  const plain: SizeFs = { readdir: async () => [dirent("a.txt", "file")], lstat: async () => ({ size: 4, mtimeMs: 1 }) };
  assert.deepEqual(await walkSize("/work/acme-app-feature-a", plain), { bytes: 4 });
  // A root that cannot be read is a walk that did not finish
  const none: SizeFs = { readdir: async () => { throw new Error("EACCES"); }, lstat: async () => ({ size: 0, mtimeMs: 1 }) };
  assert.deepEqual(await walkSize("/work/acme-app-feature-a", none), { bytes: 0, skipped: true });
});

test("sizeKey and reusable: the same key and young enough, nothing else", () => {
  const key = sizeKey(1234.5, SHA(1));
  assert.notEqual(key, sizeKey(1234.5, SHA(2)));
  assert.notEqual(key, sizeKey(1235.5, SHA(1)));
  const fig = { bytes: 10, measuredAt: 1000, key };
  assert.equal(reusable(fig, key, 1000 + DAY - 1, DAY), true);
  assert.equal(reusable(fig, key, 1000 + DAY, DAY), false);
  assert.equal(reusable(fig, sizeKey(1234.5, SHA(2)), 1001, DAY), false);
  assert.equal(reusable("unknown", key, 1001, DAY), false);
  assert.equal(reusable(undefined, key, 1001, DAY), false);
});

test("three worktrees in one parent folder each get their own figure; the main checkout gets none", async () => {
  await withTemp(async (root) => {
    const main = join(root, "acme-app");
    const [a, b, c] = ["a", "b", "c"].map((n) => join(root, `acme-app-feature-${n}`));
    for (const d of [main, a, b, c]) mkdirSync(d);
    file(join(main, "m.txt"), 999);
    file(join(a, "f.txt"), 1);
    file(join(b, "f.txt"), 20);
    file(join(c, "f.txt"), 300);
    const out = await measureSizes(
      [fact(main, { main: true }), fact(a), fact(b), fact(c), fact(join(root, "gone"), { prunable: true }), fact(join(root, "bare"), { bare: true })],
      { now: () => 5000 },
    );
    assert.deepEqual(out.map((w) => (typeof w.size === "object" ? w.size.bytes : w.size)), [undefined, 1, 20, 300, undefined, undefined]);
    assert.deepEqual(out.map((w) => "size" in w), [false, true, true, true, false, false]);
    const size = out[1].size;
    assert.ok(typeof size === "object");
    assert.equal(size.measuredAt, 5000);
    assert.equal(typeof size.key, "string");
  });
});

test("a figure with the same key is reused without a walk; a changed HEAD or an old figure walks again", async () => {
  await withTemp(async (root) => {
    const a = join(root, "acme-app-feature-a");
    mkdirSync(a);
    file(join(a, "f.txt"), 10);
    // Pin the folder's own modified time so adding a file below does not change the key by itself.
    const pin = () => utimesSync(a, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    pin();

    const first = await measureSizes([fact(a)], { now: () => 1000 });
    assert.ok(typeof first[0].size === "object" && first[0].size.bytes === 10);
    file(join(a, "g.txt"), 5);
    pin();

    const hit = counting();
    const again = await measureSizes([fact(a)], { fs: hit.fs, previous: previousOf(first), now: () => 2000 });
    assert.deepEqual(again[0].size, first[0].size);
    assert.equal(hit.seen.length, 0);

    // The previous figure is found whatever the slashes or letter case of the path.
    const spelled = counting();
    const other = a.split("\\").join("/").toUpperCase();
    const viaSpelling = await measureSizes([fact(a)], { fs: spelled.fs, previous: previousOf([{ ...first[0], path: `${other}/` }]), now: () => 2000 });
    assert.deepEqual(viaSpelling[0].size, first[0].size);
    assert.equal(spelled.seen.length, 0);

    const moved = counting();
    const newHead = await measureSizes([fact(a, { head: SHA(2) })], { fs: moved.fs, previous: previousOf(first), now: () => 2000 });
    assert.ok(typeof newHead[0].size === "object");
    assert.deepEqual([newHead[0].size.bytes, newHead[0].size.measuredAt], [15, 2000]);
    assert.ok(moved.seen.length > 0);

    const old = counting();
    const stale = await measureSizes([fact(a)], { fs: old.fs, previous: previousOf(first), now: () => 1000 + DAY, maxAgeMs: DAY });
    assert.ok(typeof stale[0].size === "object");
    assert.deepEqual([stale[0].size.bytes, stale[0].size.measuredAt], [15, 1000 + DAY]);
    assert.ok(old.seen.length > 0);
  });
});

test("a budget of zero gives unknown with no walk, and a reusable figure is still reused", async () => {
  await withTemp(async (root) => {
    const a = join(root, "acme-app-feature-a");
    const b = join(root, "acme-app-feature-b");
    mkdirSync(a);
    mkdirSync(b);
    file(join(a, "f.txt"), 10);
    file(join(b, "f.txt"), 20);
    const first = await measureSizes([fact(b)], { now: () => 1000 });

    const { fs, seen } = counting();
    // `a` comes first and has no figure: `b`'s reuse must not wait behind it.
    const out = await measureSizes([fact(a), fact(b)], { fs, previous: previousOf(first), budgetMs: 0, now: () => 2000 });
    assert.equal(out[0].size, "unknown");
    assert.deepEqual(out[1].size, first[0].size);
    assert.equal(seen.length, 0);
  });
});

test("the budget running out part way leaves the rest unknown; a folder that cannot be read is unknown", async () => {
  await withTemp(async (root) => {
    const [a, b] = ["a", "b"].map((n) => join(root, `acme-app-feature-${n}`));
    mkdirSync(a);
    mkdirSync(b);
    file(join(a, "f.txt"), 10);
    file(join(b, "f.txt"), 20);
    let clock = 0;
    const fs: SizeFs = { readdir: (p) => { clock += 100; return realSizeFs.readdir(p); }, lstat: (p) => realSizeFs.lstat(p) };
    const out = await measureSizes([fact(a), fact(b), fact(join(root, "no-such-folder"))], { fs, budgetMs: 50, now: () => clock });
    assert.ok(typeof out[0].size === "object" && out[0].size.bytes === 10);
    assert.equal(out[1].size, "unknown");
    assert.equal(out[2].size, "unknown");
  });
});

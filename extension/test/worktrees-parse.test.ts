import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktreeList, samePath } from "../src/worktrees/parse.ts";

// Format captured from real `git worktree list --porcelain` output (git for Windows); paths, branch
// names and commit ids replaced with neutral ones.
const A = "1111111111111111111111111111111111111111";
const B = "2222222222222222222222222222222222222222";
const C = "3333333333333333333333333333333333333333";
const D = "4444444444444444444444444444444444444444";

const THREE = [
  "worktree /work/acme-app",
  `HEAD ${A}`,
  "branch refs/heads/main",
  "",
  "worktree /work/acme-app-feature-a",
  `HEAD ${B}`,
  "branch refs/heads/feat/feature-a",
  "",
  "worktree /work/acme-app-feature-b",
  `HEAD ${C}`,
  "branch refs/heads/feat/feature-b",
  "",
  "worktree /work/acme-app-feature-c",
  `HEAD ${D}`,
  "branch refs/heads/fix/feature-c",
  "",
  "",
].join("\n");

test("three worktrees of one repo in one parent folder come back as three records, each its own", () => {
  const recs = parseWorktreeList(THREE);
  assert.equal(recs.length, 4);
  const linked = recs.filter((r) => !r.main);
  assert.deepEqual(linked.map((r) => r.path), ["/work/acme-app-feature-a", "/work/acme-app-feature-b", "/work/acme-app-feature-c"]);
  assert.deepEqual(linked.map((r) => r.branch), ["feat/feature-a", "feat/feature-b", "fix/feature-c"]);
  assert.deepEqual(linked.map((r) => r.head), [B, C, D]);
  // A folder name that starts another's name is not the same worktree
  assert.equal(linked.filter((r) => samePath(r.path, "/work/acme-app-feature-b")).length, 1);
  assert.equal(recs.filter((r) => samePath(r.path, "/work/acme-app")).length, 1);
});

test("the first entry is the main checkout, and only the first", () => {
  const recs = parseWorktreeList(THREE);
  assert.deepEqual(recs.map((r) => r.main), [true, false, false, false]);
  assert.equal(recs[0].branch, "main");
  assert.equal(recs[0].head, A);
  assert.deepEqual(
    { detached: recs[0].detached, locked: recs[0].locked, bare: recs[0].bare, prunable: recs[0].prunable },
    { detached: false, locked: false, bare: false, prunable: false },
  );
});

test("a detached worktree has no branch", () => {
  const [, d] = parseWorktreeList(
    ["worktree /work/acme-app", `HEAD ${A}`, "branch refs/heads/main", "", "worktree /work/acme-app-run-1", `HEAD ${B}`, "detached", ""].join("\n"),
  );
  assert.equal(d.detached, true);
  assert.equal(d.branch, "");
  assert.equal(d.head, B);
});

test("a locked worktree is flagged with or without a reason", () => {
  const recs = parseWorktreeList(
    [
      "worktree /work/acme-app", `HEAD ${A}`, "branch refs/heads/main", "",
      "worktree /work/acme-app-feature-a", `HEAD ${B}`, "branch refs/heads/feat/feature-a", "locked in use", "",
      "worktree /work/acme-app-run-1", `HEAD ${C}`, "detached", "locked", "",
    ].join("\n"),
  );
  assert.deepEqual(recs.map((r) => r.locked), [false, true, true]);
  assert.deepEqual(recs.map((r) => r.lockedReason), ["", "in use", ""]);
  assert.equal(recs[2].detached, true);
});

test("a prunable worktree is flagged with or without a reason", () => {
  const recs = parseWorktreeList(
    [
      "worktree /work/acme-app", `HEAD ${A}`, "branch refs/heads/main", "",
      "worktree /work/acme-app-feature-a", `HEAD ${B}`, "branch refs/heads/feat/feature-a", "prunable gitdir file points to non-existent location", "",
      "worktree /work/acme-app-feature-b", `HEAD ${C}`, "branch refs/heads/feat/feature-b", "prunable", "",
    ].join("\n"),
  );
  assert.deepEqual(recs.map((r) => r.prunable), [false, true, true]);
  assert.equal(recs[1].prunableReason, "gitdir file points to non-existent location");
  assert.equal(recs[2].prunableReason, "");
  assert.equal(recs[1].branch, "feat/feature-a");
});

test("a path with spaces is kept whole", () => {
  const [, s] = parseWorktreeList(
    ["worktree C:/work/acme app", `HEAD ${A}`, "branch refs/heads/main", "", "worktree C:/work/acme app feature a", `HEAD ${B}`, "branch refs/heads/feat/feature-a", ""].join("\n"),
  );
  assert.equal(s.path, "C:/work/acme app feature a");
  assert.equal(s.branch, "feat/feature-a");
});

test("a bare main entry has no head or branch, and its worktrees still parse", () => {
  const recs = parseWorktreeList(["worktree /work/acme-app.git", "bare", "", "worktree /work/acme-app-feature-a", `HEAD ${B}`, "branch refs/heads/feat/feature-a", ""].join("\n"));
  assert.deepEqual(recs.map((r) => [r.main, r.bare, r.head, r.branch]), [[true, true, "", ""], [false, false, B, "feat/feature-a"]]);
});

test("CRLF line ends, extra blank lines and an unknown line do not change the result", () => {
  const crlf = parseWorktreeList(THREE.replace(/\n/g, "\r\n"));
  assert.deepEqual(crlf, parseWorktreeList(THREE));
  const noisy = parseWorktreeList(`\n\n${THREE.replace("branch refs/heads/main", "branch refs/heads/main\nfuture-attribute x")}\n\n\n`);
  assert.deepEqual(noisy, parseWorktreeList(THREE));
});

test("empty output gives no records", () => {
  assert.deepEqual(parseWorktreeList(""), []);
  assert.deepEqual(parseWorktreeList("\r\n\r\n"), []);
});

test("samePath: drive-letter case, slash style and a trailing slash do not make two worktrees", () => {
  assert.equal(samePath("C:/work/acme-app-feature-a", "c:\\work\\acme-app-feature-a"), true);
  assert.equal(samePath("C:/Work/Acme-App-Feature-A/", "c:/work/acme-app-feature-a"), true);
  assert.equal(samePath("C:/work/acme-app-feature-a", "C:/work/acme-app-feature-ab"), false);
  assert.equal(samePath("C:/work/acme-app", "D:/work/acme-app"), false);
});

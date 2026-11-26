import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAIM_SETTLE_MS, dropClaim, readClaim, takeClaim, writeClaim, type ClaimFs } from "../src/worktrees/claim.ts";
import { CLAIM_MS, claimPathFor, scanDue } from "../src/worktrees/due.ts";

const MIN = 60_000;
const NOW = 1_000 * MIN;
const FIRST = 101;
const SECOND = 202;

/** A claim path beside a cache that does not exist yet, in a fresh folder under the OS temp folder. */
const claimFile = (t: { after: (fn: () => void) => void }): string => {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), "questlog-claim-"));
  t.after(() => nodeFs.rmSync(dir, { recursive: true, force: true }));
  return claimPathFor(join(dir, "worktrees", "scan.cache"));
};

test("a claim written is the claim read, and nothing else is left in the folder", async (t) => {
  const file = claimFile(t);
  assert.equal(await readClaim(file), undefined);
  assert.equal(await writeClaim(file, FIRST, NOW), true);
  assert.deepEqual(await readClaim(file), { at: NOW, pid: FIRST });
  assert.deepEqual(nodeFs.readdirSync(join(file, "..")), ["scan.claim"]);
});

test("a damaged claim file reads as no claim", async (t) => {
  const file = claimFile(t);
  await writeClaim(file, FIRST, NOW);
  nodeFs.writeFileSync(file, "{");
  assert.equal(await readClaim(file), undefined);
});

test("drop removes the claim only when the pid matches", async (t) => {
  const file = claimFile(t);
  await writeClaim(file, FIRST, NOW);
  await dropClaim(file, SECOND);
  assert.deepEqual(await readClaim(file), { at: NOW, pid: FIRST });
  await dropClaim(file, FIRST);
  assert.equal(await readClaim(file), undefined);
  assert.equal(nodeFs.existsSync(file), false);
});

test("a claim taken over by a second window survives the first window's drop", async (t) => {
  const file = claimFile(t);
  await writeClaim(file, FIRST, NOW - CLAIM_MS);
  assert.equal(await writeClaim(file, SECOND, NOW), true);
  await dropClaim(file, FIRST);
  assert.deepEqual(await readClaim(file), { at: NOW, pid: SECOND });
});

test("dropping a claim that is not there does nothing", async (t) => {
  const file = claimFile(t);
  await assert.doesNotReject(() => dropClaim(file, FIRST));
  assert.equal(nodeFs.existsSync(file), false);
});

test("a folder that cannot be written makes the write answer false, not reject", async (t) => {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), "questlog-claim-"));
  t.after(() => nodeFs.rmSync(dir, { recursive: true, force: true }));
  // The place the claim's folder should be is a file, so the folder can never be made
  const blocked = join(dir, "worktrees");
  nodeFs.writeFileSync(blocked, "not a folder");
  const file = claimPathFor(join(blocked, "scan.cache"));
  assert.equal(await writeClaim(file, FIRST, NOW), false);
  assert.equal(await readClaim(file), undefined);
  await assert.doesNotReject(() => dropClaim(file, FIRST));
});

test("an unlink that fails is swallowed: the claim stays and drop still resolves", async () => {
  const files = new Map<string, string>();
  const fs: ClaimFs = {
    mkdir: async () => undefined,
    writeFile: async (p, d) => { files.set(p, d); },
    rename: async (a, b) => { files.set(b, files.get(a) ?? ""); files.delete(a); },
    readFile: async (p) => { const v = files.get(p); if (v === undefined) throw new Error("ENOENT"); return v; },
    unlink: async () => { throw new Error("EBUSY"); },
  };
  const file = join("made-up", "worktrees", "scan.claim");
  assert.equal(await writeClaim(file, FIRST, NOW, fs), true);
  await assert.doesNotReject(() => dropClaim(file, FIRST, fs));
  assert.deepEqual(await readClaim(file, fs), { at: NOW, pid: FIRST });
});

test("an expired claim is still read, no longer holds, and the next window writes over it", async (t) => {
  const file = claimFile(t);
  await writeClaim(file, FIRST, NOW - CLAIM_MS);
  const old = await readClaim(file);
  assert.deepEqual(old, { at: NOW - CLAIM_MS, pid: FIRST });
  const state = { now: NOW, on: true, visible: true, running: false, forced: false, intervalMs: 15 * MIN };
  assert.deepEqual(scanDue({ ...state, claimAt: old?.at }), { due: true, reason: "no-cache" });
  // One millisecond younger and it holds
  await writeClaim(file, FIRST, NOW - CLAIM_MS + 1);
  assert.deepEqual(scanDue({ ...state, claimAt: (await readClaim(file))?.at }), { due: false, reason: "claimed" });
  assert.equal(await writeClaim(file, SECOND, NOW), true);
  assert.deepEqual(await readClaim(file), { at: NOW, pid: SECOND });
});

test("takeClaim: a window alone keeps its claim, and waits before it reads it back", async (t) => {
  const file = claimFile(t);
  const waited: number[] = [];
  assert.equal(await takeClaim(file, FIRST, NOW, undefined, async (ms) => { waited.push(ms); }), true);
  assert.deepEqual(waited, [CLAIM_SETTLE_MS]);
  assert.deepEqual(await readClaim(file), { at: NOW, pid: FIRST });
});

test("takeClaim: a second window that writes during the wait wins, and the first does not scan", async (t) => {
  const file = claimFile(t);
  // The other window's write lands between this window's write and its read-back
  const first = await takeClaim(file, FIRST, NOW, undefined, async () => { await writeClaim(file, SECOND, NOW + 1); });
  assert.equal(first, false);
  assert.deepEqual(await readClaim(file), { at: NOW + 1, pid: SECOND });
});

test("takeClaim: two windows starting within milliseconds, on the real file and the real wait, give exactly one scan", async (t) => {
  const file = claimFile(t);
  const [a, b] = await Promise.all([takeClaim(file, FIRST, NOW), takeClaim(file, SECOND, NOW + 1)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const held = await readClaim(file);
  assert.equal(held?.pid, a ? FIRST : SECOND);
});

test("takeClaim: a claim that cannot be written is not taken, and nothing is waited for", async (t) => {
  const file = claimFile(t);
  const broken = { mkdir: async () => { throw new Error("EACCES"); }, writeFile: async () => undefined, rename: async () => undefined, readFile: async () => "" };
  let waited = false;
  assert.equal(await takeClaim(file, FIRST, NOW, broken, async () => { waited = true; }), false);
  assert.equal(waited, false);
});

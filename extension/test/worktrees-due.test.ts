import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  CLAIM_FILE, CLAIM_MS, FAIL_WAIT_MS, claimPathFor, decodeClaim, encodeClaim, parallelOf, perRepoSecondsOf, scanDue, scanMinutesOf, type DueState,
} from "../src/worktrees/due.ts";

const MIN = 60_000;
const NOW = 1_000 * MIN;
const INTERVAL = 15 * MIN;

/** A window showing the panel, block on, nothing running, a cache one hour old, no claim: a scan is due. */
const state = (over: Partial<DueState> = {}): DueState => ({
  now: NOW, on: true, visible: true, running: false, forced: false, cacheScannedAt: NOW - 60 * MIN, intervalMs: INTERVAL, ...over,
});

test("a cache older than the interval means scan", () => {
  assert.deepEqual(scanDue(state()), { due: true, reason: "interval" });
  assert.deepEqual(scanDue(state({ cacheScannedAt: NOW - INTERVAL })), { due: true, reason: "interval" });
});

test("a second request while one runs is dropped", () => {
  assert.deepEqual(scanDue(state({ running: true })), { due: false, reason: "running" });
});

test("a cache younger than the interval means no scan", () => {
  assert.deepEqual(scanDue(state({ cacheScannedAt: NOW - INTERVAL + 1 })), { due: false, reason: "fresh" });
});

test("another window's fresh claim means no scan", () => {
  assert.deepEqual(scanDue(state({ claimAt: NOW - MIN })), { due: false, reason: "claimed" });
  // No cache yet and another window is on its first scan
  assert.deepEqual(scanDue(state({ cacheScannedAt: undefined, claimAt: NOW - MIN })), { due: false, reason: "claimed" });
  // One millisecond short of the limit still holds
  assert.deepEqual(scanDue(state({ claimAt: NOW - CLAIM_MS + 1 })), { due: false, reason: "claimed" });
});

test("a stale claim is taken over", () => {
  assert.deepEqual(scanDue(state({ claimAt: NOW - CLAIM_MS })), { due: true, reason: "interval" });
  assert.deepEqual(scanDue(state({ cacheScannedAt: undefined, claimAt: NOW - CLAIM_MS - MIN })), { due: true, reason: "no-cache" });
});

test("a claim the cache has since overtaken is a finished scan, not a running one", () => {
  // The claim was left behind; the cache written after it is fresh, so the interval decides
  assert.deepEqual(scanDue(state({ claimAt: NOW - 2 * MIN, cacheScannedAt: NOW - MIN })), { due: false, reason: "fresh" });
  assert.deepEqual(scanDue(state({ claimAt: NOW - 2 * MIN, cacheScannedAt: NOW - MIN, forced: true })), { due: true, reason: "forced" });
});

test("a claim dated in the future is damaged and does not hold", () => {
  assert.deepEqual(scanDue(state({ claimAt: NOW + MIN })), { due: true, reason: "interval" });
});

test("Refresh skips the interval", () => {
  assert.deepEqual(scanDue(state({ forced: true, cacheScannedAt: NOW - 1 })), { due: true, reason: "forced" });
});

test("Refresh does not skip the running check or another window's fresh claim", () => {
  assert.deepEqual(scanDue(state({ forced: true, running: true })), { due: false, reason: "running" });
  assert.deepEqual(scanDue(state({ forced: true, claimAt: NOW - MIN })), { due: false, reason: "claimed" });
});

test("a window whose panel is not visible never scans, Refresh or not", () => {
  assert.deepEqual(scanDue(state({ visible: false })), { due: false, reason: "hidden" });
  assert.deepEqual(scanDue(state({ visible: false, forced: true, cacheScannedAt: undefined })), { due: false, reason: "hidden" });
});

test("the block setting off means no scan, Refresh or not", () => {
  assert.deepEqual(scanDue(state({ on: false })), { due: false, reason: "off" });
  assert.deepEqual(scanDue(state({ on: false, forced: true, cacheScannedAt: undefined })), { due: false, reason: "off" });
});

test("no cache at all means scan", () => {
  assert.deepEqual(scanDue(state({ cacheScannedAt: undefined })), { due: true, reason: "no-cache" });
});

test("a scan that failed is not tried again for five minutes, with a cache or without one", () => {
  const failed = { lastFailed: true, lastAttemptAt: NOW - MIN };
  assert.deepEqual(scanDue(state(failed)), { due: false, reason: "failed" });
  assert.deepEqual(scanDue(state({ ...failed, cacheScannedAt: undefined })), { due: false, reason: "failed" });
  // One millisecond short of the wait still holds; at the wait it is tried again
  assert.deepEqual(scanDue(state({ lastFailed: true, lastAttemptAt: NOW - FAIL_WAIT_MS + 1 })), { due: false, reason: "failed" });
  assert.deepEqual(scanDue(state({ lastFailed: true, lastAttemptAt: NOW - FAIL_WAIT_MS })), { due: true, reason: "interval" });
  // A scan that worked sets no wait, and neither does an attempt dated in the future
  assert.deepEqual(scanDue(state({ lastFailed: false, lastAttemptAt: NOW - MIN })), { due: true, reason: "interval" });
  assert.deepEqual(scanDue(state({ lastFailed: true, lastAttemptAt: NOW + MIN })), { due: true, reason: "interval" });
});

test("Refresh skips the wait after a failed scan, never a running scan or another window's fresh claim", () => {
  const failed = { lastFailed: true, lastAttemptAt: NOW - MIN, forced: true };
  assert.deepEqual(scanDue(state(failed)), { due: true, reason: "forced" });
  assert.deepEqual(scanDue(state({ ...failed, cacheScannedAt: undefined })), { due: true, reason: "no-cache" });
  assert.deepEqual(scanDue(state({ ...failed, running: true })), { due: false, reason: "running" });
  assert.deepEqual(scanDue(state({ ...failed, claimAt: NOW - MIN })), { due: false, reason: "claimed" });
});

test("the claim limit can be passed in", () => {
  assert.deepEqual(scanDue(state({ claimAt: NOW - 2 * MIN, claimMs: MIN })), { due: true, reason: "interval" });
});

test("a claim round-trips, and damaged text is no claim", () => {
  assert.deepEqual(decodeClaim(encodeClaim(123, 456)), { at: 123, pid: 456 });
  for (const bad of ["", "{", "null", "[]", "42", '{"at":"1","pid":2}', '{"at":1}', '{"pid":2}', '{"at":null,"pid":2}']) {
    assert.equal(decodeClaim(bad), undefined, bad);
  }
});

test("the claim sits beside the cache", () => {
  assert.equal(claimPathFor(join("work", "questlog", "worktrees", "scan.cache")), join("work", "questlog", "worktrees", CLAIM_FILE));
});

test("the interval setting is 15 minutes by default and never under 5", () => {
  assert.equal(scanMinutesOf(undefined), 15);
  assert.equal(scanMinutesOf("30"), 15);
  assert.equal(scanMinutesOf(Number.NaN), 15);
  assert.equal(scanMinutesOf(30), 30);
  assert.equal(scanMinutesOf(5), 5);
  assert.equal(scanMinutesOf(1), 5);
  assert.equal(scanMinutesOf(0), 5);
  assert.equal(scanMinutesOf(-3), 5);
});

test("the scan limits default to one at a time and 20 seconds and refuse nonsense", () => {
  assert.equal(parallelOf(undefined), 1);
  assert.equal(parallelOf(0), 1);
  assert.equal(parallelOf(-2), 1);
  assert.equal(parallelOf(6), 6);
  assert.equal(parallelOf(6.9), 6);
  assert.equal(perRepoSecondsOf(undefined), 20);
  assert.equal(perRepoSecondsOf(0), 20);
  assert.equal(perRepoSecondsOf(-1), 20);
  assert.equal(perRepoSecondsOf(120), 120);
});

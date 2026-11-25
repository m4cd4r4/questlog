// The text the CLI and the panel both print: the count line, the PR, last-commit and size facts, the name order.
import assert from "node:assert/strict";
import { test } from "node:test";
import { byName, countText, lastCommitText, ORDER, prText, ROW_ORDER, rowVerdict, sizeFact, type RowVerdict } from "../src/worktrees/listing.ts";
import { scannedRepo, scannedWt } from "./worktrees-fixtures.ts";

const PANEL_ORDER: readonly RowVerdict[] = ["closable", "needs-you", "busy", "in-flight", "orphan", "missing", "unread"];
const MIN = 60_000, DAY = 24 * 60 * MIN, MB = 1024 * 1024;
const NOW = Date.UTC(2026, 0, 10);

/** Three worktrees of one repo in one parent folder: A needs you, B is in flight, C is closable. */
const three = () => scannedRepo("/work/acme-app", [
  scannedWt("/work/acme-app", "main", { main: true }),
  scannedWt("/work/acme-app-feature-a", "feat/a", { dirty: 2, changed: 2 }),
  scannedWt("/work/acme-app-feature-b", "feat/b", { pr: { state: "open", number: 12 } }),
  scannedWt("/work/acme-app-feature-c", "feat/c", { pr: { state: "merged", number: 9 } }),
]);
const linked = (r: ReturnType<typeof three>) => r.worktrees.filter((w) => !w.main).map(rowVerdict);

test("countText: three worktrees of one repo in one folder, counted in the order passed in", () => {
  const verdicts = linked(three());
  assert.deepEqual(verdicts, ["needs-you", "in-flight", "closable"]);
  assert.equal(countText(verdicts, ROW_ORDER), "3 worktrees: 1 needs you, 1 in flight, 1 closable");
  assert.equal(countText(verdicts, PANEL_ORDER), "3 worktrees: 1 closable, 1 needs you, 1 in flight");
});

test("countText: one reads \"1 worktree\" and \"1 needs you\", several read \"need you\"", () => {
  assert.equal(countText(["needs-you"], ROW_ORDER), "1 worktree: 1 needs you");
  assert.equal(countText(["needs-you", "needs-you", "needs-you", "needs-you"], ROW_ORDER), "4 worktrees: 4 need you");
  assert.equal(countText(["busy", "busy", "orphan", "missing", "closable", "closable"], PANEL_ORDER), "6 worktrees: 2 closable, 2 busy, 1 orphan, 1 missing");
});

test("countText: a timed-out repo's line ends \"(timed out)\" and its unread worktrees are counted as not read yet", () => {
  const r = scannedRepo("/work/acme-app", [
    scannedWt("/work/acme-app", "main", { main: true }),
    scannedWt("/work/acme-app-feature-a", "feat/a", { dirty: 1, changed: 1 }),
    scannedWt("/work/acme-app-feature-b", "feat/b", { unread: true }),
    scannedWt("/work/acme-app-feature-c", "feat/c", { unread: true }),
  ], { timedOut: true });
  assert.equal(countText(linked(r), ROW_ORDER, r.timedOut === true), "3 worktrees: 1 needs you, 2 not read yet (timed out)");
  assert.equal(countText(linked(r), PANEL_ORDER, true), "3 worktrees: 1 needs you, 2 not read yet (timed out)");
});

test("countText: a zero is left out, and no rows gives the count alone", () => {
  assert.equal(countText([], ROW_ORDER), "0 worktrees");
  assert.equal(countText([], ROW_ORDER, true), "0 worktrees (timed out)");
});

test("rowVerdict: the scanner's verdict, or unread for a worktree the scan did not reach or gave no verdict", () => {
  assert.equal(rowVerdict(scannedWt("/work/acme-app-feature-a", "feat/a", { pr: { state: "merged", number: 3 } })), "closable");
  assert.equal(rowVerdict(scannedWt("/work/acme-app-feature-b", "feat/b", { unread: true })), "unread");
  assert.equal(rowVerdict(scannedWt("/work/acme-app", "main", { main: true })), "unread");
  assert.deepEqual(ROW_ORDER, [...ORDER, "unread"]);
});

test("prText: number and state, the number's lead passed in; nothing for no PR or an unknown state", () => {
  assert.equal(prText({ state: "open", number: 12 }), "#12 open");
  assert.equal(prText({ state: "merged", number: 12 }, "PR #"), "PR #12 merged");
  assert.equal(prText({ state: "closed" }), "PR closed");
  assert.equal(prText({ state: "closed" }, "PR #"), "PR closed");
  assert.equal(prText({ state: "none" }), undefined);
  assert.equal(prText({ state: "unknown" }), undefined);
  assert.equal(prText(undefined), undefined);
});

test("lastCommitText: \"just now\" under a minute, else the age and \"ago\"; nothing when the time was not read", () => {
  assert.equal(lastCommitText(NOW - 10_000, NOW), "just now");
  assert.equal(lastCommitText(NOW - 3 * DAY, NOW), "3d ago");
  assert.equal(lastCommitText(NOW - 5 * MIN, NOW), "5m ago");
  assert.equal(lastCommitText(undefined, NOW), undefined);
  assert.equal(lastCommitText("unknown", NOW), undefined);
});

test("sizeFact: the size, with \", shares node_modules\" when it does; nothing when unmeasured or unknown", () => {
  assert.equal(sizeFact({ bytes: 340 * MB, measuredAt: NOW, key: "k" }), "340 MB");
  assert.equal(sizeFact({ bytes: 1536, measuredAt: NOW, key: "k", sharesNodeModules: true }), "1.5 KB, shares node_modules");
  assert.equal(sizeFact("unknown"), undefined);
  assert.equal(sizeFact(undefined), undefined);
});

test("byName: names sort without regard to letter case, and equal names keep their place", () => {
  assert.deepEqual(["acme-b", "Acme-a", "acme-C"].sort(byName), ["Acme-a", "acme-b", "acme-C"]);
  assert.equal(byName("Acme", "acme"), 0);
  assert.equal(byName("a", "b"), -1);
  assert.equal(byName("b", "a"), 1);
});

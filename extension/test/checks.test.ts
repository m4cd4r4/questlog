import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClose, closeFrom, CLOSED_BY_CHECK, withCloses, type Row } from "../src/rows.ts";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const row = (steps: Row["steps"], o: Partial<Row> = {}): Row => ({
  id: A, repo: "shop", where: "", plan: "Tidy worktrees", done: steps!.filter((s) => s.status === "done").length, total: steps!.length, now: "", updatedAt: NOW - 30 * MIN, reportedAt: NOW - 30 * MIN, cwd: "/work/shop", steps, ...o,
});
const onDisk = new Set(["/work/shop/dist/out.vsix"]);
const exists = (p: string) => onDisk.has(p);

test("checkClose closes a card only when every open step names a path that checks out, and says each path and its state", () => {
  const done = { text: "Write it", status: "done" as const };
  const built = { text: "Build the vsix", status: "todo" as const, check: { exists: "/work/shop/dist/out.vsix" } };
  const removed = { text: "Remove the worktree", status: "todo" as const, check: { gone: "/work/shop-old" } };

  const c = checkClose(row([done, built, removed]), NOW, exists);
  assert.ok(c);
  assert.equal(c.by, CLOSED_BY_CHECK);
  assert.equal(c.rowReportedAt, NOW - 30 * MIN);
  assert.deepEqual(c.steps, [
    { text: "Build the vsix", outcome: "finished", why: "/work/shop/dist/out.vsix exists" },
    { text: "Remove the worktree", outcome: "finished", why: "/work/shop-old gone" },
  ]);
  assert.equal(c.evidence, "/work/shop/dist/out.vsix exists; /work/shop-old gone");

  assert.equal(checkClose(row([done, built, { text: "Tell the team", status: "todo" }]), NOW, exists), undefined, "a step with no check cannot be checked off");
  assert.equal(checkClose(row([done, { ...built, check: { exists: "/work/shop/dist/missing.vsix" } }]), NOW, exists), undefined, "one failing check holds the card open");
  assert.equal(checkClose(row([done, { ...built, check: { gone: "/work/shop/dist/out.vsix" } }]), NOW, exists), undefined);
  assert.equal(checkClose(row([done, built], { done: 2, total: 2 }), NOW, exists), undefined, "nothing to close on a finished card");
  assert.equal(checkClose(row([done, built]), NOW, () => undefined), undefined, "a path that cannot be resolved is not a pass");
});

test("an undone check close neither closes the card nor lets the check close it again until its session reports", () => {
  const built = { text: "Build the vsix", status: "todo" as const, check: { exists: "/work/shop/dist/out.vsix" } };
  const r = row([built]);
  const prior = { ...checkClose(r, NOW - MIN, exists)!, undone: true };
  assert.equal(withCloses([r], new Map([[A, prior]]))[0].closed, undefined);
  assert.equal(checkClose(r, NOW, exists, prior), undefined);
  assert.ok(checkClose({ ...r, reportedAt: NOW }, NOW, exists, prior), "a new report arms the check again");
  assert.equal(closeFrom(JSON.stringify(prior))?.undone, true);
  assert.equal(closeFrom(JSON.stringify({ ...prior, steps: [{ text: "x", outcome: "maybe", why: "" }] })), undefined, "a close with a malformed step list is ignored");
});

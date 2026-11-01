import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, parseMessage } from "../src/model.ts";
import { GONE_MS, STALE_MS, type Row } from "../src/rows.ts";
import type { ParentPlan } from "../src/plans.ts";

const NOW = 10 * GONE_MS;
const row = (o: Partial<Row>): Row => ({ id: "x", repo: "r", where: "", plan: "Plan", done: 0, total: 0, now: "", updatedAt: NOW, ...o });
const input = (rows: Row[], extra: { plans?: ParentPlan[]; focusedId?: string } = {}) => ({ rows, plans: extra.plans ?? [], note: [], now: NOW, focusedId: extra.focusedId });

test("buildModel marks the focused live session here and opens it", () => {
  const m = buildModel(input([row({ id: "a", total: 2, done: 1, steps: [{ status: "now", text: "go" }, { status: "todo", text: "later" }] }), row({ id: "b" })], { focusedId: "a" }));
  const cards = m.groups.flatMap((g) => g.cards);
  assert.equal(cards.find((c) => c.id === "a")?.state, "here");
  assert.equal(cards.find((c) => c.id === "a")?.open, true);
  assert.equal(cards.find((c) => c.id === "b")?.state, "run");
  assert.deepEqual(m.summary, { sessions: 2, here: 1, running: 1, waiting: 0, held: 0, idle: 0 });
});

const withLive = (rows: Row[], live: Map<string, { status: "busy" | "idle" | "waiting"; waitingFor?: string }> | undefined, focusedId?: string) =>
  buildModel({ ...input(rows, { focusedId }), live }).groups.flatMap((g) => g.cards);

test("buildModel shows a session waiting on the user as needs-you, with why", () => {
  const [c] = withLive([row({ id: "a", total: 2, done: 1 })], new Map([["a", { status: "waiting", waitingFor: "permission prompt" }]]));
  assert.equal(c.state, "wait");
  assert.equal(c.now, "Needs you: permission prompt");
});

test("buildModel marks unfinished a fresh unfinished row whose process is gone, and idles a finished one", () => {
  const [open, done] = withLive([row({ id: "a", total: 2, done: 1 }), row({ id: "b", total: 2, done: 2 })], new Map([["z", { status: "busy" }]]));
  assert.equal(open.state, "held");
  assert.match(open.age, /^unfinished /);
  assert.equal(done.state, "idle");
});

test("buildModel uses the files alone when the live list could not be read", () => {
  const [c] = withLive([row({ id: "a", total: 2, done: 1 })], undefined);
  assert.equal(c.state, "run");
});

test("buildModel keeps the focused tab as here even while it waits", () => {
  const [c] = withLive([row({ id: "a", total: 2, done: 1 })], new Map([["a", { status: "waiting", waitingFor: "input needed" }]]), "a");
  assert.equal(c.state, "here");
});

test("buildModel carries the step in progress for a collapsed card, none when idle", () => {
  const steps = [{ status: "done" as const, text: "a" }, { status: "now" as const, text: "b" }];
  const live = buildModel(input([row({ id: "a", total: 2, done: 1, steps })])).groups[0].cards[0];
  assert.equal(live.now, "b");
  const idle = buildModel(input([row({ id: "a", total: 2, done: 1, steps, updatedAt: NOW - STALE_MS })])).groups[0].cards[0];
  assert.equal(idle.now, "");
});

test("buildModel shows a stale finished session as idle, never here, even when focused", () => {
  const m = buildModel(input([row({ id: "a", total: 3, done: 3, updatedAt: NOW - STALE_MS })], { focusedId: "a" }));
  const c = m.groups[0].cards[0];
  assert.equal(c.state, "idle");
  assert.equal(c.open, false);
  assert.match(c.age, /^idle /);
});

test("buildModel shows a stale unfinished session as held and paused", () => {
  const m = buildModel(input([row({ id: "a", total: 3, done: 1, updatedAt: NOW - 3 * GONE_MS })], { focusedId: "a" }));
  const c = m.groups[0].cards[0];
  assert.equal(c.state, "held");
  assert.match(c.age, /^unfinished /);
  assert.equal(c.open, false);
});

test("buildModel shows a stale session with no steps as idle, not paused", () => {
  const c = buildModel(input([row({ id: "a", total: 0, updatedAt: NOW - 3 * STALE_MS })])).groups[0].cards[0];
  assert.equal(c.state, "idle");
});

test("buildModel summary counts session cards only, plans excluded", () => {
  const plan: ParentPlan = { name: "Big", repo: "r", slices: [{ name: "s", state: "held" } as never] };
  const m = buildModel(input([row({ id: "a" })], { plans: [plan] }));
  assert.equal(m.summary.sessions, 1);
  assert.ok(m.summary.held + m.summary.running + m.summary.here + m.summary.idle <= 1);
});

test("buildModel shows a blocked slice as blocked, and a plan with only blocked slices as held", () => {
  const plan: ParentPlan = { name: "Big", repo: "r", slices: [{ name: "a", slug: "a", state: "blocked" } as never, { name: "b", slug: "b", state: "done" } as never] };
  const card = buildModel(input([], { plans: [plan] })).groups[0].cards[0];
  assert.equal(card.state, "held");
  assert.equal(card.steps[0].status, "blocked");
});

test("buildModel marks a finished session done", () => {
  const m = buildModel(input([row({ total: 3, done: 3 })]));
  assert.equal(m.groups[0].cards[0].state, "done");
});

test("buildModel gives a plan with no session its own repo group", () => {
  const plan: ParentPlan = { name: "Big job", repo: "other", slices: [] };
  const m = buildModel(input([row({ repo: "r" })], { plans: [plan] }));
  assert.deepEqual(m.groups.map((g) => g.repo).sort(), ["other", "r"]);
});

test("buildModel gives a working slice both a copyable resume and an open-worktree path", () => {
  const plan: ParentPlan = { name: "Big job", repo: "r", slices: [
    { slug: "a", label: "a", wave: "1", state: "working", why: "building", resume: "I:/wt/a", worktree: "I:/wt/a" },
    { slug: "b", label: "b", wave: "1", state: "ready", why: "next", resume: "mint b", worktree: "" },
  ] };
  const steps = buildModel(input([row({ repo: "r" })], { plans: [plan] })).groups[0].cards.find((c) => c.kind === "plan")!.steps;
  assert.equal(steps[0].worktree, "I:/wt/a");
  assert.equal(steps[1].worktree, undefined);
  assert.equal(steps[1].resume, "mint b");
});

test("parseMessage accepts known shapes and drops the rest", () => {
  assert.deepEqual(parseMessage({ type: "ready" }), { type: "ready" });
  assert.deepEqual(parseMessage({ type: "details", id: "a" }), { type: "details", id: "a" });
  assert.deepEqual(parseMessage({ type: "copyResume", text: "cmd" }), { type: "copyResume", text: "cmd" });
  assert.deepEqual(parseMessage({ type: "openWorktree", path: "C:/w" }), { type: "openWorktree", path: "C:/w" });
  assert.deepEqual(parseMessage({ type: "dismiss", id: "a" }), { type: "dismiss", id: "a" });
  assert.equal(parseMessage({ type: "dismiss" }), undefined);
  assert.equal(parseMessage({ type: "openWorktree" }), undefined);
  assert.equal(parseMessage({ type: "details" }), undefined);
  assert.equal(parseMessage({ type: "copyResume", text: "" }), undefined);
  assert.equal(parseMessage({ type: "nope" }), undefined);
  assert.equal(parseMessage(null), undefined);
});

test("only a paused session with a folder and a real session ID can be resumed from the page", () => {
  const sid = "9d0182ef-186f-4137-b7ce-baa6e9209bcb";
  const old = NOW - STALE_MS - 1;
  const m = buildModel(input([
    row({ id: sid, total: 3, done: 1, cwd: "D:/code/demo-shop", updatedAt: old }),
    row({ id: "live", total: 3, done: 1, cwd: "D:/code/demo-shop" }),
  ]));
  const cards = m.groups.flatMap((g) => g.cards);
  assert.equal(cards.find((c) => c.id === sid)?.canResume, true);
  assert.equal(cards.find((c) => c.id === "live")?.canResume, false);
});

test("an amber card always offers the button: a recent session whose process ended has it, a running one does not", () => {
  const closed = "9d0182ef-186f-4137-b7ce-baa6e9209bcb";
  const running = "1a2b3c4d-186f-4137-b7ce-baa6e9209bcb";
  const cards = withLive([
    row({ id: closed, total: 3, done: 1, cwd: "D:/code/demo-shop" }),
    row({ id: running, total: 3, done: 1, cwd: "D:/code/demo-shop" }),
  ], new Map([[running, { status: "busy" }]]));
  const closedCard = cards.find((c) => c.id === closed);
  assert.equal(closedCard?.state, "held");
  assert.equal(closedCard?.canResume, true);
  assert.equal(cards.find((c) => c.id === running)?.canResume, false);
});

test("parseMessage takes copySessionResume with a session ID only", () => {
  assert.deepEqual(parseMessage({ type: "copySessionResume", id: "a" }), { type: "copySessionResume", id: "a" });
  assert.equal(parseMessage({ type: "copySessionResume" }), undefined);
});

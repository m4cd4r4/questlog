import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pageHtml } from "../src/webview.ts";

// Just enough DOM for the sidebar script to draw: elements with children, a class and text.
class El {
  className = ""; style = { cssText: "" }; nodeType = 1; children: any[] = []; attrs: Record<string, string> = {};
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...k: any[]) { this.children.push(...k); }
  replaceChildren(...k: any[]) { this.children = k; }
  setAttribute(n: string, v: string) { this.attrs[n] = String(v); }
  addEventListener() {}
  contains() { return false; }
  querySelectorAll() { return []; }
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
}

const walk = (e: any): El[] => [e, ...e.children.filter((c: any) => typeof c !== "string").flatMap(walk)];

function draw(model: unknown, state: unknown = {}) {
  return walk(render(model, state)).filter((e) => e.className === "empty").map((e) => e.textContent);
}

function render(model: unknown, state: unknown = {}) {
  const root = new El("div");
  const script = pageHtml("n", "csp").match(/<script nonce="n">([\s\S]*)<\/script>/)![1];
  const listeners: Record<string, (e: unknown) => void> = {};
  const document = {
    createElement: (t: string) => new El(t), createElementNS: (_: string, t: string) => new El(t),
    createTextNode: (s: string) => s, getElementById: () => root, activeElement: null, addEventListener() {},
  };
  const window = { addEventListener: (n: string, f: (e: unknown) => void) => { listeners[n] = f; } };
  vm.runInNewContext(script, { document, window, acquireVsCodeApi: () => ({ getState: () => state, setState() {}, postMessage() {} }) });
  listeners.message({ data: { type: "model", model } });
  return root;
}

const card = (id: string) => ({ id, kind: "session", state: "run", title: id, age: "1m", steps: [], total: 0, done: 0, held: 0, now: "", where: "", open: false });

test("a closed card names who closed it and offers undo; closed tabs wait behind one line until it is opened", () => {
  const summary = { sessions: 1, here: 0, running: 0, waiting: 0, held: 0, idle: 1 };
  const closed = { ...card("a"), state: "closed", age: "closed 5m", closedBy: { tag: "bbbbbb", plan: "Tidy worktrees", evidence: "Worktree gone" } };
  const groups = [{ repo: "shop", cards: [closed], ended: [{ ...card("hidden"), state: "held" }, { ...card("hidden2"), state: "held" }] }];
  const shut = walk(render({ summary, groups, note: [] }));
  assert.ok(shut.some((e) => e.className === "closedline" && e.textContent === "Closed by bbbbbb Tidy worktrees: Worktree gone"));
  assert.ok(shut.some((e) => e.attrs["aria-label"] === "Undo close"));
  assert.ok(shut.some((e) => e.className === "endedline" && e.textContent === "2 tabs closed with steps left"));
  assert.ok(!shut.some((e) => e.textContent === "hidden"));
  const open = walk(render({ summary, groups, note: [] }, { open: ["e:shop"] }));
  assert.ok(open.some((e) => e.textContent === "hidden"));
});
test("an unfinished card offers Close; a card closed from the panel or by a check says so without a plan, and a not-needed step shows its reason", () => {
  const summary = { sessions: 2, here: 0, running: 0, waiting: 0, held: 1, idle: 1 };
  const open = { ...card("a"), state: "held", age: "unfinished 2h", total: 3, done: 1, steps: [{ status: "done", text: "one" }, { status: "todo", text: "two" }] };
  const byHand = {
    ...card("b"), state: "closed", age: "closed 5m", total: 2, done: 2, closedBy: { tag: "you", plan: "", evidence: "two: the team was on the call" },
    steps: [{ status: "done", text: "one" }, { status: "not needed", text: "two", detail: "the team was on the call" }],
  };
  const byCheck = { ...card("c"), state: "closed", age: "closed 1m", total: 1, done: 1, closedBy: { tag: "check", plan: "", evidence: "/work/shop-old gone" }, steps: [{ status: "done", text: "one", detail: "/work/shop-old gone" }] };
  const els = walk(render({ summary, groups: [{ repo: "shop", cards: [open, byHand, byCheck], ended: [] }], note: [] }, { seen: ["c:b"], open: ["c:b"] }));
  const closeButtons = els.filter((e) => e.attrs["aria-label"] === "Close");
  assert.equal(closeButtons.length, 1, "only the unfinished card offers Close");
  assert.ok(els.some((e) => e.className === "closedline" && e.textContent === "Closed by you: two: the team was on the call"));
  assert.ok(els.some((e) => e.className === "closedline" && e.textContent === "Closed by check: /work/shop-old gone"));
  const dropped = els.find((e) => e.className.startsWith("step not needed"));
  assert.ok(dropped, "the not-needed step is drawn as its own kind");
  assert.ok(walk(dropped).some((e) => e.className === "s-more" && e.textContent === "Not needed"));
  assert.ok(walk(dropped).some((e) => e.className === "detail" && e.textContent === "the team was on the call"));
});

const summary = { sessions: 2, here: 0, running: 2, held: 0, idle: 0 };

test("collapsed repo groups with sessions in them do not show the empty state", () => {
  const model = { summary, note: [], groups: [{ repo: "a", cards: [card("1")] }, { repo: "b", cards: [card("2")] }] };
  assert.deepEqual(draw(model, { closed: ["g:a", "g:b"] }), []);
});

test("the empty state still shows when the filter leaves no session", () => {
  const model = { summary, note: [], groups: [{ repo: "a", cards: [card("1")] }] };
  assert.deepEqual(draw(model, { filter: "held" }), ["Nothing here right now."]);
});

test("the header count says session for one and sessions otherwise", () => {
  const head = (n: number) => walk(render({ summary: { ...summary, sessions: n }, note: [], groups: [] })).find((e) => e.className === "s-top")!.children[0].textContent;
  assert.equal(head(1), "1 session");
  assert.equal(head(2), "2 sessions");
  assert.equal(head(0), "0 sessions");
});

test("the empty state still shows when there are no groups", () => {
  assert.equal(draw({ summary: { ...summary, sessions: 0 }, note: [], groups: [] }).length, 1);
});

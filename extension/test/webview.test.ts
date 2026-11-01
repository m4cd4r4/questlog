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

// The Worktrees block on the page: rows as worktrees/view.ts builds them, sent as model.ts sends them (the first
// ten that are not Closable, the rest counted and sent on request), drawn after a group's cards and before its
// ended line. Also the plan card steps that take live slice facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pageHtml } from "../src/webview.ts";

// Just enough DOM for the sidebar script to draw, with clicks.
class El {
  className = ""; style = { cssText: "" }; nodeType = 1; children: any[] = []; attrs: Record<string, string> = {};
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...k: any[]) { this.children.push(...k); }
  replaceChildren(...k: any[]) { this.children = k; }
  setAttribute(n: string, v: string) { this.attrs[n] = String(v); }
  handlers: Record<string, (e: unknown) => void> = {};
  addEventListener(n: string, f: (e: unknown) => void) { this.handlers[n] = f; }
  click() { this.handlers.click?.({ stopPropagation() {}, target: this }); }
  contains() { return false; }
  querySelectorAll() { return []; }
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
}

const walk = (e: any): El[] => [e, ...e.children.filter((c: any) => c && typeof c !== "string").flatMap(walk)];

type Page = El & { send: (data: unknown) => void; answer: () => void };

/**
 * Draws `model` with the page state `state`. `rowsOf` plays the host for worktreeRows: `answer()` replies to
 * every request posted so far with the rows it gives for that repo path.
 */
function render(model: unknown, state: unknown = {}, posts: any[] = [], rowsOf: (repoPath: string) => unknown[] | undefined = () => undefined): Page {
  const root = new El("div") as Page;
  const script = pageHtml("n", "csp").match(/<script nonce="n">([\s\S]*)<\/script>/)![1];
  const listeners: Record<string, (e: unknown) => void> = {};
  const document = {
    createElement: (t: string) => new El(t), createElementNS: (_: string, t: string) => new El(t),
    createTextNode: (s: string) => s, getElementById: () => root, activeElement: null, addEventListener() {},
  };
  const window = { addEventListener: (n: string, f: (e: unknown) => void) => { listeners[n] = f; } };
  vm.runInNewContext(script, { document, window, acquireVsCodeApi: () => ({ getState: () => state, setState() {}, postMessage(m: unknown) { posts.push(JSON.parse(JSON.stringify(m))); } }) });
  root.send = (data: unknown) => listeners.message({ data });
  let answered = 0;
  root.answer = () => {
    while (answered < posts.length) {
      const m = posts[answered++];
      const rows = m.type === "worktreeRows" ? rowsOf(m.repoPath) : undefined;
      if (rows) root.send({ type: "worktreeRows", repoPath: m.repoPath, rows });
    }
  };
  root.send({ type: "model", model });
  return root;
}

const summary = { sessions: 1, here: 0, running: 1, waiting: 0, held: 0, idle: 0 };
const card = (id: string) => ({ id, kind: "session", state: "run", title: id, age: "1m", steps: [], total: 0, done: 0, held: 0, now: "", where: "", open: false });
const wt = (slug: string, verdict = "needs-you", over: Record<string, unknown> = {}) => ({
  path: `/work/${slug}`, slug, short: slug.startsWith("acme-app-") && slug.length > 9 ? slug.slice(9) : slug, verdict,
  label: verdict === "needs-you" ? "needs you" : verdict.replace("-", " "), reason: `why ${slug}`, age: "3d", size: "1.2 MB", facts: [`branch feat/${slug}`], canOpen: true, ...over,
});
/** A block as the model sends it, from all of its rows. */
const block = (all: { verdict: string }[], over: Record<string, unknown> = {}) => {
  const rest = all.filter((r) => r.verdict !== "closable");
  return { repoPath: "/work/acme-app", count: `${all.length} worktrees`, rows: rest.slice(0, 10), more: Math.max(0, rest.length - 10), closable: all.length - rest.length, ...over };
};
const withBlock = (all: any[], cards: unknown[] = [card("1")], over: Record<string, unknown> = {}, ended: unknown[] = []) =>
  ({ summary, note: [], worktreeNote: "", worktreeScanAt: 1, groups: [{ repo: "acme-app", cards, ended, worktrees: [block(all, over)] }] });
const byClass = (root: El, cls: string) => walk(root).filter((e) => e.className.split(" ").includes(cls));
const rowSlugs = (root: El) => byClass(root, "wt").map((e) => e.children.find((c: any) => c && c.className === "t")!.attrs.title);
const buttons = (row: El) => walk(row).filter((e) => e.tag === "button").map((e) => e.attrs.title);
const host = (all: unknown[]) => (p: string) => (p === "/work/acme-app" ? all : undefined);

test("the block sits after the group's session cards and before its ended line", () => {
  const ended = [{ ...card("gone"), state: "held" }];
  const root = render(withBlock([wt("acme-app-feature-a")], [card("1")], { count: "32 worktrees: 21 closable, 4 need you" }, ended));
  const head = byClass(root, "wt-head");
  assert.equal(head.length, 1);
  assert.equal(head[0].textContent, "Worktrees32 worktrees: 21 closable, 4 need you");
  const order = walk(root).map((e) => e.className.split(" ")[0]).filter((c) => c === "card" || c === "wt-head" || c === "endedline");
  assert.deepEqual(order, ["card", "wt-head", "card", "endedline"], "session card, then the block's line and its row, then the ended line");
  assert.deepEqual(byClass(root, "wt-path"), [], "one block in the group: no path heading");
});

test("closable rows are absent until N closable is opened, then asked of the host and drawn", () => {
  const all = [wt("acme-app-feature-a"), wt("acme-app-feature-b", "closable"), wt("acme-app-feature-c", "closable")];
  const posts: any[] = [];
  const root = render(withBlock(all), {}, posts, host(all));
  assert.deepEqual(rowSlugs(root), ["acme-app-feature-a"]);
  const tog = byClass(root, "wt-tog");
  assert.deepEqual(tog.map((e) => e.textContent), ["2 closable"]);
  assert.equal(tog[0].attrs["aria-expanded"], "false");
  assert.equal(posts.some((m) => m.type === "worktreeRows"), false, "nothing is asked for before a click");
  tog[0].click();
  assert.deepEqual(posts.filter((m) => m.type === "worktreeRows"), [{ type: "worktreeRows", repoPath: "/work/acme-app" }]);
  root.answer();
  assert.deepEqual(rowSlugs(root), ["acme-app-feature-a", "acme-app-feature-b", "acme-app-feature-c"]);
});

test("a block opened from saved state asks once, and asks again only for a new scan", () => {
  const all = [wt("acme-app-feature-a"), wt("acme-app-feature-b", "closable")];
  const posts: any[] = [];
  const root = render(withBlock(all), { open: ["wc:/work/acme-app"] }, posts, host(all));
  root.answer();
  assert.deepEqual(rowSlugs(root), ["acme-app-feature-a", "acme-app-feature-b"]);
  const asked = () => posts.filter((m) => m.type === "worktreeRows").length;
  assert.equal(asked(), 1);
  // The same scan posted again (a 30 s tick): the rows held are used, nothing is asked
  root.send({ type: "model", model: withBlock(all) });
  assert.equal(asked(), 1);
  assert.deepEqual(rowSlugs(root), ["acme-app-feature-a", "acme-app-feature-b"]);
  // A new scan: the old rows stay on show until the answer, and one request goes out
  root.send({ type: "model", model: { ...withBlock(all), worktreeScanAt: 2 } });
  assert.equal(asked(), 2);
  assert.deepEqual(rowSlugs(root), ["acme-app-feature-a", "acme-app-feature-b"]);
});

test("an opened worktree row shows the reason, then the facts", () => {
  const root = render(withBlock([wt("acme-app-feature-a"), wt("acme-app-feature-b")]));
  assert.deepEqual(byClass(root, "wt-x"), []);
  byClass(root, "wt")[0].click();
  const detail = byClass(root, "wt-x");
  assert.equal(detail.length, 1, "only the clicked row opens");
  assert.deepEqual(detail[0].children.filter(Boolean).map((c: any) => c.textContent), ["why acme-app-feature-a", "branch feat/acme-app-feature-a"]);
});

test("three worktrees of one repo in one folder: Open and Copy path post the clicked row's path, and no row offers a remove", () => {
  const posts: any[] = [];
  const root = render(withBlock([wt("acme-app-feature-a"), wt("acme-app-feature-b"), wt("acme-app-feature-c")]), {}, posts);
  const row = byClass(root, "wt")[1];
  assert.deepEqual(buttons(row), ["Open worktree", "Copy path"]);
  posts.length = 0;
  walk(row).find((e) => e.attrs.title === "Open worktree")!.click();
  walk(row).find((e) => e.attrs.title === "Copy path")!.click();
  assert.deepEqual(posts, [{ type: "openWorktree", path: "/work/acme-app-feature-b" }, { type: "copyPath", path: "/work/acme-app-feature-b" }]);
});

test("a missing row has no Open button", () => {
  const root = render(withBlock([wt("acme-app-feature-a", "missing", { canOpen: false })]));
  assert.deepEqual(buttons(byClass(root, "wt")[0]), ["Copy path"]);
});

test("the eleventh row is behind Show N more, and comes from the host", () => {
  const all = Array.from({ length: 13 }, (_, i) => wt(`acme-app-feature-${String(i + 1).padStart(2, "0")}`));
  const root = render(withBlock(all), {}, [], host(all));
  assert.equal(rowSlugs(root).length, 10);
  assert.ok(!rowSlugs(root).includes("acme-app-feature-11"));
  assert.deepEqual(byClass(root, "wt-tog").map((e) => e.textContent), ["Show 3 more"]);
  byClass(root, "wt-tog")[0].click();
  root.answer();
  assert.equal(rowSlugs(root).length, 13);
  assert.deepEqual(byClass(root, "wt-tog").map((e) => e.textContent), ["Show fewer"]);
});

test("the worktrees block is absent under the Active filter", () => {
  const root = render(withBlock([wt("acme-app-feature-a")]), { filter: "active" });
  assert.deepEqual(byClass(root, "wt-head"), []);
  assert.deepEqual(byClass(root, "wt"), []);
  assert.equal(byClass(root, "card").length, 1, "the session card still shows");
});

test("a group with only worktrees draws its block, no empty state and no 'no live session' chip", () => {
  const model = withBlock([wt("acme-app-feature-a")], []);
  const root = render(model);
  assert.deepEqual(byClass(root, "empty"), []);
  assert.equal(byClass(root, "wt-head").length, 1);
  assert.deepEqual(byClass(root, "chip").map((e) => e.textContent), []);
  assert.deepEqual(byClass(render(model, { filter: "active" }), "empty").map((e) => e.textContent), ["Nothing here right now."]);
});

test("a closed block shows its count line and no rows", () => {
  const root = render(withBlock([wt("acme-app-feature-a"), wt("acme-app-feature-b", "closable")]), { closed: ["wb:/work/acme-app"] });
  assert.equal(byClass(root, "wt-head")[0].attrs["aria-expanded"], "false");
  assert.deepEqual(byClass(root, "wt"), []);
  assert.deepEqual(byClass(root, "wt-tog"), []);
});

test("two repos of one name in a group are each headed by their path", () => {
  const model = { summary, note: [], worktreeNote: "", worktreeScanAt: 1, groups: [{ repo: "acme-app", cards: [], ended: [], worktrees: [block([wt("a")]), block([wt("b")], { repoPath: "/other/acme-app" })] }] };
  assert.deepEqual(byClass(render(model), "wt-path").map((e) => e.textContent), ["/work/acme-app", "/other/acme-app"]);
});

test("the worktree note is one line under the filter, and absent when empty", () => {
  const model = { ...withBlock([wt("acme-app-feature-a")]), worktreeNote: "Worktree scan is 30 hours old" };
  assert.deepEqual(byClass(render(model), "wt-note").map((e) => e.textContent), ["Worktree scan is 30 hours old"]);
  assert.deepEqual(byClass(render(withBlock([wt("acme-app-feature-a")])), "wt-note"), []);
});

test("a row shows its short name; the tooltip and the screen reader label keep the whole slug", () => {
  const root = render(withBlock([wt("acme-app-feature-a", "needs-you", { reason: "", facts: [] }), wt("other-thing", "needs-you", { reason: "", facts: [] })]));
  const rows = byClass(root, "wt");
  const labels = rows.map((e) => e.children.find((c: any) => c && c.className === "t")!);
  assert.deepEqual(labels.map((e) => e.textContent), ["feature-a", "other-thing"]);
  assert.deepEqual(labels.map((e) => e.attrs.title), ["acme-app-feature-a", "other-thing"]);
  assert.deepEqual(rows.map((e) => e.attrs["aria-label"]), ["acme-app-feature-a, needs you", "other-thing, needs you"]);
});

test("a row with no reason and no facts does not expand", () => {
  const root = render(withBlock([wt("acme-app-feature-a", "unread", { reason: "", facts: [] })]));
  const row = byClass(root, "wt")[0];
  assert.equal(row.attrs["aria-expanded"], undefined);
  row.click();
  assert.deepEqual(byClass(root, "wt-x"), []);
});

// One line per sequence, between the count line and the rows.
const seq = (name: string, steps: [string, string, string?][]) =>
  ({ name, steps: steps.map(([step, verdict, slug]) => ({ step, path: `/work/${slug ?? `acme-app-${name}-${step}`}`, verdict, label: verdict === "needs-you" ? "needs you" : verdict.replace("-", " ") })) });
const SEQ_ROWS = [wt("acme-app-pricing-s2"), wt("acme-app-nav-rework", "in-flight"), wt("acme-app-pricing-s3", "in-flight"), wt("acme-app-pricing-s1", "closable")];
const PRICING = seq("pricing", [["s1", "closable"], ["s2", "needs-you"], ["s3", "in-flight"]]);

test("a sequence is one line between the count line and the rows: its name, then a verdict dot and the step for each step in order", () => {
  const root = render(withBlock(SEQ_ROWS, [], { sequences: [PRICING] }));
  const lines = byClass(root, "wt-seq");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].textContent, "pricings1s2s3");
  assert.deepEqual(walk(lines[0]).filter((e) => e.className.split(" ")[0] === "dot").map((e) => e.className), ["dot g", "dot a", "dot "], "merged step included, dots as the rows draw them");
  assert.equal(lines[0].attrs.title, "pricing: s1 closable, s2 needs you, s3 in flight", "the whole line is on its tooltip");
  assert.equal(lines[0].attrs["aria-label"], "Sequence pricing: s1 closable, s2 needs you, s3 in flight");
  const order = walk(root).map((e) => e.className.split(" ")[0]).filter((c) => c === "wt-head" || c === "wt-seq" || c === "card" || c === "wt-tog");
  assert.deepEqual(order, ["wt-head", "wt-seq", "card", "card", "card", "wt-tog"]);
});

test("the rows under a sequence line are the rows the block draws without it", () => {
  const texts = (root: El) => byClass(root, "wt").map((e) => `${e.attrs["aria-label"]}|${e.textContent}`);
  const plain = render(withBlock(SEQ_ROWS), { open: ["wc:/work/acme-app"] }, [], host(SEQ_ROWS));
  plain.answer();
  const withSeq = render(withBlock(SEQ_ROWS, [card("1")], { sequences: [PRICING] }), { open: ["wc:/work/acme-app"] }, [], host(SEQ_ROWS));
  withSeq.answer();
  assert.deepEqual(texts(withSeq), texts(plain));
  assert.deepEqual(byClass(withSeq, "wt-tog").map((e) => e.textContent), byClass(plain, "wt-tog").map((e) => e.textContent));
  assert.deepEqual(byClass(plain, "wt-seq"), [], "a block with no sequences draws no line");
});

test("five sequence lines at most, then how many more; a closed block draws none", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => seq(`job${i + 1}`, [["s1", "closable"], ["s2", "in-flight"]]));
  const lines = (n: number, state: unknown = {}) => byClass(render(withBlock(SEQ_ROWS, [], { sequences: many(n) }), state), "wt-seq").map((e) => e.textContent);
  assert.deepEqual(lines(5), ["job1s1s2", "job2s1s2", "job3s1s2", "job4s1s2", "job5s1s2"]);
  assert.deepEqual(lines(6).slice(5), ["and 1 more sequence"]);
  assert.deepEqual(lines(8).slice(5), ["and 3 more sequences"]);
  assert.deepEqual(lines(8, { closed: ["wb:/work/acme-app"] }), []);
});

// A plan card's step offers only what the host will honour for it.
const planCard = (steps: unknown[]) => ({ ...card("plan:acme-app:Checkout rework"), kind: "plan", state: "run", title: "Checkout rework", steps, total: steps.length, open: true });
const stepButtons = (root: El) => byClass(root, "step").map((s) => walk(s).filter((e) => e.tag === "button").map((e) => e.textContent));
const planModel = (steps: unknown[]) => ({ summary, note: [], worktreeNote: "", worktreeScanAt: 0, groups: [{ repo: "acme-app", cards: [planCard(steps)], ended: [] }] });

test("a plan step with a worktree and no resume draws Open worktree and no Copy resume, and its click posts the path", () => {
  const posts: any[] = [];
  const step = { status: "now", text: "S3 totals", detail: "registry says merged; needs you: 1 changed file", worktree: "/work/acme-app-totals" };
  const root = render(planModel([step]), {}, posts);
  assert.deepEqual(stepButtons(root), [["Open worktree"]]);
  walk(root).find((e) => e.tag === "button" && e.textContent === "Open worktree")!.click();
  assert.deepEqual(posts.filter((m) => m.type !== "ready"), [{ type: "openWorktree", path: "/work/acme-app-totals" }]);
});

test("a plan step with a resume and a worktree draws both buttons, as before", () => {
  const posts: any[] = [];
  const step = { status: "now", text: "S2 form", detail: "needs you: 2 changed files", resume: "/work/acme-app-form", worktree: "/work/acme-app-form" };
  const root = render(planModel([step]), {}, posts);
  assert.deepEqual(stepButtons(root), [["Copy resume", "Open worktree"]]);
  walk(root).find((e) => e.tag === "button" && e.textContent === "Copy resume")!.click();
  assert.deepEqual(posts.filter((m) => m.type !== "ready"), [{ type: "copyResume", text: "/work/acme-app-form" }]);
});

test("a plan step with neither a resume nor a worktree draws no button row", () => {
  const steps = [{ status: "todo", text: "S4 receipts", detail: "waits on S3" }, { status: "todo", text: "S5 emails" }];
  const root = render(planModel(steps));
  assert.deepEqual(stepButtons(root), [[], []]);
  assert.deepEqual(byClass(root, "detail").map((e) => e.children.filter((c: any) => c && typeof c !== "string").length), [0], "the detail holds its text and nothing else");
});

test("a plan step that needs you draws the amber dot the Worktrees block gives the same folder", () => {
  const steps = [{ status: "needs", text: "S2 form", detail: "needs you: 2 changed files", worktree: "/work/acme-app-form" }, { status: "now", text: "S3 totals" }];
  const root = render(planModel(steps));
  const dots = byClass(root, "step").map((s) => walk(s).filter((e) => e.className.split(" ")[0] === "dot").map((e) => e.className));
  assert.deepEqual(dots, [["dot a"], ["dot b live"]]);
});

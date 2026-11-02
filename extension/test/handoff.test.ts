import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/model.ts";
import { GONE_MS, withCloses, type Close, type Row } from "../src/rows.ts";

const NOW = 10 * GONE_MS;
const MIN = 60_000;
const FOLDER = "/work/shop";
const steps = (done: number, total: number): Row["steps"] =>
  Array.from({ length: total }, (_, i) => ({ text: `step ${i + 1}`, status: i < done ? ("done" as const) : ("todo" as const) }));
const session = (id: string, plan: string, done: number, total: number, o: Partial<Row> = {}): Row => ({
  id, repo: "shop", where: "", plan, done, total, now: "", updatedAt: NOW - 30 * MIN, cwd: FOLDER, steps: steps(done, total), ...o,
});
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const EVIDENCE = "Worktree removed; git worktree list no longer shows it";

test("a tab closed with steps left waits behind its repo's collapsed line for a day, outside the counts, unless a close or /clear accounts for it", () => {
  const rows: Row[] = [
    session(A, "Add checkout", 1, 3, { ended: true }),
    session(B, "Old work", 1, 3, { ended: true, updatedAt: NOW - 2 * GONE_MS }),
    session(C, "Carried on", 1, 3, { ended: true, continuedIn: D }),
    session(D, "All done", 3, 3, { ended: true }),
  ];
  const m = buildModel({ rows, plans: [], note: [], now: NOW, live: new Map() });
  assert.deepEqual(m.groups.map((g) => [g.repo, g.cards.length, g.ended.map((c) => c.id)]), [["shop", 0, [A]]]);
  assert.equal(m.summary.sessions, 0);
  assert.equal(m.groups[0].ended[0].canResume, true);
});

test("a closed card for a tab that is gone shows in the list but is not counted as a session", () => {
  const close: Close = { by: "you", byPlan: "", evidence: "step 2: done elsewhere", at: NOW - MIN, rowReportedAt: NOW - 30 * MIN, steps: [{ text: "step 2", outcome: "finished", why: "" }] };
  const rows = [session(A, "Add checkout", 1, 2, { ended: true, closed: close })];
  const m = buildModel({ rows, plans: [], note: [], now: NOW, live: new Map() });
  assert.equal(m.groups[0].cards[0]?.state, "closed");
  assert.deepEqual([m.summary.sessions, m.summary.idle], [0, 0]);
});

test("a stopped session that was partway through a turn says interrupted, one between turns says unfinished", () => {
  const rows = [session(A, "Mid turn", 1, 3, { inTurn: true }), session(B, "Between turns", 1, 3)];
  const cards = buildModel({ rows, plans: [], note: [], now: NOW, live: new Map() }).groups.flatMap((g) => g.cards);
  assert.match(cards.find((c) => c.id === A)!.age, /^interrupted /);
  assert.match(cards.find((c) => c.id === B)!.age, /^unfinished /);
  assert.equal(cards.find((c) => c.id === A)!.state, "held");
});

test("a close survives the owner's tab reopening, and lapses when the owner reports again", () => {
  const close: Close = { by: B, byPlan: "Tidy worktrees", evidence: EVIDENCE, at: NOW - MIN, rowReportedAt: NOW - 30 * MIN };
  const closes = new Map([[A, close]]);
  const closedAfter = (o: Partial<Row>) => withCloses([session(A, "Add checkout", 4, 5, o)], closes)[0].closed;
  assert.ok(closedAfter({ reportedAt: NOW - 30 * MIN, updatedAt: NOW }), "reopening touches updatedAt only");
  assert.equal(closedAfter({ reportedAt: NOW, updatedAt: NOW }), undefined);
  assert.ok(closedAfter({ updatedAt: NOW - 30 * MIN }), "a row with no reportedAt goes by updatedAt");
});

test("a closed card draws its open steps from the close: finished ones ticked, not-needed ones with their reason, and the count reads whole", () => {
  const close: Close = {
    by: "you", byPlan: "", evidence: "Tell the team: the team was on the call", at: NOW - MIN, rowReportedAt: NOW - 30 * MIN,
    steps: [{ text: "step 2", outcome: "finished", why: "" }, { text: "step 3", outcome: "not needed", why: "the team was on the call" }],
  };
  const rows = [session(A, "Add checkout", 1, 3, { closed: close })];
  const card = buildModel({ rows, plans: [], note: [], now: NOW, live: new Map() }).groups[0].cards[0];
  assert.equal(card.state, "closed");
  assert.deepEqual(card.closedBy, { tag: "you", plan: "", evidence: "Tell the team: the team was on the call" });
  assert.deepEqual([card.done, card.total], [3, 3]);
  assert.deepEqual(card.steps.map((s) => [s.status, s.text, s.detail]), [["done", "step 1", undefined], ["done", "step 2", undefined], ["not needed", "step 3", "the team was on the call"]]);
  // A close from before step accounting leaves the steps and count as reported
  const old = buildModel({ rows: [session(A, "Add checkout", 1, 3, { closed: { ...close, steps: undefined } })], plans: [], note: [], now: NOW, live: new Map() }).groups[0].cards[0];
  assert.deepEqual([old.done, old.total, old.steps[2].status], [1, 3, "todo"]);
});

for (const how of ["killed", "cleanly closed"] as const) {
  test(`handoff, A ${how}: A stops reading as open work and names B and the evidence; the others in the folder are untouched`, () => {
    const rows: Row[] = [
      session(A, "Add checkout", 4, 5, {
        ended: how === "cleanly closed",
        closed: { by: B, byPlan: "Tidy worktrees", evidence: EVIDENCE, at: NOW - MIN, rowReportedAt: NOW - 30 * MIN },
      }),
      session(B, "Tidy worktrees", 2, 2, { updatedAt: NOW - MIN }),
      session(C, "Fix search", 1, 4),
      session(D, "Write docs", 1, 3, { updatedAt: NOW - MIN }),
    ];
    // B and D run on; A and C have no process
    const live = new Map([[B, { status: "idle" as const }], [D, { status: "busy" as const }]]);
    const cards = buildModel({ rows, plans: [], note: [], now: NOW, live }).groups.flatMap((g) => g.cards);
    const card = (id: string) => cards.find((c) => c.id === id);

    const a = card(A);
    assert.ok(a, "A's card stays in the panel so the close can be seen");
    assert.equal(a.state, "closed");
    assert.equal(a.canResume, false);
    assert.equal(a.closedBy?.tag, "bbbbbb");
    assert.equal(a.closedBy?.plan, "Tidy worktrees");
    assert.equal(a.closedBy?.evidence, EVIDENCE);

    assert.equal(card(B)?.state, "done");
    assert.equal(card(C)?.state, "held", "a session nobody closed still reads as open");
    assert.equal(card(C)?.closedBy, undefined);
    assert.equal(card(D)?.state, "run");
  });
}

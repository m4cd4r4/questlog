import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/model.ts";
import { GONE_MS, type Row } from "../src/rows.ts";

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

test("a stopped session that was partway through a turn says interrupted, one between turns says unfinished", () => {
  const rows = [session(A, "Mid turn", 1, 3, { inTurn: true }), session(B, "Between turns", 1, 3)];
  const cards = buildModel({ rows, plans: [], note: [], now: NOW, live: new Map() }).groups.flatMap((g) => g.cards);
  assert.match(cards.find((c) => c.id === A)!.age, /^interrupted /);
  assert.match(cards.find((c) => c.id === B)!.age, /^unfinished /);
  assert.equal(cards.find((c) => c.id === A)!.state, "held");
});

for (const how of ["killed", "cleanly closed"] as const) {
  test(`handoff, A ${how}: A stops reading as open work and names B and the evidence; the others in the folder are untouched`, () => {
    const rows: Row[] = [
      session(A, "Add checkout", 4, 5, {
        ended: how === "cleanly closed",
        closed: { by: B, byPlan: "Tidy worktrees", evidence: EVIDENCE, at: NOW - MIN, rowUpdatedAt: NOW - 30 * MIN },
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

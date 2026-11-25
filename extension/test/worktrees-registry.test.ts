import { test } from "node:test";
import assert from "node:assert/strict";
import { briefOf, markBriefs } from "../src/worktrees/registry.ts";
import type { RegistryEntry } from "../src/plans.ts";
import type { Facts } from "../src/worktrees/verdict.ts";

const MAIN = "/work/acme-app";
const A = "/work/acme-app-feature-a";
const B = "/work/acme-app-feature-b";
const C = "/work/acme-app-feature-c";
const D = "/work/acme-app-feature-d";
const BRIEFS = "/work/briefs";
const TEXT = "the whole brief, word for word";

const facts = (path: string, extra: Partial<Facts> = {}): Facts =>
  ({ path, head: "1".repeat(40), branch: path === MAIN ? "main" : `feat/${path.split("-").pop()}`, main: path === MAIN, detached: false, locked: false, bare: false, prunable: false, dirty: 0, unpushed: 0, stashes: 0, ownCommits: 1, pr: { state: "none" }, ...extra }) as Facts;

const entry = (worktree_path: string | null, extra: Partial<RegistryEntry> = {}): RegistryEntry =>
  ({ slug: "s", worktree_path, brief_local_path: `${BRIEFS}/s.md`, ...extra });

const onDisk = (...paths: string[]) => (p: string) => paths.includes(p);

test("three worktrees of one repo in one folder each get their own answer: lost, recoverable, present", () => {
  const entries: RegistryEntry[] = [
    entry(A, { brief_local_path: `${BRIEFS}/a.md` }),
    entry(B, { brief_local_path: `${BRIEFS}/b.md`, brief_full_text: TEXT }),
    entry(C, { brief_local_path: `${BRIEFS}/c.md`, brief_full_text: TEXT }),
  ];
  const exists = onDisk(`${BRIEFS}/c.md`);
  assert.equal(briefOf(A, entries, exists), "lost");
  assert.equal(briefOf(B, entries, exists), "recoverable");
  assert.equal(briefOf(C, entries, exists), "present");

  const marked = markBriefs([facts(MAIN), facts(A), facts(B), facts(C)], entries, exists);
  assert.deepEqual(marked.map((w) => w.brief), [undefined, "lost", "recoverable", "present"]);
  assert.equal(JSON.stringify(marked).includes(TEXT), false);
});

test("a worktree the registry does not know gets no brief field", () => {
  const entries = [entry(A)];
  assert.equal(briefOf(D, entries, onDisk()), undefined);
  const [d] = markBriefs([facts(D)], entries, onDisk());
  assert.equal("brief" in d, false);
});

test("two entries on one path: the newest materialised_at wins", () => {
  const entries = [
    entry(A, { brief_local_path: `${BRIEFS}/new.md`, materialised_at: "2026-03-02T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }),
    entry(A, { brief_local_path: `${BRIEFS}/old.md`, materialised_at: "2026-02-01T00:00:00Z", created_at: "2026-02-01T00:00:00Z" }),
  ];
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/new.md`)), "present");
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/old.md`)), "lost");
});

test("two entries on one path with the same or no materialised_at: the newest created_at wins", () => {
  const same = "2026-03-02T00:00:00Z";
  const entries = [
    entry(A, { brief_local_path: `${BRIEFS}/new.md`, materialised_at: same, created_at: "2026-02-10T00:00:00Z" }),
    entry(A, { brief_local_path: `${BRIEFS}/old.md`, materialised_at: same, created_at: "2026-02-01T00:00:00Z" }),
  ];
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/new.md`)), "present");

  const none = [
    entry(A, { brief_local_path: `${BRIEFS}/new.md`, created_at: "2026-02-10T00:00:00Z" }),
    entry(A, { brief_local_path: `${BRIEFS}/old.md`, materialised_at: null, created_at: "not a date" }),
  ];
  assert.equal(briefOf(A, none, onDisk(`${BRIEFS}/new.md`)), "present");
});

test("two entries on one path with no dates to tell them apart: the later one in the file wins", () => {
  const entries = [
    entry(A, { brief_local_path: `${BRIEFS}/first.md` }),
    entry(A, { brief_local_path: `${BRIEFS}/second.md` }),
  ];
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/second.md`)), "present");
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/first.md`)), "lost");
});

test("a date that cannot be read ranks below any real date", () => {
  const entries = [
    entry(A, { brief_local_path: `${BRIEFS}/dated.md`, materialised_at: "2026-01-01T00:00:00Z" }),
    entry(A, { brief_local_path: `${BRIEFS}/junk.md`, materialised_at: "soon" }),
  ];
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/dated.md`)), "present");
});

test("an empty or whitespace brief_full_text reads lost, and so does one that is not a string", () => {
  for (const brief_full_text of ["", "  \n\t ", null, undefined, 7 as never]) {
    assert.equal(briefOf(A, [entry(A, { brief_full_text })], onDisk()), "lost");
  }
});

test("an entry with no brief path gives no field", () => {
  for (const brief_local_path of [null, undefined, "", "   "]) {
    assert.equal(briefOf(A, [entry(A, { brief_local_path, brief_full_text: TEXT })], onDisk()), undefined);
  }
  // the winning entry decides, even when an older one on the same path has a brief
  const entries = [
    entry(A, { brief_local_path: `${BRIEFS}/old.md`, materialised_at: "2026-01-01T00:00:00Z" }),
    entry(A, { brief_local_path: null, materialised_at: "2026-02-01T00:00:00Z" }),
  ];
  assert.equal(briefOf(A, entries, onDisk(`${BRIEFS}/old.md`)), undefined);
});

test("mixed slashes and drive-letter case still join", () => {
  const entries = [entry("I:\\work\\acme-app-feature-a", { brief_full_text: TEXT })];
  assert.equal(briefOf("i:/work/acme-app-feature-a/", entries, onDisk()), "recoverable");
  assert.equal(briefOf("I:/work/acme-app-feature-a", entries, onDisk()), "recoverable");
  assert.equal(briefOf("i:/work/acme-app-feature-ab", entries, onDisk()), undefined);
});

test("entries with no worktree path never match", () => {
  assert.equal(briefOf(A, [entry(null), entry("")], onDisk()), undefined);
  assert.equal(briefOf("", [entry("")], onDisk()), undefined);
});

test("the main checkout, a bare entry and a prunable one get no field, even when the registry names their path", () => {
  const entries = [entry(MAIN), entry(A), entry(B), entry(C)];
  const marked = markBriefs([facts(MAIN), facts(A, { bare: true }), facts(B, { prunable: true }), facts(C)], entries, onDisk());
  assert.deepEqual(marked.map((w) => "brief" in w), [false, false, false, true]);
  assert.equal(marked[3].brief, "lost");
});

test("an exists that throws counts as not there", () => {
  const boom = () => { throw new Error("disk gone"); };
  assert.equal(briefOf(A, [entry(A)], boom), "lost");
  assert.equal(briefOf(A, [entry(A, { brief_full_text: TEXT })], boom), "recoverable");
});

test("markBriefs leaves its input alone and keeps the order", () => {
  const input = [facts(A), facts(B)];
  const marked = markBriefs(input, [entry(B)], onDisk());
  assert.deepEqual(marked.map((w) => w.path), [A, B]);
  assert.equal("brief" in input[1], false);
});

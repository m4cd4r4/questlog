import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCache, encodeCache, parseAgents } from "../src/live.ts";

test("parseAgents maps live sessions by id and keeps why one is waiting", () => {
  const live = parseAgents(JSON.stringify([
    { pid: 1, cwd: "c", kind: "interactive", sessionId: "a", name: "A", status: "busy" },
    { pid: 2, cwd: "c", kind: "interactive", sessionId: "b", status: "waiting", waitingFor: "input needed" },
  ]));
  assert.deepEqual([...live!], [["a", { status: "busy", waitingFor: undefined }], ["b", { status: "waiting", waitingFor: "input needed" }]]);
});

test("parseAgents skips a finished background job, which has a state but no status", () => {
  const live = parseAgents(JSON.stringify([{ kind: "background", id: "x", sessionId: "a", state: "done" }]));
  assert.equal(live!.size, 0);
});

test("parseAgents returns undefined for anything that is not a list, so the file view stands alone", () => {
  assert.equal(parseAgents(""), undefined);
  assert.equal(parseAgents("Error: not signed in"), undefined);
  assert.equal(parseAgents("{}"), undefined);
  assert.equal(parseAgents("[null, 3, {}]")!.size, 0);
});

test("the shared cache round-trips and is only good while it is younger than the interval", () => {
  const live = new Map([["b", { status: "waiting" as const, waitingFor: "input needed" }]]);
  const text = encodeCache(1000, live);
  assert.deepEqual([...decodeCache(text, 1000 + 9_999, 10_000)!.live!], [...live]);
  assert.equal(decodeCache(text, 1000 + 10_000, 10_000), undefined);
});

test("a failed read is cached too, so no window retries sooner than the interval", () => {
  assert.deepEqual(decodeCache(encodeCache(1000, undefined), 2000, 10_000), { live: undefined });
});

test("a damaged or future-dated cache is ignored", () => {
  assert.equal(decodeCache("", 0, 10_000), undefined);
  assert.equal(decodeCache("[]", 0, 10_000), undefined);
  assert.equal(decodeCache(encodeCache(900_000, new Map()), 1000, 10_000), undefined);
});

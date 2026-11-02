import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COPY_ID_COMMAND, GONE_MS, PANE_COMMAND, PARKED_MS, ago, dismissedFrom, paneLink, paneOpenOf, STALE_MS, bar, copyIdLink, sessionIdFromArg, description, groupByRepo, isRow, isSessionTab, noteLines, rowForTab, rowForWorkspace, statusText, stepsOf, visibleRows,
  canResume, inOpenFolder, resumeCommandOf, sessionTagOf, type Row,
} from "../src/rows.ts";

const NOW = 10 * GONE_MS;
const row = (o: Partial<Row>): Row => ({
  id: "x", repo: "r", where: "", plan: "Plan", done: 0, total: 0, now: "", updatedAt: NOW, ...o,
});

test("visibleRows drops ended and finished day-old rows, keeps idle and paused ones, newest first", () => {
  const rows = [
    row({ id: "old", total: 2, done: 2, updatedAt: NOW - GONE_MS }),
    row({ id: "ended", ended: true }),
    row({ id: "idle", updatedAt: NOW - STALE_MS }),
    row({ id: "live", updatedAt: NOW - 1000 }),
  ];
  assert.deepEqual(visibleRows(rows, NOW).map((r) => r.id), ["live", "idle"]);
});

test("visibleRows keeps an unfinished row until PARKED_MS, a finished one only until GONE_MS", () => {
  const threeDays = NOW - 3 * GONE_MS;
  assert.equal(visibleRows([row({ id: "p", total: 3, done: 1, updatedAt: threeDays })], NOW).length, 1);
  assert.equal(visibleRows([row({ id: "p", total: 3, done: 1, updatedAt: NOW - PARKED_MS })], NOW).length, 0);
  assert.equal(visibleRows([row({ id: "f", total: 3, done: 3, updatedAt: NOW - GONE_MS })], NOW).length, 0);
});

test("visibleRows drops a day-old row that has no steps, even though it is unfinished", () => {
  assert.equal(visibleRows([row({ id: "n", total: 0, updatedAt: NOW - GONE_MS })], NOW).length, 0);
});

test("visibleRows hides a dismissed row until its updatedAt changes", () => {
  const r = row({ id: "d", updatedAt: NOW - 1000 });
  assert.equal(visibleRows([r], NOW, { d: r.updatedAt }).length, 0);
  assert.equal(visibleRows([{ ...r, updatedAt: NOW - 500 }], NOW, { d: r.updatedAt }).length, 1);
});

test("dismissedFrom ignores junk and non-number entries", () => {
  assert.deepEqual(dismissedFrom("not json"), {});
  assert.deepEqual(dismissedFrom("[1,2]"), {});
  assert.deepEqual(dismissedFrom('{"a":5,"b":"x"}'), { a: 5 });
});

test("ago gives days past 48 hours", () => {
  assert.equal(ago(2 * 24 * 3600000), "2d");
});

test("visibleRows hides a session that never got a message or a plan", () => {
  const rows = [
    row({ id: "empty", plan: "" }),
    row({ id: "steps", plan: "", total: 3 }),
    row({ id: "topic", plan: "Fix the login bug" }),
  ];
  assert.deepEqual(visibleRows(rows, NOW).map((r) => r.id), ["steps", "topic"]);
});

test("groupByRepo orders groups by their newest row", () => {
  const groups = groupByRepo([
    row({ id: "a1", repo: "a", updatedAt: NOW - 5000 }),
    row({ id: "b1", repo: "b", updatedAt: NOW - 1000 }),
    row({ id: "a2", repo: "a", updatedAt: NOW - 9000 }),
    row({ id: "n", repo: "" }),
  ]);
  assert.deepEqual(groups.map((g) => g.repo), ["(no repo)", "b", "a"]);
  assert.deepEqual(groups[2].rows.map((r) => r.id), ["a1", "a2"]);
});

test("description: stage, worktree or feature branch, age; main is left out", () => {
  assert.equal(description(row({ done: 3, total: 7, where: "wt-slug", updatedAt: NOW - 5 * 60000 }), NOW), "3/7 · wt-slug · 5m");
  assert.equal(description(row({ branch: "feat/x" }), NOW), "feat/x · now");
  assert.equal(description(row({ branch: "main" }), NOW), "now");
  assert.equal(description(row({ updatedAt: NOW - 7 * 3600000 }), NOW), "idle 7h");
});

test("stepsOf falls back to the now line for rows without steps", () => {
  assert.deepEqual(stepsOf(row({ now: "doing" })), [{ text: "doing", status: "now" }]);
  assert.deepEqual(stepsOf(row({})), []);
});

test("rowForWorkspace matches cwd inside a folder, any slash or case", () => {
  const rows = [
    row({ id: "other", cwd: "C:/work/other", updatedAt: NOW }),
    row({ id: "mine", cwd: "c:/work/myapp/app", updatedAt: NOW - 1000 }),
  ];
  assert.equal(rowForWorkspace(rows, ["C:\\work\\myapp"], NOW)?.id, "mine");
  assert.equal(rowForWorkspace(rows, ["C:/work/myapp-wt"], NOW), undefined);
});

test("rowForWorkspace refuses to guess between two live sessions in one folder", () => {
  const rows = [
    row({ id: "a", cwd: "C:\\work\\myapp", updatedAt: NOW - 60000 }),
    row({ id: "b", cwd: "c:/work/myapp/app", updatedAt: NOW - 1000 }),
  ];
  assert.equal(rowForWorkspace(rows, ["C:/work/myapp"], NOW), undefined);
  assert.equal(rowForWorkspace([...rows, row({ id: "c", repo: "myapp" }), row({ id: "d", repo: "myapp" })], ["C:/work/other/myapp"], NOW), undefined);
});

test("rowForWorkspace falls back to repo name for rows without cwd, never to a stale row", () => {
  assert.equal(rowForWorkspace([row({ id: "a", repo: "myapp" })], ["C:/work/myapp"], NOW)?.id, "a");
  assert.equal(rowForWorkspace([row({ repo: "myapp", updatedAt: NOW - STALE_MS })], ["C:/work/myapp"], NOW), undefined);
});

test("rowForTab matches the recorded title exactly, newest first, never an ended row", () => {
  const rows = [
    row({ id: "a", title: "2/5 Ship it · wt", updatedAt: NOW - 5000 }),
    row({ id: "b", title: "2/5 Ship it · wt", updatedAt: NOW - 1000 }),
    row({ id: "c", title: "1/3 Other", ended: true }),
    row({ id: "d" }),
  ];
  assert.equal(rowForTab(rows, "2/5 Ship it · wt", NOW)?.id, "b");
  assert.equal(rowForTab(rows, "1/3 Other", NOW), undefined);
  assert.equal(rowForTab(rows, "2/5 Ship it", NOW), undefined);
  assert.equal(rowForTab(rows, "", NOW), undefined);
});

test("rowForTab: a label VS Code cut short with an ellipsis matches the title it starts", () => {
  const rows = [
    row({ id: "a", title: "2/5 Landing metric strip fixes", updatedAt: NOW - 5000 }),
    row({ id: "b", title: "4/4 Questlog claude.ai attach", updatedAt: NOW - 1000 }),
    row({ id: "c", title: "4/4 Questlog claude.ai other", updatedAt: NOW - 9000 }),
  ];
  assert.equal(rowForTab(rows, "2/5 Landing metric strip…", NOW)?.id, "a");
  assert.equal(rowForTab(rows, "4/4 Questlog clau…", NOW)?.id, "b");
  assert.equal(rowForTab(rows, "2/5 Landing metric strip", NOW), undefined);
  assert.equal(rowForTab(rows, "…", NOW), undefined);
});

test("isSessionTab: a tab carrying the session tag is a Claude session even when no row matches it", () => {
  assert.equal(isSessionTab("[8e312b]"), true);
  assert.equal(isSessionTab("[7f2922] 0/4 Diagnose Sh…"), true);
  assert.equal(isSessionTab("extension.ts"), false);
  assert.equal(isSessionTab("[todo] notes.md"), false);
  assert.equal(isSessionTab(""), false);
});

test("statusText and bar", () => {
  assert.equal(statusText(row({ done: 2, total: 5, plan: "Ship it", now: "tests" })), "2/5 Ship it · tests");
  assert.equal(statusText(row({ plan: "" })), "(no plan yet)");
  assert.equal(bar(1, 2, 4), "■■□□");
  assert.equal(bar(0, 0), "");
});

test("statusText counts a closed row whole, as the card does", () => {
  const closed = { by: "check", byPlan: "", evidence: "x gone", at: NOW, rowReportedAt: NOW, steps: [{ text: "Remove", outcome: "finished" as const, why: "x gone" }] };
  assert.equal(statusText(row({ done: 1, total: 2, plan: "Scratch", closed })), "2/2 Scratch");
});

test("noteLines: one item per line, markers and blanks dropped", () => {
  assert.deepEqual(noteLines("- first\r\n\n* second\n1. third\nplain\n   \n"), ["first", "second", "third", "plain"]);
  assert.deepEqual(noteLines(""), []);
});

test("isRow rejects junk", () => {
  assert.equal(isRow(null), false);
  assert.equal(isRow({ id: "a" }), false);
  assert.equal(isRow(row({})), true);
});

test("copyIdLink carries the ID as the command's one argument", () => {
  const link = copyIdLink("7b19a432-4e3e-4760-88d1-c02367218db3");
  assert.ok(link.startsWith(`command:${COPY_ID_COMMAND}?`));
  assert.deepEqual(JSON.parse(decodeURIComponent(link.split("?")[1])), ["7b19a432-4e3e-4760-88d1-c02367218db3"]);
});

test("sessionIdFromArg takes a raw ID or a tree item, and nothing else", () => {
  assert.equal(sessionIdFromArg("abc"), "abc");
  assert.equal(sessionIdFromArg({ id: "session:abc" }), "abc");
  assert.equal(sessionIdFromArg({ id: "step:abc" }), undefined);
  assert.equal(sessionIdFromArg({ id: "session:" }), undefined);
  assert.equal(sessionIdFromArg(""), undefined);
  assert.equal(sessionIdFromArg(undefined), undefined);
});

test("paneLink runs the toggle command for one session; paneOpenOf reads only open:true as on", () => {
  assert.equal(paneLink("abc"), `command:${PANE_COMMAND}?${encodeURIComponent('["abc"]')}`);
  assert.equal(sessionIdFromArg(JSON.parse(decodeURIComponent(paneLink("abc").split("?")[1]))[0]), "abc");
  assert.equal(paneOpenOf('{"open":true}'), true);
  assert.equal(paneOpenOf('{"open":false}'), false);
  assert.equal(paneOpenOf(""), false);
  assert.equal(paneOpenOf("null"), false);
});

const SID = "9d0182ef-186f-4137-b7ce-baa6e9209bcb";
const paused = (o: Partial<Row> = {}) => row({ id: SID, total: 3, done: 1, cwd: "D:/code/demo-shop", updatedAt: NOW - STALE_MS - 1, ...o });

test("resumeCommandOf builds a cd plus claude --resume line for an unfinished session", () => {
  assert.equal(resumeCommandOf(paused()), `cd "D:/code/demo-shop"; claude --resume ${SID}`);
});

test("resumeCommandOf offers nothing for a finished or planless session", () => {
  assert.equal(resumeCommandOf(paused({ done: 3 })), undefined);
  assert.equal(resumeCommandOf(paused({ total: 0, done: 0 })), undefined);
});

test("resumeCommandOf refuses a row with no folder, an odd ID or a folder that could break out of the quotes", () => {
  assert.equal(resumeCommandOf(paused({ cwd: undefined })), undefined);
  assert.equal(resumeCommandOf(paused({ id: "abc" })), undefined);
  assert.equal(resumeCommandOf(paused({ cwd: 'I:/x"; rm -rf /' })), undefined);
  assert.equal(resumeCommandOf(paused({ cwd: "I:/x$(whoami)" })), undefined);
  assert.equal(resumeCommandOf(paused({ cwd: "I:/x`id`" })), undefined);
});

test("sessionTagOf reads the 6 character tag a Claude tab leads with", () => {
  assert.equal(sessionTagOf("[0F2479] Add checkout flow"), "0f2479");
  assert.equal(sessionTagOf("  [e682bc] Add order"), "e682bc");
  assert.equal(sessionTagOf("README.md"), undefined);
  assert.equal(sessionTagOf("[xyz123] not hex"), undefined);
});

const HERE = ["D:/code/demo-shop"];
const TAG = SID.slice(0, 6);

test("canResume: a session quiet for 6 hours offers the button wherever its folder is", () => {
  assert.equal(canResume(paused(), NOW, new Set(), []), true);
  assert.equal(canResume(paused(), NOW, new Set(), HERE), true);
});

test("canResume: a recent session offers it only in its own folder with no tab for it open here", () => {
  const recent = paused({ updatedAt: NOW - 10 * 60 * 1000 });
  assert.equal(canResume(recent, NOW, new Set(), HERE), true);
  assert.equal(canResume(recent, NOW, new Set([TAG]), HERE), false);
  assert.equal(canResume(recent, NOW, new Set(), ["D:/code/other"]), false);
  assert.equal(canResume(recent, NOW, new Set(), []), false);
});

test("canResume: a session whose process has ended offers it wherever its folder is, however recent", () => {
  const recent = paused({ updatedAt: NOW - 10 * 60 * 1000 });
  assert.equal(canResume(recent, NOW, new Set(), ["D:/code/other"], true), true);
  assert.equal(canResume(recent, NOW, new Set(), [], true), true);
  assert.equal(canResume(paused({ done: 3, updatedAt: recent.updatedAt }), NOW, new Set(), [], true), false);
});

test("canResume: never for a finished or planless session", () => {
  assert.equal(canResume(paused({ done: 3 }), NOW, new Set(), HERE), false);
  assert.equal(canResume(paused({ total: 0, done: 0 }), NOW, new Set(), HERE), false);
});

test("inOpenFolder matches a row's folder to an open one exactly, ignoring slash style, case and a trailing slash", () => {
  assert.equal(inOpenFolder("D:/code/demo-shop", ["D:\\code\\demo-shop"]), true);
  assert.equal(inOpenFolder("D:/code/demo-shop/", ["d:/code/demo-shop"]), true);
  assert.equal(inOpenFolder("D:/code/demo-shop/app", ["D:/code/demo-shop"]), false);
  assert.equal(inOpenFolder("D:/code/other", ["D:/code/demo-shop"]), false);
  assert.equal(inOpenFolder("D:/code/demo-shop", []), false);
});

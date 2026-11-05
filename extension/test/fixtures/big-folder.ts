// A Questlog folder the size of the real one on 2026-11-04/05: 1,063 row files (859 ended, ~485 bytes each,
// 7 with step checks), closes, the restart note, the dismissed list and the live cache, plus a worktree registry
// of 1,017 entries (9.7 MB). Three sessions share one folder. Used by the extension-host timing test.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NOW = Date.parse("2026-11-05T00:00:00Z");
export const FOLDER = "I:/work/app";
const H = 3_600_000;
const uuid = (i: number) => `${String(i).padStart(8, "0")}-1111-4111-8111-${String(i).padStart(12, "0")}`;
/** The three sessions in FOLDER: one live, one waiting on a check, one ended. */
export const SESSIONS = [uuid(0), uuid(1), uuid(2)];
export const ROW_COUNT = 1100;

export function row(i: number, updatedAt = NOW - i * 0.4 * H) {
  const steps = Array.from({ length: 5 }, (_, n) => ({ text: `Step ${n} of the work`, status: n < 2 ? "done" : n === 2 ? "now" : "todo" }));
  // A few unfinished rows name a path that proves each open step: the tick looks at them
  if (i % 150 === 1) for (const s of steps.slice(2)) Object.assign(s, { check: { exists: `out/${i}/${s.text.length}.txt` } });
  return {
    id: uuid(i), repo: i < 3 ? "app" : `repo-${i % 40}`, where: `feat/step-${i}`, plan: `Plan ${i}`, done: 2, total: 5, now: "Step 2 of the work",
    updatedAt, reportedAt: updatedAt, ended: i % 5 !== 0 && i > 2, steps, branch: `feat/step-${i}`, cwd: i < 3 ? FOLDER : `I:/work/repo-${i % 40}`,
    title: `[${uuid(i).slice(0, 6)}] Plan ${i}`,
  };
}

export function buildFolder(root: string, count = ROW_COUNT) {
  const dir = join(root, "questlog");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) writeFileSync(join(dir, `${uuid(i)}.json`), JSON.stringify(row(i)));
  for (let i = 10; i < 60; i++) writeFileSync(join(dir, `${uuid(i)}.close`), JSON.stringify({ by: uuid(1), byPlan: "Plan 1", evidence: "merged", at: NOW, rowReportedAt: row(i).updatedAt }));
  writeFileSync(join(dir, "restart-note.md"), "# Restart\n\n- pick up the PR\n- rerun the tests\n");
  writeFileSync(join(dir, "dismissed.json"), JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [uuid(100 + i), row(100 + i).updatedAt]))));
  writeFileSync(join(dir, "live.cache"), JSON.stringify({ at: NOW, live: [[SESSIONS[0], { status: "busy" }]] }));
  const filler = "x".repeat(9000);
  const entries = Array.from({ length: 1017 }, (_, i) => ({
    slug: `slice-${i}`, plan: i < 114 ? `plan-${i % 30}` : undefined, label: `Slice ${i}`, wave: i % 3, status: i % 4 ? "merged" : "active",
    repo_path: "I:/work/app", worktree_path: i < 24 ? join(root, `wt-${i}`) : null, last_activity_at: new Date(NOW - i * H).toISOString(), notes: filler,
  }));
  mkdirSync(join(root, "workspaces"), { recursive: true });
  writeFileSync(join(root, "workspaces", "registry.json"), JSON.stringify({ entries }));
  return dir;
}

/** The longest the event loop went without turning while `fn` ran, in ms. */
export async function longestBlock(fn: () => Promise<unknown>) {
  let last = performance.now();
  let max = 0;
  let on = true;
  const tick = () => {
    const t = performance.now();
    max = Math.max(max, t - last);
    last = t;
    if (on) setImmediate(tick);
  };
  setImmediate(tick);
  await fn();
  on = false;
  return Math.max(max, performance.now() - last);
}

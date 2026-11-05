# Questlog extension-host freeze Brief

Open this in a **fresh Claude Code session** in this worktree. Don't carry context from the session that wrote it.

## First action: rebase before doing anything else

```bash
git fetch origin main --quiet
git rebase origin/main
```

## The problem

The Questlog VS Code extension (1.0.0) blocks the shared VS Code extension host the same way cornerman did. While the host is blocked, every extension stalls and the Claude Code panel can show "Claude Code stopped responding in this tab".

Evidence, 2026-11-04:
- VS Code's unresponsive-host profiler blamed `macdara.questlog` twice that day (cornerman 38 times; cornerman is fixed on main in m4cd4r4/cornerman PR #174).
- Across 40 saved exthost CPU profiles (`F:/Temp/exthost-*.cpuprofile`), Questlog's `update` holds 5.4 s inclusive and `readRows` 3.9 s.
- `readRows` in `extension/src/extension.ts` does `readdirSync` plus a `readFileSync` and `JSON.parse` per file over `~/.claude/questlog` (1,053 files on 2026-11-04). `update` calls it on every watcher burst (150 ms debounce), every 30 s tick (`TICK_MS`) and when the view becomes visible. It also reads the note, the dismissed list and the plans synchronously each time.
- `pollLive` runs every 5 s (`MIN_LIVE_S`) and reads the live cache synchronously.

## Source of truth (read these BEFORE coding)

1. `extension/src/extension.ts`: `readRows`, `update`, `pollLive`, `readLiveCache`, `soon`, `startWatch`, the `registryCache`
2. `extension/src/rows.ts` and `extension/src/model.ts`: what a row is, `withCloses`, `runChecks`
3. `extension/test/rows.test.ts`, `extension/test/live.test.ts`: test style (`node --test test/*.test.ts`)
4. Reference fix in cornerman (`I:/Scratch/clear-resume`, main): `extension/src/json-folder.ts` (in-memory copy, async rereads of only the files the watcher names, drive-letter case fix for `Uri.fsPath`), `test/exthost-block.test.mjs` (how the longest event-loop block is measured), `test/fixtures/big-store.mjs`
5. `docs/CLAUDE-TODO.md` item 17.1 in the cornerman repo: the original finding

If this brief contradicts the code, the code wins.

## What's in scope

The extension's refresh path: `readRows` and every sync read that `update` and `pollLive` run on a timer or a watcher event. Any new module this needs under `extension/src/`, and its tests.

## Out of scope

The mod (`mod/`), the row file format, the hand-close flow's write path (it may keep one fresh read, but make it async if it is cheap), README and site copy. Cornerman: do not change it.

## What "good" looks like

- No synchronous fs (readFileSync, readdirSync, statSync, existsSync) on any path the host runs on a timer or on file-watch events.
- Rows held in memory; only files named by the watcher are reread, asynchronously. A full rescan only when the watcher errors or restarts.
- On a fixture of 1,000+ row files (3 sessions in one folder among them), one `update` blocks the event loop for under 50 ms. Measured, not estimated.
- The panel, status bar and badge show the same as before. Existing tests pass.

## Required deliverables

1. The fixture and timing test first, failing against current main (red), with the measured number.
2. The fix, green against the same test.
3. Before and after numbers (longest block, median over 20 runs).
4. One issue, then one PR that says "Closes #N" with an `## Evidence` section from `pr-evidence.mjs`. Squash-merge only after Macdara's yes.

## Suggested workflow

1. Rebase. Read the source files above, including cornerman's `json-folder.ts`.
2. `/tdd`: fixture and timing test.
3. Fix, run `npm test` and `npm run check` in `extension/`, and `npm run build`.

## Constraints

- One PR. Branch `fix/questlog-exthost-freeze`.
- No new runtime dependencies.
- No version bump or release in this PR. Macdara wants cornerman 0.7.2 and the Questlog release shipped together afterwards, in a separate release step.
- Never install a dev build into live VS Code or the live Claude config. No Extension Development Host without a throwaway `--user-data-dir` and `CLAUDE_CONFIG_DIR` (it can close every open VS Code window).
- Timing tests are wall-clock and load-sensitive: at 100% CPU cornerman's 25 ms refresh measured 103 ms. Check CPU load before trusting a red result after the fix.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md` in this repo (create it if missing).

## Why this brief is structured this way

Cornerman's first attempt (#160) cached one function and shipped without measuring the host block, so the freeze survived it. Cornerman's second attempt put the timing test first and it held (182 ms to 25 ms). Do the same here.
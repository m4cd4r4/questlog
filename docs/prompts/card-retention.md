# Questlog wave 2: card-retention Brief

Open this in a **fresh Claude Code session** in this worktree. Don't carry context from the session that wrote it.

## First action: rebase before doing anything else

```bash
git fetch origin main --quiet
git rebase origin/main
```

## The problem

Nothing ever deletes a row file. `~/.claude/questlog` held 1,073 files on 2026-11-06, most of them ended. Closing a tab only hides its card. The folder grows for as long as the plugin is used, and every activation read and watcher rescan pays for it.

## Source of truth (read these BEFORE coding)

1. `docs/no-bloat/PROJECT-PLAN.md`: rules 1-5 are settled, do not reopen them. This PR is wave 2.
2. `docs/CLAUDE-TODO.md` item 1.
3. `mod/hooks/register.tsx` and `mod/hooks/lib.ts`: how the plugin registers hooks, the `Row` type, `rowOf`, `CLOSE_EXT`, `claudeDir`.
4. `extension/src/rows.ts` (`hasWorkLeft`, `GONE_MS`, `PARKED_MS`): what "finished" and "unfinished" mean today. Use the same meaning.
5. `mod/hooks/lib.test.ts` and `register.test.ts`: test style.

If this brief contradicts the code, the code wins.

## What's in scope

- A SessionStart hook in the plugin that starts a detached job and returns at once. A marker file skips the job when it ran in the last 24 h.
- The job: for each row Questlog wrote, past retention (rule 4: finished 7 days, unfinished 30 days, counted from the row's last update), append one line to `~/.claude/questlog/ledger/YYYY-MM.jsonl` (plan, steps done of total, repo, first and last update, how it ended), then delete the row `.json` and its `.close`.
- Tests for the retention decision, the ledger line and the job, with fixtures in neutral temp paths.

## Out of scope

- The extension (it already copes with rows disappearing; check, do not change it unless a test proves a break).
- Stats, `/questlog:stats` and any display copy (wave 3).
- TODO 2 and 4 (deferred by the plan).
- Any file Questlog did not write (rule 1): the restart note, the migration marker, dismissed state, anything unknown in the folder.

## What "good" looks like

- SessionStart adds no visible latency: the hook returns before the job does any reading.
- A second session start within 24 h does not run the job.
- The ledger line is written before the delete. If the ledger write fails, the row stays.
- A crash mid-run leaves no half state worse than "row not yet deleted".
- Rows inside retention, and every non-Questlog file, are untouched.

## Required deliverables

1. Red tests first, then the code, green. `npm test` and the typecheck pass in `mod/`, and `npm test`, `npm run check`, `npm run build` still pass in `extension/`.
2. One end-to-end run in the sandbox: `node ~/.claude/scripts/plugin-dev.mjs <this-worktree> --seed <fixture>` with a seeded rows folder (old finished, old unfinished, fresh, foreign file), showing what was ledgered and deleted. Fixtures use neutral paths.
3. Mark TODO 1 done and set wave 2 to done in the plan's Status table (wave 3 to ready).
4. One issue, one PR with "Closes #N" and the `## Evidence` section from `pr-evidence`. Squash-merge is autonomous once green; no release.

## Constraints

- One PR. Branch `feat/card-retention`. No new runtime dependencies. No version bump (plan rule 5).
- Never install a dev build into live VS Code or the live Claude config; never point `CLAUDE_CODE_PLUGIN_DIRS` at this tree.
- Never run the job against the real `~/.claude/questlog` during development.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md`. Do not fix inline.

## Why this brief is structured this way

A delete job that guesses what "finished" means, or touches a file it did not write, loses data nobody can get back. The ledger-before-delete order and rule 1 are the guard; the tests must prove both.
# Questlog wave 1: freshness Brief

Open this in a **fresh Claude Code session** in this worktree. Don't carry context from the session that wrote it.

## First action: rebase before doing anything else

```bash
git fetch origin main --quiet
git rebase origin/main
```

## The problem

Since PR #21 the extension keeps rows in memory and rereads a file only when its size or mtime changed. A row rewritten at the same byte length within one mtime tick is missed until it changes again. Unlikely on NTFS or ext4; realistic on 1-2 s filesystems (FAT, SMB, some WSL mounts).

## Source of truth (read these BEFORE coding)

1. `docs/no-bloat/PROJECT-PLAN.md`: the plan this PR is wave 1 of.
2. `docs/CLAUDE-TODO.md` item 3.
3. `extension/src/refresh.ts` and `extension/src/extension.ts`: the in-memory folder and the 5-minute rescan.
4. `extension/test/`: test style (`npm test` in `extension/`).

If this brief contradicts the code, the code wins.

## What's in scope

The freshness check and the rescan in the extension, and their tests.

## Out of scope

Retention and deleting rows (wave 2, in the plugin). The mod. Click paths (TODO 4, deferred).

## What "good" looks like

- On each rescan, rows updated in the last few minutes are reread regardless of size and mtime.
- A test that rewrites a row at the same size and same mtime and proves the new content is seen by the next rescan (red first).
- The refresh stays under 50 ms on a 1,000+ row fixture (reuse PR #21's timing test).

## Required deliverables

1. Red test, then the fix, green. `npm test`, `npm run check` and `npm run build` in `extension/` pass.
2. Mark TODO 3 done and update the plan's Status table.
3. One issue, one PR with "Closes #N" and `pr-evidence`. Squash-merge is autonomous once green; no release.

## Constraints

- One PR. Branch `fix/freshness`. No new runtime dependencies. No version bump (plan rule 5).
- Never install a dev build into live VS Code or the live Claude config.
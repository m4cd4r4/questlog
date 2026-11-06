# Questlog wave 3: stats Brief

Open this in a **fresh Claude Code session** in this worktree. Don't carry context from the session that wrote it.

## First action: rebase before doing anything else

```bash
git fetch origin main --quiet
git rebase origin/main
```

## The problem

Wave 2 (PR #26) now prunes old row files, and before each delete it writes one line to `~/.claude/questlog/ledger/YYYY-MM.jsonl`. Nothing reads the ledger yet. A person can't see what their sessions got done this month once the cards have gone.

## Source of truth (read these BEFORE coding)

1. `docs/no-bloat/PROJECT-PLAN.md`: rules 1-6 are settled, do not reopen them. This PR is wave 3. Rule 6: every new piece of display copy goes to Macdara as options BEFORE it is built.
2. `mod/hooks/retention.ts`: the ledger line (`ledgerLine`), its key (`ledgerKey`, `keysInLedger`) and the month file name (`ledgerMonth`). Also `mergeLedger` and the `.YYYY-MM.jsonl.prev` copy. The copy is a crash backup, so read the main `.jsonl` files, not the `.prev`.
3. `docs/CLAUDE-TODO.md` items 7 and 8:
   - `firstAt` is null for rows written before wave 2, so treat null as unknown.
   - A row spared mid-run can leave an early line, so count each session once, by its newest line per id.
4. `mod/hooks/register.tsx`: how commands are registered (`$.command.register`, `command.run`), e.g. `/sessions`.
5. `extension/src/model.ts`, `extension/src/webview.ts`, `extension/src/refresh.ts`: how the panel builds its view model, draws, and reads the rows folder async (never sync on a timer path).

If this brief contradicts the code, the code wins.

## Ledger line shape (written by wave 2)

`{ id, plan, done, total, repo, firstAt: number | null, lastAt, ended: 'finished' | 'closed' | 'unfinished' | 'no steps' }`, one JSON object per line. The month comes from `lastAt`, local time. Skip a torn line rather than failing on it.

## What's in scope

- `/questlog:stats` (or the name Macdara picks): a plugin command that reads the ledger and prints a summary.
- A "This month" section in the VS Code panel, read from the same ledger.
- Pure functions for reading the ledger and summing it. One shared reader if both builds can import it: `mod/hooks/close.ts` shows how the extension imports a mod file.
- Tests for the reader and the sums, with fixtures in neutral temp paths.

## Out of scope

- The retention job and the ledger format (wave 2, merged). If the format truly needs a change, stop and ask first.
- TODO 2, 4, 5, 6, 9 (deferred or separate).
- Version bumps and any release step (rule 5: the joint release with cornerman comes after all waves, and every step is ask-first).

## What "good" looks like

- Before any copy is built, Macdara picks it through `AskUserQuestion`: the command name, each summary line, and the section heading. Give 2-4 drafts each.
- The numbers are counts with their N (for example "12 of 15 finished"), never a bare percentage.
- The panel section reads the ledger off the refresh path, async, and costs nothing when there is no ledger.
- A month with no ledger file, an empty file, or torn lines shows a sensible empty state, never an error.

## Required deliverables

1. Copy options to Macdara first (rule 6). Log what he picks with `node ~/.claude/scripts/client-log.js` if it is a ruling.
2. Tests one at a time, red then green. `claude plugin test mod`, plus `npm test`, `npm run check`, `npm run build` in `extension/`.
3. One end-to-end run in the sandbox: `node ~/.claude/scripts/plugin-dev.mjs mod --seed <fixture>`, with a seeded ledger. `docs/no-bloat/retention-seed.mjs` shows the pattern. Never the live config.
4. A screenshot of the panel section, read before reporting (an Extension Development Host with a throwaway `--user-data-dir`; see `rules/dev-environment.md`).
5. Set wave 3 to done in the plan's Status table. Then open one issue and one PR with "Closes #N" and the `## Evidence` section from `pr-evidence`. Squash-merge is autonomous once green; no release.

## Constraints

- One PR. Branch `feat/stats`. No new runtime dependencies. No version bump.
- Never install a dev build into live VS Code or the live Claude config, and never point `CLAUDE_CODE_PLUGIN_DIRS` at this tree.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md`. Do not fix inline.

## Why this brief is structured this way

Stats wording is display copy that ships to every user, and rule 6 reserves it for Macdara. The ledger has two known quirks (null `firstAt`, an occasional early line). A reader that ignores them shows wrong numbers.
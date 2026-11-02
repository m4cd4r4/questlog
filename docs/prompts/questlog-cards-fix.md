# Questlog cards: fix before the v1 launch

Open this in a **fresh Claude Code session**. Don't carry context from the session that wrote it. Macdara ruled on 2026-11-02 that this ships before the Questlog launch.

## First action: rebase before doing anything else

```bash
git fetch origin main --quiet
git rebase origin/main
```

## The problem

A card's progress changes only when the session that owns it calls the `questlog` tool. If that session stops first, or another session finishes the work, the card keeps the old state. An amber "unfinished" card therefore means "this session did not report finishing", and it gets read as "this work is unfinished".

Case seen 2026-11-02: an examworthy card sat at 4 of 5 with "unfinished 5h". Its last step was to remove its worktree, which cannot run from inside that worktree, so another session did it and verified it. The owning session had gone, and no other session can write to its card.

The opposite failure also exists. Measured on the live data over the last 7 days: 143 rows had steps left, 13 showed as unfinished and 130 were hidden. Measured on 1.0.0 on 2026-11-02: a cleanly closed tab writes `ended: true` and vanishes from the list even with steps left; only a killed process goes amber.

## Source of truth (read these BEFORE designing or coding)

1. `extension/src/rows.ts`: `visibleRows`, `isStale`, `hasWorkLeft`, `canResume`.
2. `extension/src/model.ts`: card state, around the "stale session with work left" comment.
3. `mod/hooks/register.tsx` and `mod/hooks/lib.ts`: `writeRow`, `rowToWrite`, the `session.end` handler, the pane poll.
4. `README.md`: every line using "unfinished", plus the Session table.
5. `I:/Scratch/session-compass-questlog/docs/questlog-v1/PROJECT-PLAN.md`: section "Live check, 2026-11-02", then the launch order. That worktree is on `feat/questlog-rename` in the private dev repo.

If anything in this brief contradicts those files, the source files win.

## What's in scope

1. **The test first.** Three sessions in one folder, plus a fourth case: session A hands its last step to session B, B finishes it, A is closed. Pass: A's card no longer reads as open work, and the panel names B and the evidence. Cover both a killed process and a clean close. Fixtures use neutral paths, never real ones.
2. **Another session can close a card, with evidence.** It records who closed it and on what evidence. Design how a session names another session's card, and how a wrong or hostile close is limited.
3. **The 2-second pane poll.** The mod reads `panes/<id>.json` every 2 seconds and each miss logs a DEBUG ENOENT line. It fills `Claude VSCode.log` and the red box shown when a session crashes. Stop the noise without losing the pane toggle.
4. **Two decisions for Macdara, as options through `AskUserQuestion`. Never decide these alone:**
   - The word replacing "unfinished", if any. It is on 11 README lines, in 3 source files, on the filter tab, in the film and in the hero card's alt text. A rename means re-rendering the film and may touch the site's frames, so state that cost in the options.
   - How ended sessions with steps left are shown. Showing all 130 would swamp the panel, so bring options with their real counts from the rows.

## Out of scope (do NOT modify)

- The worktree registry moving at merge. That is his `~/.claude` tooling, a separate job.
- Reading git, GitHub or the registry to reconcile cards (item 2 of his issue). Of the 143 rows, 115 had no such signal. Capture it, don't build it.
- `/clear` carrying a plan across sessions. Capture it unless the test shows the fix needs it.
- The two tabs sharing a title, and restored tabs counting only once clicked. Capture them.

## What "good" looks like

- The handoff case above reads correctly in the panel, and names who finished the work and the evidence.
- A killed session and a cleanly closed session each behave as Macdara ruled.
- Old rows keep working: migration from `session-compass` still passes.
- `Claude VSCode.log` no longer gains a line every 2 seconds per session.

## Required deliverables

1. The failing test, before the fix.
2. The options for both decisions, put to him before building the parts they decide.
3. The code, one PR on `m4cd4r4/questlog` with an `## Evidence` section from `pr-evidence.mjs`.
4. A live check in the throwaway rig, with screenshots you have read, including the four-session case.
5. If the word changes: the film re-rendered from `I:/Scratch/release-kit/compass-nap-film` and `node I:/Scratch/release-kit/batman-cat/check-cat.mjs <film>/index.html` passing.

## The throwaway rig

`I:/Scratch/_questlog-check` has its own home, config, VS Code profile and extensions, with the plugin and extension installed. Driving scripts are in `I:/Scratch/_questlog-check/tools`: `ql-setup.mjs`, `ql-launch.mjs` (CDP 9250), `ql-cdp.mjs`, `ql-in.mjs`, `ql-tabs.mjs`, `ql-center.mjs`, `ql-rows.py`.

- Never use the live config. Say before you launch a VS Code window.
- The window runs at device pixel ratio 1.25: divide screenshot coordinates by 1.25 for clicks.
- `claude.exe` in the rig is found by `_questlog-check` in its command line. Kill only those.
- A session updated in the last 15 minutes shows the "Open anyway" warning. A repeat of that warning goes to the notifications centre with no toast.
- Rebuild and reinstall the `.vsix` to test the extension. `I:/Scratch/questlog-assets/` holds the current build.

## Constraints

- One PR. Branch: `feat/questlog-cards-fix`.
- Every new line of copy goes to Macdara as options first. No test counts in release copy.
- No tag, release, repo visibility change or Marketplace publish. Each is his yes on launch day.
- The repo is one squashed commit and private. Do not push this work anywhere public.
- After this merges, the live check must be repeated before launch.

## Out-of-scope follow-ups (capture, don't build)

Add them to the launch plan named above, or as a task on Vikunja project 46.

## Why this brief is structured this way

The panel's main word claims something it can't know, and the data shows failure in both directions. The test comes first because code that picks a session has broken here before, and the two launch-facing decisions are his, because they carry a film re-render and a public word.
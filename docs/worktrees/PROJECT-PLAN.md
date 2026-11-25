# Worktrees section: port plan

Status: plan written 2026-11-25. No code is ported until Macdara has read this. Owner: Macdara.

## What this is

A Worktrees block under each repo in the sidebar. It says which git worktrees can be closed, which hold
unsaved work, and closes one on a click. Claude sessions get one line about it at session start, and a small
CLI prints the same facts in a terminal.

It is already built and tested, in the wrong place. On 2026-11-25 it was written against this project's
earlier private repo (`session-compass-dev`, pull requests 43 to 49: 26 source files, 23 test files, about
8,800 lines with tests). Macdara ruled the same day: port it to Questlog. This plan says what copies as it
is, what has to be written again for Questlog, and what he still has to decide.

Nothing here has run in a real VS Code window yet. The source was checked with its tests, a type check, a
build and screenshots of the page drawn from seeded data.

## Decide first

Three answers are needed before the first port pull request. The rest are under "Questions for Macdara" and
can wait until the pull request they belong to.

| | Question | Claude recommends |
|---|---|---|
| A | The names (question 15). They become public at release. | CLI `questlog-wt`, settings under `questlog.worktrees.*`, mod option `worktree_line`, files in `questlog/worktrees/` |
| B | How many pull requests, and what is in each (question 16). | Three, in the order under "Pull requests". Closing gets its own because it removes folders. |
| C | The word "Close" (question 17). The sidebar already has a Close button that closes a card. | Worktree button and setting say "Remove worktree"; the card button keeps "Close" |

## Decisions already made (Macdara, 2026-11-25)

1. It is a section of the existing sidebar, not a new extension or plugin.
2. First job: say what can be closed.
3. Claude reads it through a CLI and one line at session start. No MCP server. The CLI cannot close anything.
4. Closing: one click per row, plus "Close all safe" for worktrees that are merged, clean and fully pushed.
   The list is shown before anything is removed.
5. Dev-server check, file-overlap warning, lost-brief flag and disk size are part of it.
6. No note board. The worktree registry stays the only plan store.
7. The mod finds the CLI through a small file the extension writes (`cli.json`), and runs it with `node` and a
   5 second limit. The path check refuses a network share and a drive-relative path.
8. The README says what the product touches, as a list: `gh pr list` is the one network request, and a
   worktree is removed only on a click. The wording is his pick from options.
9. Releases, version numbers, the Marketplace listing and every merge in this repo stay his.

## Verdicts

Each worktree gets one verdict and a one-line reason. First match wins, top to bottom.

| Verdict | When | Close offered |
|---|---|---|
| Missing | git lists it but the folder is gone | no; the reason names `git worktree prune` |
| Needs you | uncommitted or untracked files, unpushed commits, or a stash made on this branch | no |
| Busy | a dev server is listening from this folder, or the worktree is locked | no |
| Orphan | detached HEAD with a clean tree | yes, one at a time |
| Closable | its pull request is merged or closed, tree clean, nothing unpushed | yes, and in "Close all safe" only when merged |
| In flight | everything else, and anything whose pull request state or unpushed count is unknown | no |

The main checkout and bare entries are listed without a verdict and never get a close offer.

## Rules for every pull request

Carried from the source plan:

- **Truth comes from git and GitHub.** The registry only adds plan, wave, label and brief path to a worktree
  it happens to know.
- **Merged is asked of GitHub, never of git ancestry**, because a squash merge leaves no ancestry. One
  `gh pr list` per repo. Pull requests from a fork are ignored.
- **The scan never changes a repo.** No fetch, no prune, no `ls-remote`.
- **"Unpushed" has one meaning:** commits on HEAD reachable from neither the branch's upstream nor its pull
  request's head commit. When that cannot be counted the verdict is never Closable.
- **Dirty counts untracked files**, because `git worktree remove` refuses on them.
- **All new logic is pure and lives under `extension/src/worktrees/`**, with no `vscode` import. Git, `gh`,
  the file system and ports come in through a function passed in, so tests use fixtures.
- **Every function that picks a worktree, row or session has a test with three worktrees of one repo in one
  parent folder.**
- **Fixtures use made-up paths.** Tests write only under the OS temp folder. No test removes, creates or
  changes a real worktree: close is tested against a repo the test makes in the temp folder.
- **Windows first:** paths compare without regard to case or slash direction.

Added for Questlog:

- **No blocking file read in the extension host.** Issue 20 was this: reading every row file on each refresh
  froze VS Code. The source reads the scan cache, the scan claim, the registry and every row file with
  blocking calls. In Questlog each of these is read async or taken from what `Refresher` already holds.
  Blocking reads stay only in the CLI, which is its own process.
- **The model sent to the page stays small.** A month of steps once measured 760 KB on every refresh and was
  moved to "send on request". One machine here has 320 worktrees. The second pull request measures the
  model's size with 320 seeded worktrees; if the worktree part is over 100 KB, rows past the first ten of a
  repo are sent when the person opens them, as month steps are. (The 100 KB line is Claude's.)
- **Questlog deletes only files it wrote** (no-bloat rule 1). The scan cache, the claim and `cli.json` sit in
  `questlog/worktrees/`. The retention job and the row reader must leave that folder alone, and a test says so.
- **New words a person reads go to Macdara as options first** (no-bloat rule 6): labels, tooltips, setting
  descriptions, the confirmation, README and CHANGELOG lines. The source's wording is the starting option,
  with the product's name changed.
- **Every pull request that changes what a person sees carries screenshots from seeded data**, at 300px and
  420px sidebar widths, dark and light. He sees the build in a throwaway VS Code window before a merge card.
- **No Extension Development Host without saying so first.** No install into a live config. No version change.
- **Each port pull request lists, per file: copied unchanged, copied with names changed, or rewritten.**

## What copies and what is rewritten

Found by reading both sides (source at its last commit, Questlog at v1.2.0).

### Copies with names changed only

Twenty of the 26 files under `extension/src/worktrees/` and their tests: every file not named in the next
table. They import four helpers from
`rows.ts` (`ago`, `cut`, `norm`, `inside`) and types from `plans.ts`.

| Needed in Questlog | Today |
|---|---|
| `rows.ts` exports `cut`, `norm`, `inside` | all three are private; `ago` is exported |
| one path normaliser | `rows.ts` has it twice (`norm` and `flat`); `flat` goes |
| `RegistryEntry` gains `brief_local_path`, `brief_full_text`, `created_at`, `materialised_at` | not there |
| a second build output, the CLI as one file with no dependencies | `esbuild.mjs` builds the extension only |
| `scripts/panel-preview.ts`, which draws the page from seeded data for screenshots | Questlog has none; `tsconfig.json` and `.vscodeignore` each gain one line for it |

### Rewritten for Questlog

| Part | Why it cannot be copied |
|---|---|
| `sources.ts`, `refresh.ts`, `scan.ts` (reading), `claim.ts` | Blocking reads. The scan takes its lists of session folders and registry entries as arguments. The host passes what `Refresher` holds; the CLI reads them itself. The cache is read by an async reader shaped like `LedgerReader`, and written async. |
| `extension.ts` wiring | Questlog's refresh is async and single-flight (`refreshOnce`, `update`, `draw`); the source's was one blocking function. The scan timer, the claim, the after-close step and the four new page messages are fitted to that. `Refresher` gains a way to hand out the registry entries it already reads. |
| `model.ts` | `buildModel` here also builds ended cards and "This month". `GroupModel` gains `worktrees` beside `ended`. `CardStep` gains the status `needs` beside Questlog's own `not needed`. The plan card takes live slice facts from the scan. |
| `webview.ts` | Same row and block drawing, placed into a page that also has the ended line and "This month". The key list, focus list and state pruning each gain the worktree entries. Where the block sits is question 18. |
| The in-use check before a close | `close.ts` itself copies. The source's host reads every row file on a click to see whether a session is running in the folder. Here the host passes the rows in memory and the live session list. |
| `cli.ts` | Names, and it reads the session folders and the registry itself, since the scan no longer does. |
| `mod/hooks/register.tsx` | The session-start handler here returns early after `/clear` with the carried plan. The worktree line has to be added on a fresh start and after `/clear`, beside that carry, and never lose it. |
| `mod/hooks/lib.ts`, `clipath.ts` | The source keeps the CLI's file name and the `cli.json` name twice, once per side. Questlog's extension already imports from `mod/` (`stats.ts`), so the names and the path check live once, in `mod/hooks/lib.ts`. |
| Every name | Data folder, CLI, settings, option, output channel, messages. See question 15. |

### Not needed

- A settings migration. `migrate.ts` copies four old settings; the worktree settings were never released
  under the old name.
- New VS Code commands (question 9).

### Fixed on the way (review notes not taken in the source)

- The first-line-of-stderr helper exists three times (`close.ts`, `collect.ts`, `scan.ts`): one copy.
- `WorktreeBlock.closable` has no reader, and `makeCloser().busy` is read only by a test: both go.
- The batch report counts kept branches by comparing a note's text: it counts from the result's field.
- A close command setting that is not a string would throw: it is read as empty.

## Names

| Thing | In the source | In Questlog (recommended) |
|---|---|---|
| Data folder | `session-compass/worktrees/` | `questlog/worktrees/` under the Claude config folder |
| Scan cache, claim, CLI path | `scan.cache`, `scan.claim`, `cli.json` | the same |
| CLI file and command | `compass-wt.mjs`, `compass-wt` | `questlog-wt.mjs`, `questlog-wt` |
| Settings | `sessionCompass.worktrees.enabled`, `.scanMinutes`, `.parallel`, `.perRepoSeconds`; `sessionCompass.closeCommand` | `questlog.worktrees.enabled`, `.scanMinutes`, `.parallel`, `.perRepoSeconds`, `.removeCommand` |
| Mod option | `worktree_line` | `worktree_line` |
| Page messages | `copyPath`, `closeWorktree`, `closeAllSafe` | the same; `close` stays the card's |

`questlog.closeCommand` would read as a setting about closing a card, so it moves under `worktrees`.

## Pull requests

Each is one worktree and one branch from `origin/main`, and each links one issue. Order matters.

| # | Title | In it | A person sees |
|---|---|---|---|
| 1 | Scan and CLI | `extension/src/worktrees/` without the page parts, its tests, the second build output, the `rows.ts` and `plans.ts` changes, `questlog-wt scan`, `list`, `show`, `brief` | Nothing in the sidebar. A new command in a terminal. |
| 2 | The Worktrees block | `view.ts`, `slices.ts`, `sequence.ts` wiring, the scan timer and claim, model and page changes, settings, the preview script, the model size check, `cli.json` and the mod's session-start line | The block, live slice facts on plan cards, sequences, Open and Copy path. One line at session start. No close. |
| 3 | Removing a worktree | `close.ts`, the two close messages, the confirmation, the remove command setting, "Close all safe" | The remove button on a row and the batch button. |

README and CHANGELOG lines ride with the pull request that makes them true, as options for him. Pull request
2 is the first that runs `gh pr list` without being asked, so the "what it reads and sends" lines change there.

Why three: the first has no visible change and is nearly a straight copy, so it reviews fast. The third
removes folders, and a change that deletes gets a pull request to itself.

How each is checked: `npm test`, `npm run check` and `npm run build` in `extension/`; the mod's tests with
`node --test mod/hooks/*.test.ts`; the mod in a `plugin-dev.mjs` sandbox; screenshots read at both widths;
and for 2 and 3 a throwaway VS Code window with seeded worktrees in the OS temp folder.

## What is left out

- A note board, an MCP server, a close command in the CLI.
- Releases, version numbers, the Marketplace listing.
- Closing any real worktree. The backlog is cleared by Macdara with the finished section.
- Repairing the registry so it knows every worktree.
- A list of folder names that are safe to discard (question 1), until he answers.

## Questions for Macdara

Fifteen to nineteen are new for the port. One to fourteen are carried from the source plan, where none was
answered; each says what the code does today. "Row" means a row of the source plan's task table.

### Worth an answer before release

1. **Untracked leftovers block most closes.** A full scan on 2026-11-25 found 218 of 318 worktrees read
   Needs you; 108 of those had untracked files and nothing else, mostly tool output (`.shots`,
   `.playwright-mcp`) and sometimes `docs` or `scripts`. Should a merged worktree holding only named
   discardable folders read Closable? Nothing is built for this.
2. **Scan limits.** Defaults are one worktree at a time and 20 seconds per repo. On that machine this left
   161 of 318 worktrees unread; six at a time and 120 seconds read all of them in 56 seconds, with up to 24
   git processes at once. Both are settings. Recommended: 6 and 120.
3. **Deleting the local branch after a close.** The code uses `git branch -d`, which usually refuses after a
   squash merge, so the report says "folder removed, branch kept". Force the delete once the re-check has
   shown nothing unpushed?
4. **Worktrees holding a linked `node_modules`.** The default refuses them and points at the remove command
   setting. On a machine that links `node_modules` into every worktree, that is most of them. Should the
   default unlink (never following the link) and then remove?
5. **Ignored files.** `git worktree remove` deletes ignored files (`.env.local`, a local database) in a
   worktree it calls clean. The confirmation says so. Should any ignored name block a close, or be listed?
6. **Batch close.** "Close all safe" skips a worktree that is refused and carries on; the source plan said
   stop at the first failure. Which?

### Where the code differs from the source plan's wording

7. **Detached HEAD with commits nothing else holds** reads Needs you, and one whose commits cannot be
   counted reads In flight. The verdict table above would call both Orphan and offer a close that loses the
   commits. Recommended: keep the code and change the table.
8. **Size cache key** is the root folder's modified time plus the HEAD commit, with a 24 hour limit. The row
   said the newest modified time inside the folder, which needs the walk the cache is there to save.
9. **Copy path** writes to the clipboard directly; there is no command for it. Add one, or leave it?
10. **File overlap** also compares Busy worktrees; the row named Needs you and In flight only.
11. **Dev servers** come from the OS port table joined with PortPilot's files, where the row said PortPilot
    first and the port table as a fallback. A stopped PortPilot app reads Busy while another process holds
    its old port.
12. **What counts as a step in a worktree name:** one of eight words plus a number (`s`, `slice`, `step`,
    `wave`, `phase`, `round`, `part`, `stage`), anywhere in the name; never a bare number or a single
    letter. `upload-s3` also matches.
13. **Where two guards are tested:** the single-scan guard in `worktrees-due.test.ts` and the close guard in
    `worktrees-view.test.ts`, where the rows named `live.test.ts` and `model.test.ts`.
14. **"The long run" section** of the source plan was written by Claude from a card. It is not carried here.

### New for the port

15. **Names**, as in the table above.
16. **Three pull requests**, as in the table above. The card said two to three.
17. **"Close" means two things.** A card's Close button records that its plan is done. A worktree's Close
    removes a folder. Options: (a) worktree button "Remove worktree", batch "Remove N safe", setting
    `removeCommand`; (b) both say Close; (c) rename the card button to "Mark done" (already asked for in
    `docs/CLAUDE-TODO.md` item 13) and keep Close for worktrees.
18. **Where the block sits in a repo's group.** After the session cards and before the "ended" line, or last
    in the group. The source had no ended line. Both are shown in pull request 2's screenshots.
19. **After the port:** does this ship as 1.3.0 or wait to be batched with other work, and is
    `session-compass-dev` archived once the three are merged?

## What was built

Nothing yet. Each pull request adds a section here: what was built, what Claude decided, and what was measured.

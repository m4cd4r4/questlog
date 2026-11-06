# No-bloat plan: Questlog (with cornerman in parallel)

Decided with Macdara on 2026-11-06 (grilling session). Cornerman has a matching plan in m4cd4r4/cornerman
`docs/no-bloat/PROJECT-PLAN.md`. Goal: a plugin that stays fast and small however long it is used.

## Facts behind it

- Closing a tab only hides its card. Nothing ever deletes a row file: `~/.claude/questlog` held 1,073 files on
  2026-11-06, most of them ended.
- A finished card leaves the view after `GONE_MS` (24 h); an unfinished one after `PARKED_MS` (7 days).

## Rules (settled, do not reopen)

1. Questlog deletes only files it wrote itself (row `.json` and its `.close`).
2. Before a row is deleted, one line about it (plan, steps done of total, repo, first and last update, how it
   ended) goes to a monthly ledger, `~/.claude/questlog/ledger/YYYY-MM.jsonl`.
3. Deletion runs in the plugin (`mod/`), not the extension, because some users have only the plugin: a
   SessionStart hook starts a detached job and returns at once; a marker file skips it when it ran in the last
   24 h.
4. Retention, counted from the row's last update: finished 7 days, unfinished 30 days.
5. ~~No release until all three waves are merged here and in cornerman; then both ship together.~~ Changed by
   Macdara on 2026-11-06: Questlog ships 1.1.0 once its own three waves are merged, without waiting for
   cornerman. Cornerman reads Questlog rows only to match a live tab to its session, and retention never deletes
   a live row, so neither release depends on the other. Every release step is ask-first. Version bumps only in
   the release PR.
6. New display copy (stats wording) goes to Macdara as options before it is built.

## Waves

| Wave | Slug | PR | TODO items |
|---|---|---|---|
| 1 | `freshness` | Reread rows updated in the last few minutes on the 5-minute rescan, so a same-size rewrite in one mtime tick is not missed | 3 |
| 2 | `card-retention` | Ledger line, then delete per rule 4, from the plugin's SessionStart job | 1 |
| 3 | `stats` | `/questlog-stats` command and a "This month" panel section, read from the ledger and the rows still on disk. Wording as options first | new, 7, 8 |

Deferred: TODO 2 (tab switch runs a full refresh, about 2 ms) and 4 (sync fs on click paths).

## Status

| Wave | Slug | State |
|---|---|---|
| 1 | freshness | done (#23) |
| 2 | card-retention | done |
| 3 | stats | done |
| - | release 1.1.0 | #31 merged. Mod version held at 1.0.0 on main (the GitHub marketplace serves main) until the retention stress tests pass; the extension is published separately |

# Questlog TODO (follow-ups captured by Claude sessions)

## From the exthost-freeze fix (2026-11-05)

1. **Prune the rows folder.** `~/.claude/questlog` held 1,063 row files on 2026-11-04, 859 of them ended; nothing ever deletes one. The refresh no longer reads them all, but the first read at activation and every watcher rescan still do. A retention rule (for example: ended and past `PARKED_MS`, with its `.close`) would keep the folder small. Needs a decision on who deletes (mod or extension) and when.
2. **Tab focus moves run a full refresh.** `onDidChangeTabs` calls `update`, which now does an async refresh (cheap, ~2 ms block) before drawing. A focus move only needs `draw()`. Worth splitting if the panel ever feels laggy on tab switches.
3. **Click paths still use sync fs.** Toggling the pane flag, dismissing a card, undo-close and the hand-close write are sync (`isPaneOpen`, `setPaneOpen`, `readDismissed`/`saveDismissed`, `writeClose`). Each touches one small file on a user click, never on a timer, so it was left out of scope.

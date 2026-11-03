# Changelog

All notable changes to the Questlog mod and VS Code extension (called Session Compass before 1.0.0). Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The mod and the extension are versioned separately until 1.0.0.

## 1.0.0 - unreleased

### Changed
- Session Compass is now Questlog. The tool and the `/compass` command are `questlog` and `/questlog`, the plugin ID is `questlog`, and settings moved from `sessionCompass.*` to `questlog.*`.
- Session data moved from `~/.claude/session-compass` to `~/.claude/questlog`.
- A tab closed with steps left waits behind one line per repo for 24 hours. It used to vanish.

### Added
- On first run, Questlog copies your old session data and settings across, so existing sessions keep their plans. The old folder stays in place.
- A session can close another session's card in the same repo (`questlog_close`) by accounting for every open step: finished with what proves it, or not needed with why. The panel has a Close button that asks the same of you. The card names who closed it and each reason; Undo close takes it back.
- A step can carry a check, a path that proves it done when it exists or when it is gone. Once its session is gone, the panel closes the card when every open step checks out.
- At the end of a turn that ran tools that change things (edits, shell, agents, other tools that act), Claude reports its steps once more, so the card's count is current. A turn of reads alone (Read, Grep, Glob, web search) is not stopped for a report.

### Fixed
- A closed card stays closed when its session is reopened and only restates its steps. Reporting the same plan and step list no longer counts as news; a step that moves still brings the card back.
- Closing a card from the panel while another session closes it first leaves that close in place and says so, instead of writing over it.
- A card whose session is waiting on you now keeps the close it carries, with Undo close, instead of offering a second Close that refuses.
- A closed card reads the same everywhere: the status bar, the hover tooltip and the details page now show the steps as the close accounted for them (finished or not needed, with the reason), the whole count, and no "Now" line. They used to disagree with the card.
- The panel only reads rows whose id is a session ID, and only checks step paths that are local: a UNC or URL path in a step check is skipped instead of being probed on every tick.
- The sidebar no longer keeps a remembered open state for repos that have left the view.
- A session from before step lists shows its own count again. It read 0 of N after the close accounting change.
- A session whose Claude process has ended now gets the play button straight away, from any window. It used to show as unfinished with no button for up to 6 hours if its folder wasn't open.
- The pane check no longer writes a log line every 2 seconds per session.

## Extension 0.5.1 - unreleased

### Added
- Unfinished sessions (plan steps left) get a play button that reopens them in a Claude tab.
- If the folder isn't open in this window, it copies the resume command instead.
- Recent sessions ask first, in case they are running in another window.
- A session waiting on you shows a red "Needs you" card with the reason (permission prompt, input needed), and a "needs you" count in the summary strip. The panel reads this from `claude agents --json` while it is showing, at most every 10 seconds.
- A session whose Claude process has ended shows as unfinished straight away instead of after 6 hours.
- Settings `sessionCompass.useAgentView` (on by default) and `sessionCompass.agentViewSeconds`. If `claude` cannot be run, the panel uses the session files alone and says so once in the "Session Compass" output channel.

### Changed
- The Held legend and filter are now called Unfinished.

## Mod 0.7.0 - 2026-10-30

### Changed
- The session ID in the tab title now shows only when another live session has the same title. The new `session_tag` option sets it to `clash` (default), `always` (the old behaviour) or `never`.

## Mod 0.6.0 and extension 0.5.0 - 2026-10-23

### Added
- The Sessions view is redrawn as cards: a summary strip of counts, All, Active and Held filters, sessions grouped by repo, a progress bar and the step in progress on each card (#28).
- A session with plan steps left that has been quiet for 6 hours shows as paused (amber, with its age) and stays for 7 days. Finished sessions still drop after 24 hours (#28).
- Hover a card and click x to hide it. It comes back if the session updates. Hidden sessions are kept in `~/.claude/session-compass/dismissed.json` (#28).
- Blocked slices of a parent plan have their own red state, and a plan with only blocked slices reads as held (#28).
- Hovering a session lists every step, and clicking a step shows its detail (#25).
- The `compass` tool takes an optional `detail` per step: one or two plain sentences on what the step covers (#25).
- The guide covers resumed sessions: after `/clear`, a handover or a restart note, the first tool call is `compass` (#25).

### Fixed
- Keyboard focus stays on the same control when the view redraws, and Enter or Space on a card's own buttons runs the button (#28).
- Open and closed steps stay with the step when a plan is reordered (#28).
- The extension opens a worktree or copies resume text only when the registry offered it (#28).
- The Compass panel opened by the poll is retried when the panel was waiting undrawn (#27).
- The status bar and footer no longer guess between sessions that share a folder. A tab with no matching session now shows nothing instead of the newest session in that folder, so a click can no longer toggle another session's panel (#25).

## Mod 0.5.0 and extension 0.4.0 - 2026-10-18

### Added
- The extension shows parent plans from the worktree registry, with a resume action per slice (#21).

### Changed
- The Compass panel is off by default and is turned on per session from the hover card. The `status_line` option controls the status line (#23, #24).

## Mod 0.4.4 - 2026-10-15

### Added
- The session title leads with the first six characters of the session ID (#15).
- The tooltip shows the full session ID with a Copy link and a context-menu command (#16).

### Fixed
- Tabs without a plan show the first prompt, sent only when it changes (#13).
- Injected prompts stay out of the tab title, and a saved plan survives reopening a session (#10).

## 0.4.0 to 0.4.3 - 2026-10-12 to 2026-10-13

### Added
- The VS Code sidebar of live sessions, a status-bar summary that follows the focused Claude tab, and a restart note in the sidebar and in every fresh session (#1, #2).

### Fixed
- The status bar follows a tab whose label VS Code cut short (#7).
- Sessions that never got a message or a plan are hidden (#8).
- Rows are written to `~/.claude` when the mod lives outside it.

## Initial release - 2026-10-12

- The Session Compass mod, moved out of a private dev-mods folder into its own repository. Session rows carry steps, branch and working directory for the sidebar.

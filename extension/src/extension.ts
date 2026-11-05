import { mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { decodeCache, encodeCache, parseAgents, type LiveState } from "./live";
import { MIGRATED_KEY, migrateSettings, OLD_SECTION } from "./migrate";
import { buildModel, parseMessage, type WebMessage } from "./model";
import { DISMISSED_FILE, LIVE_CACHE_FILE, readText, Refresher } from "./refresh";
import { pageHtml } from "./webview";
import {
  COPY_RESUME_COMMAND, DEFAULT_RESUME, isOfferedByPlans, OPEN_WORKTREE_COMMAND, openSlices, planOnlyRepos, plansForRepo, planSummary, resumeFromArg,
  sliceDescription, sliceLabel, worktreeFromArg, type ParentPlan, type Slice, type SliceState,
} from "./plans";
import {
  bar, COPY_ID_COMMAND, copyIdLink, description, groupByRepo, inOpenFolder, isInWorkspace, isStale, NOTE_FILE, PANE_COMMAND, paneLink, paneOpenOf, planOf,
  canResume, CLOSE_EXT, closeByHand, dismissedFrom, handCloseBlocked, hasWorkLeft, isSessionTab, resumeCommandOf, rowForTab, rowForWorkspace, sessionTagOf, type Close, type CloseStep, type Dismissed,
  sessionIdFromArg, statusText, stepsOf, visibleRows, accountedSteps, doneOf, nowOf, type AccountedStep, type Group, type Row,
} from "./rows";

const VIEW = "questlog.sessions";
// Ages in the tree and staleness tick on with no file change
const TICK_MS = 30_000;
// Every this many ticks (5 minutes) the rows folder is rescanned, in case the watcher missed a change
const RESCAN_TICKS = 10;
// `claude agents --json` starts a process: ask at most every questlog.agentViewSeconds, never faster than this
const MIN_LIVE_S = 5;
// An unfocused window keeps showing a shared answer up to this many intervals old
const STALE_LIVE_TICKS = 6;

/** Same folder the mod writes to: CLAUDE_CONFIG_DIR, else ~/.claude. */
const rowsDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "questlog");

const closePath = (id: string) => join(rowsDir(), `${id}${CLOSE_EXT}`);

// The rows folder, held in memory; extension writes say which file they touched, so the next refresh sees them at once
const refresher = new Refresher(rowsDir, (e) => void vscode.window.showWarningMessage(`Questlog could not close that card: ${e instanceof Error ? e.message : String(e)}`));

function writeClose(id: string, close: Close) {
  try {
    writeFileSync(closePath(id), JSON.stringify(close));
    refresher.changed(`${id}${CLOSE_EXT}`);
  } catch (e) {
    void vscode.window.showWarningMessage(`Questlog could not close that card: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// One flag per session; the mod polls it and opens or closes its Questlog pane
const paneFlag = (id: string) => join(rowsDir(), "panes", `${id}.json`);

function isPaneOpen(id: string) {
  try {
    return paneOpenOf(readFileSync(paneFlag(id), "utf8"));
  } catch {
    return false;
  }
}

function setPaneOpen(id: string, open: boolean) {
  mkdirSync(join(rowsDir(), "panes"), { recursive: true });
  writeFileSync(paneFlag(id), JSON.stringify({ open }));
}

const dismissedPath = () => join(rowsDir(), DISMISSED_FILE);

function readDismissed() {
  try {
    return dismissedFrom(readFileSync(dismissedPath(), "utf8"));
  } catch {
    return {};
  }
}

/** Adds one hidden session, drops entries for sessions that no longer have a row, and swaps the file in whole so a crash or a second window never leaves half a file. */
function saveDismissed(id: string, updatedAt: number, liveIds: readonly string[]) {
  const live = new Set(liveIds);
  const next = Object.fromEntries(Object.entries({ ...readDismissed(), [id]: updatedAt }).filter(([k]) => live.has(k)));
  const tmp = `${dismissedPath()}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next));
    renameSync(tmp, dismissedPath());
    refresher.changed(DISMISSED_FILE);
  } catch (e) {
    void vscode.window.showWarningMessage(`Questlog could not hide that session: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const liveCachePath = () => join(rowsDir(), LIVE_CACHE_FILE);

/** Swapped in whole, like the dismissed file, so a second window never reads half of it. */
async function writeLiveCache(live: Map<string, LiveState> | undefined) {
  const tmp = `${liveCachePath()}.${process.pid}.tmp`;
  try {
    await mkdir(rowsDir(), { recursive: true });
    await writeFile(tmp, encodeCache(Date.now(), live));
    await rename(tmp, liveCachePath());
  } catch {
    // no cache: the next window to ask just asks for itself
  }
}

const notePath = () => join(rowsDir(), NOTE_FILE);

const folders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

const expandHome = (p: string) => (p.startsWith("~/") || p === "~" ? join(homedir(), p.slice(1)) : p);

/** The worktree registry: the setting, else workspaces/registry.json beside the session rows. */
const registryPath = () => {
  const set = vscode.workspace.getConfiguration("questlog").get<string>("registryPath")?.trim();
  return set ? expandHome(set) : join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "workspaces", "registry.json");
};

const STEP_MARK: Record<AccountedStep["status"], string> = {
  done: "$(pass-filled)",
  now: "$(arrow-right)",
  todo: "$(circle-large-outline)",
  "not needed": "$(close)",
};
const MAX_TOOLTIP_STEPS = 25;
const SHOW_DETAILS_COMMAND = "questlog.showDetails";
const DETAILS_VIEW_TYPE = "questlog.details";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Read-only page for one session, drawn in VS Code's own colours. */
function detailsHtml(r: Row, now: number) {
  const mark: Record<AccountedStep["status"], string> = { done: "&#10003;", now: "&#8594;", todo: "&#9675;", "not needed": "&#10005;" };
  // The same accounted view the card draws, so a closed step reads closed here too
  const steps = accountedSteps(r)
    .map((s) => `<li class="${s.status.replace(" ", "-")}"><span class="m">${mark[s.status]}</span><span>${esc(s.text)}${s.detail ? `<span class="d">${esc(s.detail)}</span>` : ""}</span></li>`)
    .join("");
  const where = [r.repo, r.where || r.branch].filter(Boolean).join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px 20px;line-height:1.5}
h1{font-size:1.4em;margin:0 0 4px}
.meta{color:var(--vscode-descriptionForeground);margin:0 0 14px}
code{font-family:var(--vscode-editor-font-family)}
ul{list-style:none;padding:0;margin:12px 0 0}
li{padding:4px 0;display:flex;gap:10px}
.m{width:1.2em;text-align:center;flex:none}
li.done,li.not-needed{color:var(--vscode-descriptionForeground)}
li.now{font-weight:600;color:var(--vscode-textLink-foreground)}
.d{display:block;font-weight:400;color:var(--vscode-descriptionForeground);margin-top:2px}
</style></head><body>
<h1>${esc(planOf(r))}</h1>
<p class="meta">${r.total > 0 ? `${doneOf(r)}/${r.total} done` : "no steps yet"}${isStale(r, now) ? " · idle" : ""}${r.closed ? `<br>Closed by ${esc(r.closed.by.slice(0, 6))}${r.closed.byPlan ? ` ${esc(r.closed.byPlan)}` : ""}${r.closed.evidence ? `: ${esc(r.closed.evidence)}` : ""}` : ""}<br>${esc(where)}<br><code>${esc(r.cwd || "")}</code><br>Session <code>${esc(r.id)}</code> · updated ${esc(new Date(r.updatedAt).toLocaleTimeString())}</p>
<ul>${steps}</ul>
</body></html>`;
}

function tooltip(r: Row, now: number, scope: string, paneOpen: boolean) {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${planOf(r)}**${scope ? ` · ${scope}` : ""}\n\n`);
  const done = doneOf(r);
  if (r.total > 0) md.appendMarkdown(`\`${bar(done, r.total)}\` ${done}/${r.total}\n\n`);
  // The same accounted view the card draws: a closed step reads closed here too
  const steps = accountedSteps(r);
  // The arrow row marks the current step; "Now" is only spoken when the list cut hides it
  const current = nowOf(r);
  if (current && !steps.slice(0, MAX_TOOLTIP_STEPS).some((s) => s.status === "now")) md.appendMarkdown(`Now: ${current}\n\n`);
  steps.slice(0, MAX_TOOLTIP_STEPS).forEach((s, i) => {
    md.appendMarkdown(`${STEP_MARK[s.status]} `);
    md.appendText(s.text);
    md.appendMarkdown(i === Math.min(steps.length, MAX_TOOLTIP_STEPS) - 1 ? "\n\n" : "  \n");
  });
  if (steps.length > MAX_TOOLTIP_STEPS) md.appendMarkdown(`and ${steps.length - MAX_TOOLTIP_STEPS} more\n\n`);
  const where = [r.repo, r.where || r.branch].filter(Boolean).join(" · ");
  if (where) md.appendMarkdown(`${where}\n\n`);
  if (r.cwd) md.appendMarkdown(`\`${r.cwd}\`\n\n`);
  md.appendMarkdown(`Session \`${r.id}\` [Copy](${copyIdLink(r.id)}) · [${paneOpen ? "Hide panel" : "Show panel"}](${paneLink(r.id)})\n\n`);
  md.isTrusted = { enabledCommands: [COPY_ID_COMMAND, PANE_COMMAND] };
  md.appendMarkdown(`Updated ${new Date(r.updatedAt).toLocaleTimeString()}${isStale(r, now) ? " (idle)" : ""}`);
  return md;
}

/** The Questlog view: a webview fed a pure view model; the page posts messages back. */
class QuestlogView implements vscode.WebviewViewProvider {
  rows: Row[] = [];
  note: string[] = [];
  plans: ParentPlan[] = [];
  dismissed: Dismissed = {};
  /** The 6 character tags of the Claude tabs open in this window, and the folders it has open. */
  openTags: ReadonlySet<string> = new Set();
  folders: string[] = [];
  /** Running sessions per `claude agents --json`; undefined until read, or when the command is off or fails. */
  live: Map<string, LiveState> | undefined;
  /** The session whose tab last had focus in this window; sticky while a file has focus. */
  focusedId: string | undefined;
  view: vscode.WebviewView | undefined;

  constructor(private readonly onMessage: (m: WebMessage) => void) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = randomBytes(16).toString("hex");
    view.webview.html = pageHtml(nonce, view.webview.cspSource);
    view.webview.onDidReceiveMessage((v: unknown) => {
      const m = parseMessage(v);
      if (m) this.onMessage(m);
    });
    // Showing the panel is when this window starts asking `claude agents` again
    view.onDidChangeVisibility(() => this.onVisible?.());
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  onVisible: (() => void) | undefined;

  fire() {
    const model = buildModel({ rows: this.rows, plans: this.plans, note: this.note, now: Date.now(), focusedId: this.focusedId, dismissed: this.dismissed, openTags: this.openTags, folders: this.folders, live: this.live });
    void this.view?.webview.postMessage({ type: "model", model });
  }
}

export function activate(context: vscode.ExtensionContext) {
  if (!context.globalState.get(MIGRATED_KEY)) {
    void Promise.resolve(migrateSettings(vscode.workspace.getConfiguration(OLD_SECTION), vscode.workspace.getConfiguration("questlog")))
      .then(() => context.globalState.update(MIGRATED_KEY, true))
      .catch(() => undefined);
  }
  const tree = new QuestlogView((m) => {
    switch (m.type) {
      case "ready":
      case "refresh":
        update();
        break;
      case "details":
        void vscode.commands.executeCommand(SHOW_DETAILS_COMMAND, m.id);
        break;
      case "copyId":
        void vscode.commands.executeCommand(COPY_ID_COMMAND, m.id);
        break;
      case "copySessionResume": {
        // The page only names a session; the host rebuilds the command from the row, so the page cannot choose the text
        const row = tree.rows.find((x) => x.id === m.id);
        // Same test the page's button used, re-run here: a row that does not offer the button is ignored
        const closed = !!row && (row.ended || (tree.live !== undefined && !tree.live.has(row.id)));
        const text = row && canResume(row, Date.now(), tree.openTags, tree.folders, closed) ? resumeCommandOf(row) : undefined;
        if (!row || !text) break;
        const copy = () => vscode.env.clipboard.writeText(text).then(() => vscode.window.setStatusBarMessage("Copied resume command: paste it in a terminal", 4000));
        // Reopen in a Claude tab when this window has the session's folder open; otherwise, or if the Claude extension has no such command, copy the command
        const here = row.cwd !== undefined && inOpenFolder(row.cwd, tree.folders);
        const go = () => (here ? Promise.resolve(vscode.commands.executeCommand("claude-vscode.editor.open", row.id)).catch(copy) : copy());
        // Questlog cannot see other windows or terminals: a session updated in the last 15 minutes may still be running there
        if (Date.now() - row.updatedAt < 15 * 60 * 1000) {
          void vscode.window
            .showWarningMessage("This session was active in the last 15 minutes and may be running in another window or a terminal.", "Open anyway", "Cancel")
            .then((pick) => { if (pick === "Open anyway") void go(); });
        } else void go();
        break;
      }
      case "dismiss": {
        const row = tree.rows.find((x) => x.id === m.id);
        if (row) {
          saveDismissed(row.id, row.updatedAt, tree.rows.map((x) => x.id));
          update();
        }
        break;
      }
      case "undoClose": {
        // Only a row this window read a close for, so the page cannot name a path
        const row = tree.rows.find((x) => x.id === m.id && x.closed);
        if (!row) break;
        // Whoever made it, a check would close the card again on the next tick: the close stays on disk, marked undone, until the session reports
        writeClose(row.id, { ...row.closed!, undone: true });
        update();
        break;
      }
      case "close":
        void closeFromPanel(m.id);
        break;
      case "pane":
        void vscode.commands.executeCommand(PANE_COMMAND, m.id);
        break;
      case "copyResume":
        if (isOfferedByPlans(tree.plans, "resume", m.text)) void vscode.commands.executeCommand(COPY_RESUME_COMMAND, m.text);
        break;
      case "openWorktree":
        if (isOfferedByPlans(tree.plans, "worktree", m.path)) void vscode.commands.executeCommand(OPEN_WORKTREE_COMMAND, m.path);
        break;
      case "openNote":
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(notePath()));
        break;
    }
  });
  const viewReg = vscode.window.registerWebviewViewProvider(VIEW, tree);

  /** The person accounts for every open step, one at a time: finished, or not needed with a reason. Escape anywhere closes nothing. */
  async function closeFromPanel(id: string) {
    const row = tree.rows.find((x) => x.id === id);
    if (!row) return;
    if (row.closed) return void vscode.window.showInformationMessage(`Already closed by ${row.closed.by}. Undo that close first.`);
    if (!hasWorkLeft(row)) return;
    const steps: CloseStep[] = [];
    const title = `Close "${planOf(row)}"`;
    const open = stepsOf(row).filter((x) => x.status !== "done");
    // A row that counts steps it never listed has nothing to go through one by one: one reason for the lot
    if (open.length === 0) {
      const reason = await vscode.window.showInputBox({ title, prompt: "What proves the work is done", ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : "Give a reason") });
      if (reason === undefined) return;
      steps.push({ text: planOf(row), outcome: "finished", why: reason.trim() });
    }
    for (const s of open) {
      const pick = await vscode.window.showQuickPick(["Finished", "Not needed"], { title, placeHolder: s.text, ignoreFocusOut: true });
      if (!pick) return;
      let why = "";
      if (pick === "Not needed") {
        const reason = await vscode.window.showInputBox({ title, prompt: `Why "${s.text}" is not needed`, ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : "Give a reason") });
        if (reason === undefined) return;
        why = reason.trim();
      }
      steps.push({ text: s.text, outcome: pick === "Finished" ? "finished" : "not needed", why });
    }
    // The session may have reported, or another session closed the card, while the prompts were up: read the disk,
    // not tree.rows (the watcher may not have fired yet), so neither is overwritten without a word
    const fresh = await refresher.fresh(id);
    const blocked = handCloseBlocked(row, fresh.row, fresh.close);
    if (blocked) return void vscode.window.showInformationMessage(blocked);
    writeClose(row.id, closeByHand(row, steps, Date.now()));
    update();
  }

  const status = vscode.window.createStatusBarItem("questlog.status", vscode.StatusBarAlignment.Left, 50);
  status.name = "Questlog";

  let details: vscode.WebviewPanel | undefined;
  let detailsId = "";
  const drawDetails = () => {
    const row = tree.rows.find((x) => x.id === detailsId);
    if (details && row) details.webview.html = detailsHtml(row, Date.now());
  };

  const log = vscode.window.createOutputChannel("Questlog");
  let lastOutcome = "";
  let polling = false;
  /** Takes the answer. Off the refresh path, a change redraws. */
  const adopt = (next: Map<string, LiveState> | undefined, redraw = true) => {
    const same = (!next && !tree.live) || (next && tree.live && next.size === tree.live.size && [...next].every(([k, v]) => { const o = tree.live!.get(k); return o?.status === v.status && o.waitingFor === v.waitingFor; }));
    tree.live = next;
    if (!same && redraw) update();
  };
  const readLiveCache = async (maxAgeMs: number) => {
    const text = await readText(liveCachePath());
    return text === undefined ? undefined : decodeCache(text, Date.now(), maxAgeMs);
  };
  // The command costs about half a CPU-second, so the windows share one answer per interval, and only a window showing the Questlog panel asks
  const pollLive = async (redraw = true) => {
    const cfg = vscode.workspace.getConfiguration("questlog");
    if (!cfg.get<boolean>("useAgentView", true)) {
      tree.live = undefined;
      return;
    }
    const gap = Math.max(MIN_LIVE_S, cfg.get<number>("agentViewSeconds", 10)) * 1000;
    const fresh = await readLiveCache(gap);
    if (fresh) return adopt(fresh.live, redraw);
    if (!tree.view?.visible) {
      // Nothing here to draw it on. Another window may be refreshing it; until it does, a short-lived answer beats none, and an old one is dropped
      return adopt((await readLiveCache(STALE_LIVE_TICKS * gap))?.live, redraw);
    }
    if (polling) return;
    polling = true;
    // Mark the cache fresh at once, carrying the old answer, so a second window with the panel open does not ask too
    await writeLiveCache((await readLiveCache(STALE_LIVE_TICKS * gap))?.live);
    // Fixed arguments, no user input; the shell is there because npm installs claude as claude.cmd on Windows
    const t0 = Date.now();
    execFile("claude", ["agents", "--json"], { timeout: 8000, windowsHide: true, shell: true, maxBuffer: 1 << 20 }, (err, out) => {
      polling = false;
      const next = err ? undefined : parseAgents(out);
      // One line per change of outcome, so a silent fall-back to the files is findable
      const outcome = err ? `failed: ${err.message.split("\n")[0]}` : next ? `ok, ${next.size} running` : "unreadable output";
      if (outcome !== lastOutcome) {
        log.appendLine(`${new Date().toISOString()} claude agents --json ${outcome} (${Date.now() - t0} ms)`);
        lastOutcome = outcome;
      }
      void writeLiveCache(next);
      adopt(next);
    });
  };

  // The shown session's pane flag, read async after each draw; a toggle here sets it at once
  const paneOpen = new Map<string, boolean>();
  const readPane = async (id: string) => {
    const open = paneOpenOf((await readText(paneFlag(id))) ?? "");
    if (paneOpen.get(id) === open) return;
    paneOpen.set(id, open);
    draw();
  };

  /** Everything the host reads from disk, async; then one draw from memory. */
  const refreshOnce = async () => {
    await pollLive(false);
    const resumeCommand = vscode.workspace.getConfiguration("questlog").get<string>("resumeCommand")?.trim() || DEFAULT_RESUME;
    const snap = await refresher.refresh({ now: Date.now(), live: tree.live, registryPath: registryPath(), resumeCommand });
    tree.rows = snap.rows;
    tree.note = snap.note;
    tree.dismissed = snap.dismissed;
    tree.plans = snap.plans;
    draw();
  };

  // One refresh at a time; a call while one runs asks for one more after it, so no change is dropped
  let running: Promise<void> | undefined;
  let again = false;
  const update = () => {
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await refreshOnce();
        } catch (e) {
          log.appendLine(`${new Date().toISOString()} refresh failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      } while (again);
    })().finally(() => (running = undefined));
  };

  /** The panel, details page, badge and status bar, from what is in memory. Sync, and reads no file. */
  const draw = () => {
    drawDetails();
    tree.folders = folders();
    tree.openTags = new Set(vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => sessionTagOf(t.label))).filter((t): t is string => !!t));
    const now = Date.now();
    // A Claude tab's label is the title the mod set, which its row records. Questlog's own details page carries the plan
    // as its title too, so it is never read as the session's tab (it would mark the session "here" and silence Needs you).
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    const isDetails = active?.input instanceof vscode.TabInputWebview && active.input.viewType.includes(DETAILS_VIEW_TYPE);
    const label = isDetails ? "" : active?.label ?? "";
    const tab = rowForTab(tree.rows, label, now);
    // A Claude tab with no row yet (no plan or message) is a session of its own: it must not inherit the last tab's focus
    const planless = !tab && isSessionTab(label);
    if (tab) tree.focusedId = tab.id;
    else if (planless) tree.focusedId = undefined;
    const focused = visibleRows(tree.rows, now, tree.dismissed).find((r) => r.id === tree.focusedId);
    const shown = focused ?? (planless ? undefined : rowForWorkspace(tree.rows, folders(), now));
    tree.fire();
    const live = visibleRows(tree.rows, now, tree.dismissed).filter((r) => !isStale(r, now) && !r.ended && !r.closed);
    if (tree.view) tree.view.badge = live.length > 0 ? { value: live.length, tooltip: `${live.length} live session${live.length === 1 ? "" : "s"}` } : undefined;
    if (shown) {
      status.text = `$(questlog-logo) ${statusText(shown)}`;
      status.tooltip = tooltip(shown, now, focused ? "this tab" : "this window", paneOpen.get(shown.id) ?? false);
      status.command = { title: "Show or hide the questlog panel", command: PANE_COMMAND, arguments: [shown.id] };
      status.show();
      void readPane(shown.id);
    } else {
      status.hide();
    }
  };

  // fs.watch fires several events per write; one refresh per burst
  let timer: NodeJS.Timeout | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  };
  let watcher: FSWatcher | undefined;
  const startWatch = () => {
    if (watcher) return;
    try {
      // A watcher that names the file rereads only that file; one that cannot, or a new one that missed changes, rescans the folder
      watcher = watch(rowsDir(), (_event, name) => {
        refresher.changed(name);
        soon();
      });
      refresher.changed();
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
        refresher.changed();
      });
    } catch {
      // folder not made yet: the tick retries
    }
  };
  startWatch();
  tree.onVisible = update;
  let ticks = 0;
  const tick = setInterval(() => {
    startWatch();
    // fs.watch can drop events (a burst overflows its buffer, a network or WSL folder): a rescan now and then heals what it missed.
    // Files whose size and mtime have not moved are not read again, so this costs a readdir and a stat per file, async
    if (++ticks % RESCAN_TICKS === 0) refresher.changed();
    update();
  }, TICK_MS);
  // Cheap when the shared answer is still fresh; the interval setting decides how often it really asks
  const liveTick = setInterval(() => void pollLive(), MIN_LIVE_S * 1000);

  context.subscriptions.push(
    log,
    viewReg,
    status,
    vscode.commands.registerCommand("questlog.refresh", update),
    vscode.commands.registerCommand(SHOW_DETAILS_COMMAND, (arg?: unknown) => {
      const id = sessionIdFromArg(arg);
      const row = tree.rows.find((x) => x.id === id);
      if (!row) return;
      detailsId = row.id;
      if (!details) {
        details = vscode.window.createWebviewPanel(DETAILS_VIEW_TYPE, "Session", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {});
        details.onDidDispose(() => {
          details = undefined;
        });
        context.subscriptions.push(details);
      }
      details.title = planOf(row);
      details.reveal(vscode.ViewColumn.Beside, true);
      drawDetails();
    }),
    vscode.commands.registerCommand(COPY_ID_COMMAND, async (arg?: unknown) => {
      const id = sessionIdFromArg(arg);
      if (!id) return;
      await vscode.env.clipboard.writeText(id);
      vscode.window.setStatusBarMessage(`Copied session ID ${id}`, 3000);
    }),
    vscode.commands.registerCommand(PANE_COMMAND, (arg?: unknown) => {
      const id = sessionIdFromArg(arg);
      if (!id) return;
      const open = !isPaneOpen(id);
      setPaneOpen(id, open);
      paneOpen.set(id, open);
      vscode.window.setStatusBarMessage(open ? "Questlog panel on for this session" : "Questlog panel off for this session", 3000);
      update();
    }),
    vscode.commands.registerCommand(COPY_RESUME_COMMAND, async (arg?: unknown) => {
      const text = resumeFromArg(arg);
      if (!text) return;
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(`Copied: ${text}`, 4000);
    }),
    vscode.commands.registerCommand(OPEN_WORKTREE_COMMAND, async (arg?: unknown) => {
      const path = worktreeFromArg(arg);
      if (path) await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), { forceNewWindow: true });
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("questlog")) update();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(update),
    // Fires on focus moves and on label changes, so a retitled tab is picked up too
    vscode.window.tabGroups.onDidChangeTabs(update),
    vscode.window.tabGroups.onDidChangeTabGroups(update),
    { dispose: () => { clearInterval(tick); clearInterval(liveTick); clearTimeout(timer); watcher?.close(); } },
  );
  update();
}

export function deactivate() {}

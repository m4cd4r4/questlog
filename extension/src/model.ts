// Pure view model for the webview: no vscode import, so node --test runs it directly.
import { accountedSteps, ago, canResume, doneOf, endedRows, groupByRepo, hasWorkLeft, isFinished, isLink, isStale, norm, planOf, stepsOf, visibleRows, type Dismissed, type Row, type Step } from "./rows.ts";
import { plansForRepo, planOnlyRepos, sliceLabel, type ParentPlan, type SliceState } from "./plans.ts";

import type { LiveState } from "./live.ts";
import { byName, sameName } from "./worktrees/listing.ts";
import { repoNameOf } from "./worktrees/names.ts";
import type { ScanFile } from "./worktrees/scan.ts";
import { sliceViews } from "./worktrees/slices.ts";
import { worktreeBlocks, worktreeNote, type WorktreeBlock, type WorktreeRow } from "./worktrees/view.ts";
import { monthOf, monthSummary, statsLines, type Ending, type StatEntry, type StatStep } from "../../mod/hooks/stats.ts";

export type CardState = "here" | "run" | "wait" | "idle" | "done" | "held" | "closed";

/**
 * `not needed`: a close said this open step was not required, and `detail` carries its reason. `needs`: a plan
 * slice whose worktree the scan reads Needs you, the amber dot the Worktrees block gives the same folder.
 */
export type CardStep = { status: Step["status"] | "blocked" | "not needed" | "needs"; text: string; detail?: string; resume?: string; worktree?: string; link?: string };

export type Card = {
  id: string;
  kind: "session" | "plan";
  title: string;
  state: CardState;
  /** Right-aligned age ("5m", "idle 3h"); empty for plans. */
  age: string;
  done: number;
  total: number;
  held: number;
  where: string;
  /** The step in progress, shown on a collapsed card; empty when none. */
  now: string;
  steps: CardStep[];
  /** Expanded on first draw: the session in the focused tab. */
  open: boolean;
  /** A paused session the host can build a resume command for; the command itself never travels to the page. */
  canResume: boolean;
  /** Another session closed this card: who, and the evidence it gave. */
  closedBy?: { tag: string; plan: string; evidence: string };
};

/**
 * `ended`: tabs closed with steps left, drawn behind one collapsed line and left out of the summary.
 * `worktrees`: the scanned repos of this name, one block each, drawn after the cards and before the ended line;
 * left out when the scan holds none.
 */
export type GroupModel = { repo: string; cards: Card[]; ended: Card[]; worktrees?: BlockModel[] };

/** The rows of a block the page shows before any click: the first ten that are not Closable. */
export const WT_ROWS_SHOWN = 10;
/**
 * A Worktrees block as it travels with every model. With 320 worktrees every row measured 121 KB on each
 * refresh, so only the rows shown before a click are sent: the first `WT_ROWS_SHOWN` that are not Closable.
 * `more` counts the other rows that are not Closable, `closable` the Closable ones; the page asks for a
 * block's rows (worktreeRows) when the person opens either.
 */
export type BlockModel = Omit<WorktreeBlock, "rows"> & { rows: WorktreeRow[]; more: number; closable: number };

const sentBlock = (b: WorktreeBlock): BlockModel => {
  const rest = b.rows.filter((r) => r.verdict !== "closable");
  return { ...b, rows: rest.slice(0, WT_ROWS_SHOWN), more: Math.max(0, rest.length - WT_ROWS_SHOWN), closable: b.rows.length - rest.length };
};

/**
 * Every row of one block, by its main checkout's path (either slash, any letter case), for the page's
 * worktreeRows request. Nothing for a path no block of the scan has, so the page cannot name another folder.
 */
export const worktreeRowsOf = (scan: ScanFile | undefined, plans: readonly ParentPlan[], now: number, repoPath: string): WorktreeRow[] | undefined => {
  if (typeof repoPath !== "string" || repoPath === "") return undefined;
  const key = norm(repoPath);
  return worktreeBlocks(scan, plans, now).find((b) => norm(b.repoPath) === key)?.rows;
};

export type Summary = { sessions: number; here: number; running: number; waiting: number; held: number; idle: number };

export type MonthStep = { status: StatStep["status"]; text: string; detail?: string; link?: string };
/**
 * A plan that ended finished or closed this month. Its steps do not travel with the model: a 715-session month
 * with them measured 760 KB on every refresh, so the page asks for one plan's steps when it is opened
 * (monthPlanSteps). `hasSteps` is false for a ledger line from before steps were kept.
 */
export type MonthPlan = { id: string; title: string; meta: string; hasSteps: boolean };
export type MonthRepo = { repo: string; line: string; plans: MonthPlan[] };
/** "This month": the lines /questlog-stats prints (mod/hooks/stats.ts), and under each repo the plans it finished. */
export type MonthModel = { sessions: number; head: string; lines: string[]; repos: MonthRepo[] };
/** The most plans one repo lists: the page is redrawn on every refresh, and a month can hold hundreds. */
export const MONTH_PLANS_SHOWN = 30;

/**
 * `worktreeNote`: one line about the worktree scan (first scan running, or a scan over a day old), else empty.
 * `worktreeScanAt`: when the scan shown was written, 0 for none; the page asks again for rows it holds when it moves.
 */
export type ViewModel = { summary: Summary; groups: GroupModel[]; note: string[]; month: MonthModel; worktreeNote: string; worktreeScanAt: number };

const SLICE_STEP: Record<SliceState, CardStep["status"]> = { done: "done", working: "now", blocked: "blocked", due: "todo", held: "todo", ready: "todo" };

export type ModelInput = {
  rows: readonly Row[];
  plans: readonly ParentPlan[];
  note: readonly string[];
  now: number;
  focusedId?: string;
  dismissed?: Dismissed;
  /** The 6 character session tags of the Claude tabs open in this window. */
  openTags?: ReadonlySet<string>;
  /** The folders this window has open. */
  folders?: readonly string[];
  /** From `claude agents --json`; undefined when it could not be read, and the file-based view stands alone. */
  live?: ReadonlyMap<string, LiveState>;
  /** This month's ledger lines (refresh.ts readLedger); none when there is no ledger yet. */
  ledger?: readonly StatEntry[];
  /** The worktree scan cache as last read; none means no worktree blocks and registry-only plan cards. */
  scan?: ScanFile;
  /** A worktree scan is running in this window. */
  scanning?: boolean;
};

const sessionCard = (r: Row, now: number, focusedId?: string, openTags: ReadonlySet<string> = new Set(), folders: readonly string[] = [], live?: ReadonlyMap<string, LiveState>): Card => {
  const lv = live?.get(r.id);
  // The list was read and holds no process for this session: its window is closed, however recent its last update
  const gone = r.ended || (live !== undefined && !lv);
  const stale = isStale(r, now) || gone;
  const here = r.id === focusedId && !stale;
  const waiting = lv?.status === "waiting" && !isFinished(r);
  const steps = stepsOf(r);
  const closed = r.closed;
  // A session still waiting on the person says so even when closed, and the card still names the close (so it can be
  // undone from here, and no second Close is offered); the close lapses if the session reports again.
  // A stale session with work left is unfinished (its window was probably closed); a stale finished one is just idle
  const state: CardState = closed && !waiting ? "closed" : stale ? (hasWorkLeft(r) ? "held" : "idle") : isFinished(r) ? "done" : here ? "here" : waiting ? "wait" : "run";
  const where = r.where || (r.branch && r.branch !== "main" && r.branch !== "master" ? r.branch : "");
  const cardSteps: CardStep[] = accountedSteps(r);
  return {
    id: r.id,
    kind: "session",
    title: planOf(r),
    state,
    age: closed && !waiting ? `closed ${ago(now - closed.at)}` : stale ? `${state === "held" ? (r.inTurn ? "interrupted" : "unfinished") : "idle"} ${ago(now - r.updatedAt)}` : ago(now - r.updatedAt),
    done: doneOf(r),
    total: r.total,
    held: 0,
    where,
    now: stale || (closed && !waiting) ? "" : waiting ? `Needs you: ${lv?.waitingFor ?? "waiting"}` : steps.find((s) => s.status === "now")?.text ?? r.now,
    steps: cardSteps,
    open: here && steps.length > 0,
    canResume: canResume(r, now, openTags, folders, gone),
    ...(closed ? { closedBy: { tag: closed.by.replace(/-/g, "").slice(0, 6).toLowerCase(), plan: closed.byPlan, evidence: closed.evidence } } : {}),
  };
};

/**
 * A plan's card. Each slice with a worktree in the scan takes its live facts (worktrees/slices.ts): one whose
 * pull request merged reads done and stays listed while its folder is there, and one the registry calls done
 * whose worktree still has work in it is listed again. With no scan the card is the registry's alone.
 */
const planCard = (p: ParentPlan, scan?: ScanFile): Card => {
  const views = sliceViews(p, scan);
  // A slice in progress, by live facts: the registry's working ones that have not merged, and the ones listed again
  const working = views.filter((v) => v.relisted || (v.slice.state === "working" && !v.done)).length;
  return {
    id: `plan:${p.repo}:${p.name}`,
    kind: "plan",
    title: p.name,
    state: working > 0 ? "run" : "held",
    age: "",
    done: views.filter((v) => v.done).length,
    total: p.slices.length,
    held: p.slices.filter((s) => s.state === "held").length,
    where: "",
    now: "",
    steps: views.filter((v) => v.listed).map(({ slice: s, done, relisted, why, verdict }): CardStep => ({
      status: done ? "done" : verdict === "needs-you" && (relisted || s.state === "working") ? "needs" : relisted ? "now" : SLICE_STEP[s.state],
      text: sliceLabel(s),
      detail: why,
      // Listed again: the registry offers no resume for a done slice, so only Open worktree, which the host honours
      // from the scan. A merged slice has nothing to resume either.
      resume: relisted || done ? undefined : s.worktree || s.resume || undefined,
      worktree: s.worktree || undefined,
    })),
    open: false,
    canResume: false,
  };
};

/** A row on disk as the ledger line it will leave (retention.ts ledgerLine); `closed` is joined only when the close holds. */
const ending = (r: Row): Ending => (r.closed ? "closed" : r.total === 0 ? "no steps" : r.done >= r.total ? "finished" : "unfinished");
const stepOf = (s: { status: StatStep["status"]; text: string; detail?: string; link?: string }): MonthStep =>
  ({ status: s.status, text: s.text, ...(s.detail ? { detail: s.detail } : {}), ...(s.link ? { link: s.link } : {}) });
const entryOf = (r: Row): StatEntry => {
  const steps = accountedSteps(r).map(stepOf);
  return { id: r.id, plan: r.plan, done: r.done, total: r.total, repo: r.repo, firstAt: r.startedAt ?? null, lastAt: r.updatedAt, ended: ending(r), ...(steps.length > 0 ? { steps } : {}), ...(r.continuedIn ? { continuedIn: r.continuedIn } : {}) };
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`; };

export const monthModel = (rows: readonly Row[], ledger: readonly StatEntry[], now: number): MonthModel => {
  const s = monthSummary([...ledger, ...rows.map(entryOf)], monthOf(now));
  const { head, lines, repos } = statsLines(s);
  return {
    sessions: s.sessions, head, lines,
    repos: s.repos.map((r, i) => ({
      repo: r.repo, line: repos[i] ?? r.repo,
      plans: r.plans.slice(0, MONTH_PLANS_SHOWN).map((p) => ({ id: p.id, title: p.plan || "Untitled", meta: `${p.done} of ${p.total} · ${dayOf(p.lastAt)}${p.ended === "closed" ? " · closed" : ""}`, hasSteps: p.steps.length > 0 })),
    })),
  };
};

/** The steps of one plan listed under "This month", by its session id: from the row while it is on disk, else from its newest ledger line. */
export const monthPlanSteps = (rows: readonly Row[], ledger: readonly StatEntry[], id: string): MonthStep[] => {
  const row = rows.find((r) => r.id === id);
  if (row) return accountedSteps(row).map(stepOf);
  const lines = ledger.filter((e) => e.id === id).sort((a, b) => b.lastAt - a.lastAt);
  return (lines[0]?.steps ?? []).map(stepOf);
};

export const buildModel = ({ rows, plans, note, now, focusedId, dismissed, openTags, folders, live, ledger = [], scan, scanning }: ModelInput): ViewModel => {
  const visible = visibleRows(rows, now, dismissed);
  const sessionGroups = groupByRepo(visible);
  const endedGroups = groupByRepo(endedRows(rows, now, dismissed));
  const named = [...sessionGroups.map((g) => g.repo), ...endedGroups.map((g) => g.repo).filter((r) => !sessionGroups.some((g) => g.repo === r))];
  const withPlans = [...named, ...planOnlyRepos(plans, named)];
  // A scanned repo joins the group of its name; one with linked worktrees and no group gets its own, after the others, in name order
  const blocks = worktreeBlocks(scan, plans, now);
  const extra: string[] = [];
  for (const b of blocks) {
    const name = repoNameOf(b.repoPath);
    if (b.rows.length > 0 && name && ![...withPlans, ...extra].some((r) => sameName(r, name))) extra.push(name);
  }
  extra.sort(byName);
  const repos = [...withPlans, ...extra];
  const card = (r: Row) => sessionCard(r, now, focusedId, openTags, folders, live);
  const groups: GroupModel[] = repos.map((repo, i) => {
    const rs = sessionGroups.find((g) => g.repo === repo)?.rows ?? [];
    // Two groups whose names differ only in letter case: the first one takes the blocks
    const first = repos.findIndex((r) => sameName(r, repo)) === i;
    const mine = first ? blocks.filter((b) => sameName(repoNameOf(b.repoPath), repo)) : [];
    return {
      repo,
      cards: [...plansForRepo(plans, repo).map((p) => planCard(p, scan)), ...rs.map(card)],
      ended: (endedGroups.find((g) => g.repo === repo)?.rows ?? []).map(card),
      ...(mine.length > 0 ? { worktrees: mine.map(sentBlock) } : {}),
    };
  });
  const cards = groups.flatMap((g) => g.cards);
  // A closed card whose tab is gone is listed for its outcome, not counted as a session; one whose tab is still open counts as idle
  const goneIds = new Set(rows.filter((r) => r.ended || (live !== undefined && !live.get(r.id))).map((r) => r.id));
  const sessionCards = cards.filter((c) => c.kind === "session" && !(c.state === "closed" && goneIds.has(c.id)));
  const count = (s: CardState) => sessionCards.filter((c) => c.state === s).length;
  return {
    summary: { sessions: sessionCards.length, here: count("here"), running: count("run"), waiting: count("wait"), held: count("held"), idle: count("idle") + count("closed") },
    groups,
    note: [...note],
    month: monthModel(rows, ledger, now),
    worktreeNote: worktreeNote(scan, scanning === true, now),
    worktreeScanAt: scan?.scannedAt ?? 0,
  };
};

/** The webview messages the host honours; anything else is dropped. */
export type WebMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "details"; id: string }
  | { type: "copyId"; id: string }
  | { type: "copySessionResume"; id: string }
  | { type: "dismiss"; id: string }
  | { type: "pane"; id: string }
  | { type: "undoClose"; id: string }
  | { type: "close"; id: string }
  | { type: "copyResume"; text: string }
  | { type: "openWorktree"; path: string }
  | { type: "copyPath"; path: string }
  | { type: "closeWorktree"; path: string }
  | { type: "closeAllSafe"; repoPath: string }
  | { type: "worktreeRows"; repoPath: string }
  | { type: "openNote" }
  | { type: "openLink"; url: string }
  | { type: "monthSteps"; id: string };

export const parseMessage = (v: unknown): WebMessage | undefined => {
  const m = v as { type?: unknown; id?: unknown; text?: unknown } | null;
  if (!m || typeof m.type !== "string") return undefined;
  const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  switch (m.type) {
    case "ready":
    case "refresh":
    case "openNote":
      return { type: m.type };
    case "details":
    case "copyId":
    case "copySessionResume":
    case "dismiss":
    case "undoClose":
    case "close":
    case "pane": {
      const id = str(m.id);
      return id ? { type: m.type, id } : undefined;
    }
    case "monthSteps": {
      const id = (v as { id?: unknown }).id;
      return typeof id === "string" && id.length > 0 && id.length <= 64 ? { type: "monthSteps", id } : undefined;
    }
    case "openLink": {
      // Only an http or https address: this is what the host hands to the browser
      const url = (v as { url?: unknown }).url;
      return isLink(url) ? { type: "openLink", url } : undefined;
    }
    case "copyResume": {
      const text = str(m.text);
      return text ? { type: "copyResume", text } : undefined;
    }
    case "openWorktree":
    case "copyPath":
    case "closeWorktree": {
      // The shape only: whether the path is one the last scan offered a removal for is the host's check (worktrees/view.ts)
      const path = str((m as { path?: unknown }).path);
      return path ? { type: m.type, path } : undefined;
    }
    case "closeAllSafe": {
      // The page names a repo and never a list: the host builds the list from the last scan
      const repoPath = str((m as { repoPath?: unknown }).repoPath);
      return repoPath ? { type: "closeAllSafe", repoPath } : undefined;
    }
    case "worktreeRows": {
      const repoPath = (v as { repoPath?: unknown }).repoPath;
      return typeof repoPath === "string" && repoPath.length > 0 && repoPath.length <= 1024 ? { type: "worktreeRows", repoPath } : undefined;
    }
    default:
      return undefined;
  }
};

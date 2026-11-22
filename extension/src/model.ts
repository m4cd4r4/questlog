// Pure view model for the webview: no vscode import, so node --test runs it directly.
import { accountedSteps, ago, canResume, doneOf, endedRows, groupByRepo, hasWorkLeft, isFinished, isLink, isStale, planOf, stepsOf, visibleRows, type Dismissed, type Row, type Step } from "./rows.ts";
import { openSlices, plansForRepo, planOnlyRepos, sliceLabel, type ParentPlan, type SliceState } from "./plans.ts";

import type { LiveState } from "./live.ts";
import { monthOf, monthSummary, statsLines, type Ending, type StatEntry, type StatStep } from "../../mod/hooks/stats.ts";

export type CardState = "here" | "run" | "wait" | "idle" | "done" | "held" | "closed";

/** `not needed`: a close said this open step was not required, and `detail` carries its reason. */
export type CardStep = { status: Step["status"] | "blocked" | "not needed"; text: string; detail?: string; resume?: string; worktree?: string; link?: string };

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

/** `ended`: tabs closed with steps left, drawn behind one collapsed line and left out of the summary. */
export type GroupModel = { repo: string; cards: Card[]; ended: Card[] };

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

export type ViewModel = { summary: Summary; groups: GroupModel[]; note: string[]; month: MonthModel };

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

const planCard = (p: ParentPlan): Card => {
  const slices = openSlices(p);
  const count = (s: SliceState) => p.slices.filter((x) => x.state === s).length;
  const working = count("working");
  return {
    id: `plan:${p.repo}:${p.name}`,
    kind: "plan",
    title: p.name,
    state: working > 0 ? "run" : "held",
    age: "",
    done: count("done"),
    total: p.slices.length,
    held: count("held"),
    where: "",
    now: "",
    steps: slices.map((s) => ({ status: SLICE_STEP[s.state], text: sliceLabel(s), detail: s.why, resume: s.worktree || s.resume || undefined, worktree: s.worktree || undefined })),
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

export const buildModel = ({ rows, plans, note, now, focusedId, dismissed, openTags, folders, live, ledger = [] }: ModelInput): ViewModel => {
  const visible = visibleRows(rows, now, dismissed);
  const sessionGroups = groupByRepo(visible);
  const endedGroups = groupByRepo(endedRows(rows, now, dismissed));
  const named = [...sessionGroups.map((g) => g.repo), ...endedGroups.map((g) => g.repo).filter((r) => !sessionGroups.some((g) => g.repo === r))];
  const repos = [...named, ...planOnlyRepos(plans, named)];
  const card = (r: Row) => sessionCard(r, now, focusedId, openTags, folders, live);
  const groups: GroupModel[] = repos.map((repo) => {
    const rs = sessionGroups.find((g) => g.repo === repo)?.rows ?? [];
    return { repo, cards: [...plansForRepo(plans, repo).map(planCard), ...rs.map(card)], ended: (endedGroups.find((g) => g.repo === repo)?.rows ?? []).map(card) };
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
    case "openWorktree": {
      const path = str((m as { path?: unknown }).path);
      return path ? { type: "openWorktree", path } : undefined;
    }
    default:
      return undefined;
  }
};

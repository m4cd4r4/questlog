// Pure view model for the webview: no vscode import, so node --test runs it directly.
import { ago, canResume, endedRows, groupByRepo, hasWorkLeft, isFinished, isStale, planOf, stepsOf, visibleRows, type Dismissed, type Row, type Step } from "./rows.ts";
import { openSlices, plansForRepo, planOnlyRepos, sliceLabel, type ParentPlan, type SliceState } from "./plans.ts";

import type { LiveState } from "./live.ts";

export type CardState = "here" | "run" | "wait" | "idle" | "done" | "held" | "closed";

export type CardStep = { status: Step["status"] | "blocked"; text: string; detail?: string; resume?: string; worktree?: string };

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

export type ViewModel = { summary: Summary; groups: GroupModel[]; note: string[] };

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
};

const sessionCard = (r: Row, now: number, focusedId?: string, openTags: ReadonlySet<string> = new Set(), folders: readonly string[] = [], live?: ReadonlyMap<string, LiveState>): Card => {
  const lv = live?.get(r.id);
  // The list was read and holds no process for this session: its window is closed, however recent its last update
  const gone = r.ended || (live !== undefined && !lv);
  const stale = isStale(r, now) || gone;
  const here = r.id === focusedId && !stale;
  const waiting = lv?.status === "waiting" && !isFinished(r);
  const steps = stepsOf(r);
  // A session still waiting on the person says so even when closed; the close lapses if it updates again
  const closed = r.closed && !waiting ? r.closed : undefined;
  // A stale session with work left is unfinished (its window was probably closed); a stale finished one is just idle
  const state: CardState = closed ? "closed" : stale ? (hasWorkLeft(r) ? "held" : "idle") : isFinished(r) ? "done" : here ? "here" : waiting ? "wait" : "run";
  const where = r.where || (r.branch && r.branch !== "main" && r.branch !== "master" ? r.branch : "");
  return {
    id: r.id,
    kind: "session",
    title: planOf(r),
    state,
    age: closed ? `closed ${ago(now - closed.at)}` : stale ? `${state === "held" ? (r.inTurn ? "interrupted" : "unfinished") : "idle"} ${ago(now - r.updatedAt)}` : ago(now - r.updatedAt),
    done: r.done,
    total: r.total,
    held: 0,
    where,
    now: stale || closed ? "" : waiting ? `Needs you: ${lv?.waitingFor ?? "waiting"}` : steps.find((s) => s.status === "now")?.text ?? r.now,
    steps: steps.map((s) => ({ status: s.status, text: s.text, detail: s.detail })),
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

export const buildModel = ({ rows, plans, note, now, focusedId, dismissed, openTags, folders, live }: ModelInput): ViewModel => {
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
  const sessionCards = cards.filter((c) => c.kind === "session");
  const count = (s: CardState) => sessionCards.filter((c) => c.state === s).length;
  return {
    summary: { sessions: sessionCards.length, here: count("here"), running: count("run"), waiting: count("wait"), held: count("held"), idle: count("idle") + count("closed") },
    groups,
    note: [...note],
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
  | { type: "copyResume"; text: string }
  | { type: "openWorktree"; path: string }
  | { type: "openNote" };

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
    case "pane": {
      const id = str(m.id);
      return id ? { type: m.type, id } : undefined;
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

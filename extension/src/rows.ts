// Pure logic for the sidebar: no vscode import, so node --test runs it directly.

export type StepStatus = "done" | "now" | "todo";
/** A path that proves the step done: when it exists, or when it is gone. Absolute, or relative to the session's folder. */
export type StepCheck = { exists: string } | { gone: string };
export type Step = { text: string; status: StepStatus; detail?: string; check?: StepCheck };

/** One file per session in ~/.claude/questlog/, written by the mod (lib.ts rowOf). */
export type Row = {
  id: string;
  repo: string;
  where: string;
  plan: string;
  done: number;
  total: number;
  now: string;
  updatedAt: number;
  /** When the session last spoke for itself. Reopening a tab moves updatedAt, not this; rows from before it lack it. */
  reportedAt?: number;
  ended?: boolean;
  steps?: Step[];
  branch?: string;
  cwd?: string;
  /** The tab title the mod last set; the active tab's label is matched to it. */
  title?: string;
  /** Another session closed this card. Joined from `<id>.close` by withCloses; never stored in the row. */
  closed?: Close;
  /** The session stopped partway through a turn. */
  inTurn?: boolean;
  /** /clear moved this session's process to another session ID. */
  continuedIn?: string;
};

import { CLOSE_EXT, closeHolds, evidenceOf, stepKey, type Close, type CloseStep } from "../../mod/hooks/close.ts";
export { CLOSE_EXT, type Close, type CloseStep };

/** `by` for a close made from this panel, and for one a step check made: no session has an ID like either. */
export const CLOSED_BY_HAND = "you";
export const CLOSED_BY_CHECK = "check";

const isCloseStep = (v: unknown): v is CloseStep => {
  const s = v as CloseStep;
  return !!s && typeof s.text === "string" && (s.outcome === "finished" || s.outcome === "not needed") && typeof s.why === "string";
};

export const closeFrom = (text: string): Close | undefined => {
  try {
    const c = JSON.parse(text) as Close;
    if (!(typeof c?.by === "string" && typeof c.byPlan === "string" && typeof c.evidence === "string" && typeof c.at === "number" && typeof c.rowReportedAt === "number")) return undefined;
    if (c.steps !== undefined && !(Array.isArray(c.steps) && c.steps.every(isCloseStep))) return undefined;
    return c;
  } catch {
    return undefined;
  }
};

/** A close holds until the session reports again, when it comes back like a hidden one. Reopening its tab is not a report. */
export const withCloses = (rows: readonly Row[], closes: ReadonlyMap<string, Close>): Row[] =>
  rows.map((r) => {
    const c = closes.get(r.id);
    return closeHolds(c, r) ? { ...r, closed: c } : r;
  });


/**
 * Closes a card whose every open step names a path that checks out: the close says each path and its state.
 * Nothing when a step has no check, one fails or cannot be resolved, or a close for this report was already made or undone.
 */
export const checkClose = (r: Row, nowMs: number, exists: (path: string) => boolean | undefined, prior?: Close): Close | undefined => {
  const rowReportedAt = r.reportedAt ?? r.updatedAt;
  // A row /clear carried on is accounted for by its continuation; a row past PARKED_MS is never shown, so never checked
  if (!hasWorkLeft(r) || r.continuedIn || nowMs - r.updatedAt >= PARKED_MS || prior?.rowReportedAt === rowReportedAt) return undefined;
  const steps: CloseStep[] = [];
  for (const s of stepsOf(r).filter((x) => x.status !== "done")) {
    const c = s.check;
    const path = c && ("exists" in c ? c.exists : c.gone);
    if (!c || typeof path !== "string" || !path) return undefined;
    const want = "exists" in c;
    if (exists(path) !== want) return undefined;
    steps.push({ text: s.text, outcome: "finished", why: `${path} ${want ? "exists" : "gone"}` });
  }
  return steps.length > 0 ? { by: CLOSED_BY_CHECK, byPlan: "", evidence: evidenceOf(steps), at: nowMs, rowReportedAt, steps } : undefined;
};

/** The close this panel writes: the person accounted for every open step, with a reason for each one not needed. */
export const closeByHand = (r: Row, steps: readonly CloseStep[], nowMs: number): Close => ({
  by: CLOSED_BY_HAND, byPlan: "", evidence: evidenceOf(steps), at: nowMs, rowReportedAt: r.reportedAt ?? r.updatedAt, steps: [...steps],
});

/**
 * Why a close made by hand must not be written: the row's session reported while the prompts were up, or another
 * session (or a check) closed it meanwhile. `latest` and `close` are read from disk after the prompts, not from the
 * rows the prompts began with. Undefined when the close may go ahead.
 */
export const handCloseBlocked = (row: Row, latest: Row | undefined, close: Close | undefined): string | undefined => {
  const at = row.reportedAt ?? row.updatedAt;
  if (!latest || (latest.reportedAt ?? latest.updatedAt) !== at) return "Nothing closed: the session reported again meanwhile. Check its card.";
  if (close && !close.undone && close.rowReportedAt === at) return `Nothing closed: ${close.by === CLOSED_BY_HAND ? "you" : close.by === CLOSED_BY_CHECK ? "a step check" : close.by.slice(0, 6)} closed it meanwhile. Check its card.`;
  return undefined;
};

export const STALE_MS = 6 * 60 * 60 * 1000;
/** A finished session older than this is dropped from the view. */
export const GONE_MS = 24 * 60 * 60 * 1000;
/** An unfinished session stays, shown as paused, for this long after its last update. */
export const PARKED_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A row is one the mod wrote for a session: its id is that session's UUID, which also keeps `<id>.close` inside the folder. */
export const isRow = (v: unknown): v is Row => {
  const r = v as Row;
  return !!r && typeof r.id === "string" && SESSION_ID.test(r.id) && typeof r.updatedAt === "number";
};

/**
 * A step check path the panel may look at: no line breaks, and never a UNC or URL path, which would make every
 * window reach for a network share on each tick. Relative paths resolve inside the session's folder.
 */
export const isCheckablePath = (p: string) => !/[\r\n]/.test(p) && !/^[\\/]{2}/.test(p) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(p);

export const isStale = (r: Row, nowMs: number) => nowMs - r.updatedAt >= STALE_MS;

export const isFinished = (r: Row) => r.total > 0 && r.done === r.total;

/** Has a step list with work left. A session with no steps yet is never paused: it drops at GONE_MS like a finished one. */
export const hasWorkLeft = (r: Row) => r.total > 0 && r.done < r.total && !r.closed;

/** Hidden by hand: session id to the updatedAt it was hidden at, so a session that updates again comes back. */
export type Dismissed = Record<string, number>;

export const dismissedFrom = (text: string): Dismissed => {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number"));
  } catch {
    return {};
  }
};

/**
 * Live, paused and recently finished rows, newest first. Dropped: ended, hidden by hand, finished ones a
 * day old, unfinished ones a week old, and sessions that never got a message or a plan (the mod's plan
 * falls back to the first message, so an empty plan with no steps is a window that was opened and left).
 * A card another session closed stays a day from the close, ended or not, so a wrong close can be seen.
 */
export const visibleRows = (rows: readonly Row[], nowMs: number, dismissed: Dismissed = {}) =>
  rows
    .filter(
      (r) =>
        (!r.ended || r.closed) &&
        dismissed[r.id] !== r.updatedAt &&
        nowMs - (r.closed?.at ?? r.updatedAt) < (hasWorkLeft(r) ? PARKED_MS : GONE_MS) &&
        (r.plan || r.total > 0),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

/** Tabs closed with steps left in the last day, newest first. A close or a /clear already says where the work went. */
export const endedRows = (rows: readonly Row[], nowMs: number, dismissed: Dismissed = {}) =>
  rows
    .filter((r) => r.ended && hasWorkLeft(r) && !r.continuedIn && dismissed[r.id] !== r.updatedAt && nowMs - r.updatedAt < GONE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt);

export type Group = { repo: string; rows: Row[] };

/** Groups by repo; a group's order is its newest row's, so the busiest repo is on top. */
export const groupByRepo = (rows: readonly Row[]): Group[] => {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.repo || "(no repo)";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([repo, rs]) => ({ repo, rows: [...rs].sort((a, b) => b.updatedAt - a.updatedAt) }))
    .sort((a, b) => b.rows[0].updatedAt - a.rows[0].updatedAt);
};

export const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

export const bar = (done: number, total: number, width = 8) => {
  if (total <= 0) return "";
  const full = Math.round((done / total) * width);
  return "■".repeat(full) + "□".repeat(width - full);
};

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export const planOf = (r: Row) => r.plan || "(no plan yet)";

/** The tree row's grey text: stage, branch or worktree, age. */
export const description = (r: Row, nowMs: number) => {
  const parts: string[] = [];
  if (r.total > 0) parts.push(`${doneOf(r)}/${r.total}`);
  const where = r.where || (r.branch && r.branch !== "main" && r.branch !== "master" ? r.branch : "");
  if (where) parts.push(where);
  parts.push(isStale(r, nowMs) ? `idle ${ago(nowMs - r.updatedAt)}` : ago(nowMs - r.updatedAt));
  return parts.join(" · ");
};

/** Steps, falling back to the one "now" line older rows carry. */
export const stepsOf = (r: Row): Step[] =>
  r.steps && r.steps.length > 0 ? r.steps : r.now ? [{ text: r.now, status: "now" }] : [];

/** `not needed`: a close said this open step was not required, and `detail` carries its reason. */
export type AccountedStep = { status: StepStatus | "not needed"; text: string; detail?: string; check?: StepCheck };

/**
 * The steps as the row's close accounted for them, the one view every surface draws (card, status bar, tooltip,
 * details page): an open step the close names reads finished or not needed; a close with no step list leaves them
 * as reported.
 */
export const accountedSteps = (r: Row): AccountedStep[] =>
  stepsOf(r).map((s) => {
    const c = s.status !== "done" ? r.closed?.steps?.find((x) => stepKey(x.text) === stepKey(s.text)) : undefined;
    if (!c) return { status: s.status, text: s.text, detail: s.detail, check: s.check };
    return c.outcome === "finished" ? { status: "done", text: s.text, detail: c.why || s.detail } : { status: "not needed", text: s.text, detail: c.why };
  });

/**
 * The done count every surface shows: a close that accounted for each open step (the only kind a writer makes)
 * counts whole; otherwise the session's own count (a row from before step lists carries one "now" line and
 * would read 0 if recounted).
 */
export const doneOf = (r: Row) => (r.closed?.steps?.length ? r.total : r.done);

/** The step in progress as a surface names it; none once the card is closed. */
export const nowOf = (r: Row) => (r.closed ? "" : stepsOf(r).find((s) => s.status === "now")?.text ?? r.now);

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const inside = (path: string, folder: string) => {
  const p = norm(path);
  const f = norm(folder);
  return p === f || p.startsWith(`${f}/`);
};

/**
 * The live row whose cwd sits in one of the window's folders, else one whose repo names a folder.
 * Only when exactly one row fits: with two or more sessions in a folder this is a guess, and a
 * guess lets a click toggle the wrong session's pane.
 */
export const rowForWorkspace = (rows: readonly Row[], folders: readonly string[], nowMs: number): Row | undefined => {
  const live = visibleRows(rows, nowMs).filter((r) => !isStale(r, nowMs) && !r.ended && !r.closed);
  const byCwd = live.filter((r) => r.cwd && folders.some((f) => inside(r.cwd!, f)));
  if (byCwd.length > 0) return byCwd.length === 1 ? byCwd[0] : undefined;
  const names = folders.map((f) => norm(f).split("/").pop());
  const byRepo = live.filter((r) => !r.cwd && r.repo && names.includes(r.repo.toLowerCase()));
  return byRepo.length === 1 ? byRepo[0] : undefined;
};

/**
 * The row whose recorded title is this tab's label; newest wins when two sessions share a title.
 * VS Code cuts a long tab label to ~24 characters plus "…", so a cut label matches the title it starts.
 */
export const rowForTab = (rows: readonly Row[], label: string, nowMs: number): Row | undefined => {
  const l = label.trim();
  const cutAt = l.endsWith("…") ? l.slice(0, -1).trimEnd() : undefined;
  if (!l || cutAt === "") return undefined;
  return visibleRows(rows, nowMs).find((r) => {
    const t = r.title?.trim();
    if (!t || r.ended) return false;
    return cutAt === undefined ? t === l : t === l || t.startsWith(cutAt);
  });
};

/** A tab the mod has titled: its label leads with the 6 character session tag, "[8e312b] ...". */
export const isSessionTab = (label: string) => /^\[[0-9a-f]{6}\]/i.test(label.trim());

export const isInWorkspace =(r: Row, folders: readonly string[]) =>
  !!r.cwd && folders.some((f) => inside(r.cwd!, f));

export const NOTE_FILE = "restart-note.md";

/** The note's items: one per non-blank line, list markers dropped. */
export const noteLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean);

/** Status bar text for this window's session. */
export const statusText = (r: Row) => {
  const stage = r.total > 0 ? `${doneOf(r)}/${r.total} ` : "";
  const now = nowOf(r) ? ` · ${cut(nowOf(r), 32)}` : "";
  return `${stage}${cut(planOf(r), 36)}${now}`;
};

/** A folder that stays inside double quotes in both bash and PowerShell. */
const QUOTE_SAFE = /^[^"`$\r\n]+$/;

/**
 * The line that reopens an unfinished session in its own folder (Claude finds a session by folder), typed in bash
 * or PowerShell. Undefined for a finished or planless session, and for a row whose folder or ID could not be
 * pasted into a shell safely.
 */
export const resumeCommandOf = (r: Row): string | undefined =>
  hasWorkLeft(r) && r.cwd && QUOTE_SAFE.test(r.cwd) && SESSION_ID.test(r.id)
    ? `cd "${r.cwd}"; claude --resume ${r.id}`
    : undefined;

/** The 6 character tag a Claude tab leads with ("[8e312b] ..."), lower-cased: the first 6 characters of its session ID. */
export const sessionTagOf = (label: string) => /^\[([0-9a-f]{6})\]/i.exec(label.trim())?.[1].toLowerCase();

/**
 * Whether a row offers the reopen button: unfinished, and either quiet for 6 hours (its window is probably gone),
 * or its process has ended (the same test that turns the card amber),
 * or in this window's folder with no Claude tab open here (closed early, however recent the last update).
 */
export const canResume = (r: Row, nowMs: number, openTags: ReadonlySet<string>, folders: readonly string[], closed = false) =>
  resumeCommandOf(r) !== undefined &&
  (isStale(r, nowMs) || closed || (inOpenFolder(r.cwd!, folders) && !openTags.has(r.id.slice(0, 6).toLowerCase())));

const flat = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The Claude extension lists a window's sessions by folder, so a row only reopens from the window that has its folder open. */
export const inOpenFolder = (cwd: string, openFolders: readonly string[]) => openFolders.some((f) => flat(f) === flat(cwd));

export const COPY_ID_COMMAND = "questlog.copySessionId";

/** A tooltip link that runs the copy command for one session. */
export const copyIdLink = (id: string) =>
  `command:${COPY_ID_COMMAND}?${encodeURIComponent(JSON.stringify([id]))}`;

export const PANE_COMMAND = "questlog.togglePane";

/** A tooltip link that turns one session's Questlog pane on or off. */
export const paneLink = (id: string) =>
  `command:${PANE_COMMAND}?${encodeURIComponent(JSON.stringify([id]))}`;

/** Whether a pane flag file (panes/<id>.json, read by the mod) asks for the pane; no file or a bad one is off. */
export const paneOpenOf = (text: string) => {
  try {
    return (JSON.parse(text) as { open?: unknown } | null)?.open === true;
  } catch {
    return false;
  }
};

/** The session ID from a command argument: the raw ID (tooltip link) or a tree item whose id is `session:<id>` (context menu). */
export const sessionIdFromArg = (arg: unknown): string | undefined => {
  if (typeof arg === "string") return arg || undefined;
  const id = (arg as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.startsWith("session:") && id.length > 8 ? id.slice(8) : undefined;
};

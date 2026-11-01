// Parent plans from the worktree registry: pure logic, no vscode import, so node --test runs it directly.
// The registry (~/.claude/workspaces/registry.json) is the store; the sidebar only renders it.

/** The registry fields this view reads; the file carries many more. */
export type RegistryEntry = {
  slug?: string;
  plan?: string;
  label?: string;
  wave?: number | string;
  status?: string;
  depends_on?: string[];
  gate_reason?: string | null;
  gate_date?: string | null;
  repo_path?: string;
  worktree_path?: string | null;
  last_activity_at?: string;
};

export type SliceState = "done" | "working" | "blocked" | "due" | "held" | "ready";

export type Slice = {
  slug: string;
  label: string;
  wave: string;
  state: SliceState;
  /** Why the slice is in this state, one line. */
  why: string;
  /** What to paste to pick the slice up: the mint command, or the worktree path. Empty when done. */
  resume: string;
  worktree: string;
};

export type ParentPlan = { name: string; repo: string; slices: Slice[] };

export const DEFAULT_RESUME = "git worktree add ../{slug} -b {slug}";
const DONE = new Set(["merged", "archived", "superseded"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const base = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
const waveNum = (w: Slice["wave"]) => (w === "" || Number.isNaN(Number(w)) ? Infinity : Number(w));

/**
 * Plans with two or more slices and at least one still open. A plan shows while one of its slices was
 * touched within `days` or has a worktree on disk, so a plan abandoned months ago drops off.
 * Held follows Finisher (where-are-we lib/threads/registry.mjs): a gate whose date is ahead or absent,
 * or a `depends_on` slug that is still open. A gate date that has passed makes the slice due.
 */
export type PlanOptions = { now?: number; exists?: (path: string) => boolean; days?: number; resumeCommand?: string };

export const plansFromRegistry = (
  entries: readonly RegistryEntry[],
  { now = Date.now(), exists = () => false, days = 14, resumeCommand = DEFAULT_RESUME }: PlanOptions = {},
): ParentPlan[] => {
  const byPlan = new Map<string, RegistryEntry[]>();
  const openSlugs = new Set<string>();
  for (const e of entries) {
    if (!e || !e.slug || !e.plan) continue;
    byPlan.set(e.plan, [...(byPlan.get(e.plan) ?? []), e]);
    if (!DONE.has(e.status ?? "")) openSlugs.add(e.slug);
  }
  const plans: ParentPlan[] = [];
  for (const [name, list] of byPlan) {
    if (list.length < 2 || !list.some((e) => openSlugs.has(e.slug!))) continue;
    const touched = list.some((e) => {
      const at = Date.parse(e.last_activity_at ?? "");
      return Number.isFinite(at) && now - at <= days * DAY_MS;
    });
    const onDisk = list.some((e) => !DONE.has(e.status ?? "") && !!e.worktree_path && exists(e.worktree_path));
    if (!touched && !onDisk) continue;
    const slices = list
      .map((e) => sliceOf(e, openSlugs, now, exists, resumeCommand))
      .map((s, i) => ({ s, i }))
      .sort((a, b) => waveNum(a.s.wave) - waveNum(b.s.wave) || a.i - b.i)
      .map(({ s }) => s);
    plans.push({ name, repo: base(list[0].repo_path ?? ""), slices });
  }
  return plans;
};

const sliceOf = (
  e: RegistryEntry, openSlugs: ReadonlySet<string>, now: number, exists: (p: string) => boolean, resumeCommand: string,
): Slice => {
  const slug = e.slug!;
  const worktree = e.worktree_path && exists(e.worktree_path) ? e.worktree_path : "";
  const common = { slug, label: e.label ?? "", wave: e.wave == null ? "" : String(e.wave), worktree };
  const status = e.status ?? "";
  if (DONE.has(status)) return { ...common, state: "done", why: status, resume: "" };
  if (status === "materialised" || status === "blocked") {
    return {
      ...common,
      state: status === "blocked" ? "blocked" : "working",
      why: worktree ? `${status === "blocked" ? "blocked" : "in progress"}, worktree on disk` : `${status}, worktree not on disk`,
      resume: worktree,
    };
  }
  const resume = resumeCommand.split("{slug}").join(slug);
  const gateMs = e.gate_date ? Date.parse(e.gate_date) : NaN;
  const gateDue = !!e.gate_reason && Number.isFinite(gateMs) && gateMs <= now;
  if (gateDue) return { ...common, state: "due", why: `gate date ${e.gate_date} reached: ${e.gate_reason}`, resume };
  if (e.gate_reason) {
    return { ...common, state: "held", why: `held: ${e.gate_reason}${e.gate_date ? ` (until ${e.gate_date})` : ""}`, resume };
  }
  const waitsOn = (e.depends_on ?? []).filter((d) => openSlugs.has(d));
  if (waitsOn.length > 0) return { ...common, state: "held", why: `waits on ${waitsOn.join(", ")}`, resume };
  return { ...common, state: "ready", why: "ready to mint", resume };
};

/** "1/8 · 1 working · 6 held": done over total, then each open state that has slices. */
export const planSummary = (p: ParentPlan) => {
  const count = (s: SliceState) => p.slices.filter((x) => x.state === s).length;
  const parts = [`${count("done")}/${p.slices.length}`];
  for (const s of ["working", "blocked", "due", "ready", "held"] as const) if (count(s) > 0) parts.push(`${count(s)} ${s}`);
  return parts.join(" · ");
};

/** The slices the tree lists: the open ones. Done slices only count toward the summary. */
export const openSlices = (p: ParentPlan) => p.slices.filter((s) => s.state !== "done");

/** The tree label: registry label first when set ("S3 seal-web"). */
export const sliceLabel = (s: Slice) => (s.label ? `${s.label} ${s.slug}` : s.slug);

/**
 * The grey text beside a slice: the reason only, since a sidebar cuts it at ~30 characters. The icon
 * already says held, and slices are listed in wave order; the tooltip carries the wave and the full text.
 */
export const sliceDescription = (s: Slice) => {
  const why = s.why.replace(/^held: /, "").replace(/, worktree on disk$/, "");
  return why.length <= 60 ? why : `${why.slice(0, 59).trimEnd()}…`;
};

/** Plans for a repo group, matched on the repo folder name the mod records. */
export const plansForRepo = (plans: readonly ParentPlan[], repo: string) =>
  plans.filter((p) => p.repo.toLowerCase() === repo.toLowerCase());

/** Repos with a plan but no session in view, so a plan stays reachable when nothing is running there. */
export const planOnlyRepos = (plans: readonly ParentPlan[], sessionRepos: readonly string[]) => {
  const seen = new Set(sessionRepos.map((r) => r.toLowerCase()));
  const out: string[] = [];
  for (const p of plans) {
    const key = p.repo.toLowerCase();
    if (!p.repo || seen.has(key)) continue;
    seen.add(key);
    out.push(p.repo);
  }
  return out;
};

export const COPY_RESUME_COMMAND = "questlog.copyResume";
export const OPEN_WORKTREE_COMMAND = "questlog.openWorktree";

/** The resume text from a command argument: the raw string (click) or a tree node carrying a slice (context menu). */
export const resumeFromArg = (arg: unknown): string | undefined => {
  if (typeof arg === "string") return arg || undefined;
  const r = (arg as { slice?: { resume?: unknown } } | null)?.slice?.resume;
  return typeof r === "string" && r ? r : undefined;
};

/** The worktree path from a context-menu tree node. */
/** True only when `value` is a worktree path or resume text the registry itself supplied, so the page cannot make the host open or copy anything else. */
export const isOfferedByPlans = (plans: readonly ParentPlan[], kind: "worktree" | "resume", value: string) =>
  value !== "" &&
  plans.some((p) => openSlices(p).some((s) => (kind === "worktree" ? s.worktree === value : s.worktree === value || s.resume === value)));

export const worktreeFromArg = (arg: unknown): string | undefined => {
  if (typeof arg === "string") return arg || undefined;
  const w = (arg as { slice?: { worktree?: unknown } } | null)?.slice?.worktree;
  return typeof w === "string" && w ? w : undefined;
};

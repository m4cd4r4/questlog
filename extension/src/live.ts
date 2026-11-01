// What `claude agents --json` says about running sessions. Pure, so node --test runs it directly.
// The command lists every live Claude Code process on this machine, VS Code sessions included.

export type LiveStatus = "busy" | "idle" | "waiting";

export type LiveState = { status: LiveStatus; /** Why it waits: "permission prompt", "input needed", ... */ waitingFor?: string };

const STATUSES: readonly string[] = ["busy", "idle", "waiting"];

/** What the windows share: one result per interval, written by whichever window asked last. `live` is absent when the command failed. */
export type LiveCache = { at: number; live?: Array<[string, LiveState]> };

export const encodeCache = (at: number, live: ReadonlyMap<string, LiveState> | undefined): string =>
  JSON.stringify({ at, ...(live ? { live: [...live] } : {}) } satisfies LiveCache);

/** A cache newer than `maxAgeMs`, else undefined. A failed read is a cache too: `live` is undefined inside it, so no window retries sooner than the interval. */
export const decodeCache = (text: string, now: number, maxAgeMs: number): { live: Map<string, LiveState> | undefined } | undefined => {
  let v: Partial<LiveCache> | null;
  try {
    v = JSON.parse(text) as Partial<LiveCache> | null;
  } catch {
    return undefined;
  }
  if (!v || typeof v.at !== "number" || now - v.at >= maxAgeMs || v.at > now + 5000) return undefined;
  if (!Array.isArray(v.live)) return { live: undefined };
  const live = new Map<string, LiveState>();
  for (const e of v.live) {
    const [id, s] = (Array.isArray(e) ? e : []) as [unknown, Partial<LiveState> | undefined];
    if (typeof id === "string" && s && STATUSES.includes(s.status as string)) live.set(id, { status: s.status as LiveStatus, waitingFor: typeof s.waitingFor === "string" ? s.waitingFor : undefined });
  }
  return { live };
};

/** Session id to live state. Undefined when the output is not a session list, so the caller keeps its file-based view. */
export const parseAgents = (text: string): Map<string, LiveState> | undefined => {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(v)) return undefined;
  const live = new Map<string, LiveState>();
  for (const s of v as Array<Record<string, unknown> | null>) {
    if (!s || typeof s.sessionId !== "string") continue;
    // `status` is only present while the process is alive; a finished background job has only `state`
    if (typeof s.status !== "string" || !STATUSES.includes(s.status)) continue;
    live.set(s.sessionId, { status: s.status as LiveStatus, waitingFor: typeof s.waitingFor === "string" ? s.waitingFor : undefined });
  }
  return live;
};

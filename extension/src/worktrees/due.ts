// Whether this window starts a worktree scan now. Pure: no vscode, no file system. The host reads the
// settings, the cache and the claim file and passes what it found.
import { dirname, join } from "node:path";

/** The claim file's name; it sits beside the scan cache. Not a `.json` name, so no session-row reader parses it. */
export const CLAIM_FILE = "scan.claim";

/** The claim file for a cache file: same folder. */
export const claimPathFor = (cachePath: string): string => join(dirname(cachePath), CLAIM_FILE);

/** A claim older than this is a window that died mid-scan: the next window takes over. */
export const CLAIM_MS = 10 * 60 * 1000;

export const DEFAULT_SCAN_MINUTES = 15;
export const MIN_SCAN_MINUTES = 5;
/** By default one worktree of a repo is read at a time, with 20 seconds per repo. */
export const DEFAULT_PARALLEL = 1;
export const DEFAULT_PER_REPO_SECONDS = 20;

/** The scan interval setting in minutes: 15 when unset or not a number, never under 5. */
export const scanMinutesOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(MIN_SCAN_MINUTES, value) : DEFAULT_SCAN_MINUTES;

/** The "worktrees read at once" setting: a whole number of 1 or more, else 1. */
export const parallelOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_PARALLEL;

/** The per-repo time limit setting in seconds: any number above 0, else 20. */
export const perRepoSecondsOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_PER_REPO_SECONDS;

export type Claim = { at: number; pid: number };

export const encodeClaim = (at: number, pid: number): string => JSON.stringify({ at, pid });

/** The claim a file holds, or nothing when the text is damaged, half-written or not a claim. */
export const decodeClaim = (text: string): Claim | undefined => {
  try {
    const v = JSON.parse(text) as Partial<Claim> | null;
    if (!v || typeof v !== "object" || typeof v.at !== "number" || !Number.isFinite(v.at) || typeof v.pid !== "number" || !Number.isFinite(v.pid)) return undefined;
    return { at: v.at, pid: v.pid };
  } catch {
    return undefined;
  }
};

export type DueState = {
  now: number;
  /** The `questlog.worktrees.enabled` setting. */
  on: boolean;
  /** This window's Questlog panel is showing. */
  visible: boolean;
  /** This window already has a scan under way. */
  running: boolean;
  /** Refresh was pressed: the interval is skipped, nothing else. */
  forced: boolean;
  /** When the cache on disk was written; none when there is no cache to read. */
  cacheScannedAt?: number;
  /** When the claim on disk was written; none when there is no claim. */
  claimAt?: number;
  intervalMs: number;
  claimMs?: number;
  /** When this window's last scan ended; none when it has not scanned yet. */
  lastAttemptAt?: number;
  /** That scan failed: the cache did not move, so without a wait every tick would try again. */
  lastFailed?: boolean;
  failWaitMs?: number;
};

/** After a scan that failed, this window waits this long before it tries again. Refresh skips the wait. */
export const FAIL_WAIT_MS = 5 * 60 * 1000;

export type DueReason = "off" | "hidden" | "running" | "claimed" | "failed" | "fresh" | "no-cache" | "forced" | "interval";

export type Due = { due: boolean; reason: DueReason };

/**
 * One scan per machine: only a window showing the panel scans, never two at once in a window, and never
 * while another window's claim is newer than the cache and younger than `claimMs`. A cache younger than the
 * interval means no scan unless Refresh asked. No cache at all means scan. A scan that failed is not tried
 * again for `failWaitMs`, cache or no cache, unless Refresh asked.
 */
export const scanDue = (s: DueState): Due => {
  const claimMs = s.claimMs ?? CLAIM_MS;
  if (!s.on) return { due: false, reason: "off" };
  if (!s.visible) return { due: false, reason: "hidden" };
  if (s.running) return { due: false, reason: "running" };
  if (s.claimAt !== undefined) {
    const newerThanCache = s.cacheScannedAt === undefined || s.claimAt > s.cacheScannedAt;
    const age = s.now - s.claimAt;
    // A claim dated in the future is damaged, not fresh.
    if (newerThanCache && age >= 0 && age < claimMs) return { due: false, reason: "claimed" };
  }
  if (!s.forced && s.lastFailed === true && s.lastAttemptAt !== undefined) {
    const since = s.now - s.lastAttemptAt;
    // An attempt dated in the future is a clock change, not a reason to wait.
    if (since >= 0 && since < (s.failWaitMs ?? FAIL_WAIT_MS)) return { due: false, reason: "failed" };
  }
  if (s.cacheScannedAt === undefined) return { due: true, reason: "no-cache" };
  if (s.forced) return { due: true, reason: "forced" };
  if (s.now - s.cacheScannedAt < s.intervalMs) return { due: false, reason: "fresh" };
  return { due: true, reason: "interval" };
};

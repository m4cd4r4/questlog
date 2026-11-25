// What a worktree and a repo are called in text output. Its own file so the CLI and the session-start line
// share it without importing each other.
import type { ScannedWorktree } from "./scan.ts";
import type { Verdict } from "./verdict.ts";

/** The last part of a path, whatever its slashes, as it is spelled. */
export const lastPart = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";

/** A worktree's slug: its folder's last path part. */
export const slugOf = (path: string): string => lastPart(path);

/** A repo's name: its main checkout folder's last path part. */
export const repoNameOf = (path: string): string => lastPart(path);

export const VERDICT_LABEL: Record<Verdict, string> = {
  "needs-you": "needs you", busy: "busy", "in-flight": "in flight", orphan: "orphan", closable: "closable", missing: "missing",
};

export const UNREAD = "not read yet";

/** The word a row leads with: its verdict, or "not read yet" for a worktree the scan did not reach. */
export const labelOf = (w: ScannedWorktree): string => (w.unread ? UNREAD : w.verdict ? VERDICT_LABEL[w.verdict.verdict] : "unknown");

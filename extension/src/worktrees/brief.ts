// The session-start line: what one folder's session should know about the worktrees of its repo.
// Pure: the last scan, a folder and the time in, one line or nothing out. No vscode import, no file system.
import { cut } from "../rows.ts";
import { isLinked, plural } from "./listing.ts";
import { repoNameOf, slugOf } from "./names.ts";
import { samePath } from "./parse.ts";
import type { ScanFile } from "./scan.ts";
import { holderOf } from "./servers.ts";
import type { Verdict } from "./verdict.ts";

/** A scan older than this says nothing: what could be closed a day ago may not be closable now. */
export const BRIEF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The line is never longer than this. */
export const BRIEF_MAX_CHARS = 200;

const SAYS: Record<Verdict, string> = {
  "needs-you": "needs you", busy: "is busy", "in-flight": "is in flight", orphan: "is an orphan", closable: "is closable", missing: "is missing",
};

/**
 * The line for a session started in `folder`, or "" when there is nothing to say.
 *
 * The folder's worktree is the entry with the longest path that holds it, so a subfolder counts as its
 * worktree. There is something to say when that worktree reads closable or orphan, when a worktree of the
 * repo reads closable, or when it shares changed files with an open sibling. Then the line gives its verdict
 * and reason, how many of the repo's worktrees are closable, and the first sibling by name that it shares
 * files with. The main checkout has no verdict: only the closable count. Nothing at all with no scan, a scan
 * older than BRIEF_MAX_AGE_MS, a folder in no scanned repo, or a repo the scan could not read.
 */
export const briefLine = (scan: ScanFile | undefined, folder: string, now: number): string => {
  if (!scan || now - scan.scannedAt > BRIEF_MAX_AGE_MS) return "";

  const entries = scan.repos.flatMap((r) => (r.worktrees ?? []).filter((w) => !w.bare).map((w) => ({ repo: r, w })));
  const held = holderOf(folder, entries.map((e) => e.w.path));
  const found = held === undefined ? undefined : entries.find((e) => samePath(e.w.path, held));
  if (!found || found.repo.error !== undefined) return "";
  const { repo, w } = found;

  const linked = repo.worktrees.filter(isLinked);
  const closable = linked.filter((x) => !x.unread && x.verdict?.verdict === "closable").length;
  const verdict = w.main || w.unread ? undefined : w.verdict;
  const shared = w.main ? [] : [...(w.overlaps ?? [])].sort((a, b) => {
    const x = slugOf(a.path).toLowerCase();
    const y = slugOf(b.path).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const own = verdict?.verdict === "closable" || verdict?.verdict === "orphan";
  if (!own && closable === 0 && shared.length === 0) return "";

  const parts: string[] = [];
  if (verdict) parts.push(`this worktree ${SAYS[verdict.verdict]} (${verdict.reason})`);
  if (closable > 0) parts.push(`${closable} of ${repoNameOf(repo.path)}'s ${plural(linked.length, "worktree", "worktrees")} can be closed`);
  if (shared.length > 0) {
    const others = shared.length - 1;
    parts.push(`shares ${plural(shared[0].count, "file", "files")} with ${slugOf(shared[0].path)}`
      + (others > 0 ? ` and ${plural(others, "other worktree", "other worktrees")}` : ""));
  }
  return cut(`Worktrees: ${parts.join("; ")}`.replace(/\s*[\r\n]+\s*/g, " "), BRIEF_MAX_CHARS);
};

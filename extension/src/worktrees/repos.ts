// Which folders to scan: pure, no vscode, no fs.
import { norm } from "../rows.ts";

export type RepoSources = {
  /** The folder each session row was started in. */
  sessionCwds?: readonly unknown[];
  /** `repo_path` of every worktree registry entry. */
  registryRepoPaths?: readonly unknown[];
};

/**
 * The folders to scan, each once whatever its slashes or case, in the order first seen (sessions before
 * the registry). Two folders that are worktrees of one repo both stay: only git can tell, so the scan does.
 */
export const repoList = ({ sessionCwds = [], registryRepoPaths = [] }: RepoSources): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...sessionCwds, ...registryRepoPaths]) {
    if (typeof p !== "string" || p.trim() === "") continue;
    const key = norm(p.trim());
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(p.trim());
  }
  return out;
};

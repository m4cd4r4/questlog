// `questlog-wt`: read the worktree scan from a terminal. No vscode import. The formatters are pure (scan and
// `now` in, lines out); `main` does the reading, the one write (`scan`) and the exit code.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ago, cut, norm } from "../rows.ts";
import { briefLine } from "./brief.ts";
import { refreshScan } from "./refresh.ts";
import { countText, isLinked, lastCommitText, notARepo, plural, prText, ROW_ORDER, rowVerdict, sameName, select, sizeFact, sizeText, type ListedRepo, type ListedWorktree } from "./listing.ts";
import { realRun, type Run } from "./run.ts";
import { defaultScanPath, readScan } from "./scan.ts";
import { realListServers } from "./servers-real.ts";
import { labelOf, repoNameOf, slugOf, UNREAD } from "./names.ts";
import type { ListServers } from "./servers.ts";
import type { SizeFs } from "./size.ts";
import { defaultRegistryPath, questlogDir, readRegistry, readRows } from "./sources.ts";

/** No line of text output is this long or longer. */
export const MAX_COLUMNS = 100;
const WIDEST = MAX_COLUMNS - 1;
/** The widest a slug is printed in `list` before it is shortened. */
const SLUG_MAX = 54;

export const USAGE = [
  "usage: questlog-wt <command> [options]",
  "",
  "  list                  every linked worktree of the last scan, grouped by repo",
  "  list --closable       only the worktrees that can be closed",
  "  list --repo <name>    only the repos of that name",
  "  show <slug>           one worktree in full (--repo <name> narrows it)",
  "  scan                  read every repo again and write the cache",
  "  brief [folder]        the session-start line for a folder (default: the current one)",
  "",
  "  --json                      print JSON, on any command",
  "  --cache <path>              the cache file (default: worktrees/scan.cache in Questlog's folder)",
  "  --registry <path>           the worktree registry (scan only)",
  "  --worktree-parallel <n>     worktrees of one repo read at once (scan only)",
  "  --per-repo-seconds <n>      time limit for one repo (scan only)",
].join("\n");

const LABEL_WIDTH = UNREAD.length;

/** The closing line of `list` and the tail of `scan`'s line, when the scan was handed folders that are no repo. */
const skippedText = (n: number) => `${plural(n, "folder", "folders")} skipped: gone, or not a git repository`;

const line = (text: string) => cut(text.trimEnd(), WIDEST);

/** A repo's heading: its name, then the count line in row order. A repo with nothing to list is its name alone. */
const headingOf = (r: ListedRepo): string => {
  const name = repoNameOf(r.path);
  return r.worktrees.length === 0 ? name : `${name}  ${countText(r.worktrees.map(rowVerdict), ROW_ORDER, r.timedOut === true)}`;
};

/** The text of `list`: per repo a heading, then one line per worktree: verdict, slug, PR, age of the last commit, size. */
export const formatList = (repos: readonly ListedRepo[], now: number): string[] => {
  const out: string[] = [];
  for (const r of repos) {
    if (out.length > 0) out.push("");
    out.push(line(headingOf(r)));
    if (r.error !== undefined) out.push(line(`  could not read: ${r.error}`));
    const width = Math.min(SLUG_MAX, Math.max(4, ...r.worktrees.map((w) => w.slug.length)));
    for (const w of r.worktrees) {
      const pr = w.pr?.number == null ? "-" : `#${w.pr.number}`;
      const age = typeof w.lastCommitAt === "number" ? ago(now - w.lastCommitAt) : "-";
      const size = w.size === undefined ? "-" : w.size === "unknown" ? "?" : sizeText(w.size.bytes);
      out.push(line(`  ${labelOf(w).padEnd(LABEL_WIDTH)} ${cut(w.slug, width).padEnd(width)} ${pr.padEnd(6)} ${age.padStart(4)} ${size.padStart(8)}`));
    }
  }
  return out;
};

/** The text of `show`: everything the scan holds about one worktree, one fact per line. */
export const formatShow = (repoPath: string, w: ListedWorktree, now: number): string[] => {
  const fact = (name: string, value: string) => line(`  ${name.padEnd(12)} ${value}`);
  const pr = w.pr?.state === "none" ? "none" : prText(w.pr) ?? "unknown";
  const size = w.size === undefined ? "not measured" : sizeFact(w.size) ?? "unknown";
  const server = w.server === undefined ? "none found" : w.server === "unknown" ? "unknown" : `port ${w.server.port}`;
  const out = [
    line(w.slug),
    fact("repo", `${repoNameOf(repoPath)} (${repoPath})`),
    fact("path", w.path),
    fact("branch", w.detached ? "(detached)" : w.branch || "(none)"),
    fact("verdict", w.verdict ? `${labelOf(w)}: ${w.verdict.reason}` : labelOf(w)),
    fact("PR", pr),
    fact("last commit", lastCommitText(w.lastCommitAt, now) ?? "unknown"),
    fact("size", size),
    fact("server", server),
    fact("brief", w.brief ?? "none recorded"),
  ];
  if (w.overlaps === undefined) out.push(fact("shares files", "not compared"));
  else if (w.overlaps.length === 0) out.push(fact("shares files", "with no open worktree"));
  for (const o of w.overlaps ?? []) {
    const more = o.count - o.files.length;
    out.push(fact("shares files", `with ${slugOf(o.path)} (${o.count}): ${o.files.join(", ")}${more > 0 ? `, +${more} more` : ""}`));
  }
  return out;
};

/** Everything `main` takes from outside, so a test can pass its own. */
export type Io = {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
  home: string;
  /** The folder `brief` speaks for when none is named. */
  cwd: string;
  now: () => number;
  run: Run;
  listServers: ListServers;
  sizeFs?: SizeFs;
  /** Whether a brief file is on disk. */
  exists?: (path: string) => Promise<boolean>;
};

const positive = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : Number.NaN;
};

/** Run one command. Returns the exit code: 0 done, 1 nothing or too much matched or the scan failed, 2 the command line was wrong. */
export const main = async (argv: readonly string[], io: Partial<Io> = {}): Promise<number> => {
  const out = io.out ?? ((text: string) => { process.stdout.write(`${text}\n`); });
  const err = io.err ?? ((text: string) => { process.stderr.write(`${text}\n`); });
  const env = io.env ?? process.env;
  const home = io.home ?? homedir();
  const now = io.now ?? Date.now;
  const run = io.run ?? realRun;
  const listServers = io.listServers ?? ((known: string[]) => realListServers(run, known));
  const usage = (why: string): number => { err(why); err(USAGE); return 2; };

  // The session-start line must never fail a session start: whatever is wrong, `brief` exits 0.
  const isBrief = argv[0] === "brief";

  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        closable: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        repo: { type: "string" },
        cache: { type: "string" },
        registry: { type: "string" },
        "worktree-parallel": { type: "string" },
        "per-repo-seconds": { type: "string" },
      },
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (isBrief) { err(why); return 0; }
    return usage(why);
  }
  const flags = parsed.values;
  const [command, ...rest] = parsed.positionals;
  if (flags.help) { out(USAGE); return 0; }
  if (command === undefined) return usage("no command given");

  const json = flags.json === true;
  const cachePath = flags.cache ?? defaultScanPath(env, home);
  const print = (lines: readonly string[]) => { if (lines.length > 0) out(lines.join("\n")); };

  if (command === "list") {
    if (rest.length > 0) return usage(`list takes no name: ${rest[0]}`);
    const scan = await readScan(cachePath);
    if (!scan) {
      err("no scan yet: run questlog-wt scan");
      if (json) out(JSON.stringify({ scannedAt: null, repos: [] }));
      return 0;
    }
    const { repos, named, skipped } = select(scan, { closable: flags.closable === true, ...(flags.repo === undefined ? {} : { repo: flags.repo }) });
    if (json) out(JSON.stringify({ scannedAt: scan.scannedAt, repos, ...(skipped > 0 ? { skipped } : {}) }));
    else {
      const lines = formatList(repos, now());
      print(skipped > 0 && flags.repo === undefined ? [...lines, ...(lines.length > 0 ? [""] : []), skippedText(skipped)] : lines);
    }
    if (flags.repo !== undefined && named === 0) { err(`no repo named ${flags.repo} in the last scan`); return 1; }
    if (flags.repo !== undefined && named > 1) { err(`${named} repos are named ${flags.repo}: all are listed`); return 1; }
    if (!json && repos.length === 0) err(flags.closable ? "no closable worktrees" : "no linked worktrees");
    return 0;
  }

  if (command === "show") {
    if (rest.length !== 1) return usage(rest.length === 0 ? "show needs a slug" : "show takes one slug");
    const slug = rest[0];
    const scan = await readScan(cachePath);
    if (!scan) { err("no scan yet: run questlog-wt scan"); return 1; }
    const { repos } = select(scan, flags.repo === undefined ? {} : { repo: flags.repo });
    const found = repos.flatMap((r) => r.worktrees.filter((w) => sameName(w.slug, slug)).map((w) => ({ repo: r.path, w })));
    if (json) out(JSON.stringify(found.map(({ repo, w }) => ({ ...w, repo }))));
    else print(found.flatMap(({ repo, w }, i) => [...(i > 0 ? [""] : []), ...formatShow(repo, w, now())]));
    if (found.length === 0) { err(`no worktree named ${slug} in the last scan`); return 1; }
    if (found.length > 1) { err(`${found.length} worktrees are named ${slug}: add --repo <name>`); return 1; }
    return 0;
  }

  if (command === "scan") {
    if (rest.length > 0) return usage(`scan takes no name: ${rest[0]}`);
    const worktreeParallel = positive(flags["worktree-parallel"]);
    const perRepoSeconds = positive(flags["per-repo-seconds"]);
    if (Number.isNaN(worktreeParallel) || (worktreeParallel !== undefined && !Number.isInteger(worktreeParallel))) return usage("--worktree-parallel needs a whole number above 0");
    if (Number.isNaN(perRepoSeconds)) return usage("--per-repo-seconds needs a number above 0");
    try {
      // The CLI is its own process, so it reads the two lists itself; the extension passes what it holds.
      const [rows, entries] = await Promise.all([readRows(questlogDir(env, home)), readRegistry(flags.registry ?? defaultRegistryPath(env, home))]);
      const scan = await refreshScan({
        sessionCwds: rows.map((r) => r.cwd),
        entries,
        cachePath, run, listServers, now,
        ...(worktreeParallel === undefined ? {} : { worktreeParallel }),
        ...(perRepoSeconds === undefined ? {} : { perRepoMs: perRepoSeconds * 1000 }),
        ...(io.sizeFs ? { sizeFs: io.sizeFs } : {}),
        ...(io.exists ? { exists: io.exists } : {}),
      });
      if (json) { out(JSON.stringify(scan)); return 0; }
      const linked = scan.repos.reduce((n, r) => n + r.worktrees.filter(isLinked).length, 0);
      const skipped = scan.repos.filter(notARepo).length;
      const failed = scan.repos.filter((r) => r.error !== undefined).length - skipped;
      const late = scan.repos.filter((r) => r.timedOut).length;
      out(line(`scanned ${plural(scan.repos.length - skipped, "repo", "repos")}, ${plural(linked, "linked worktree", "linked worktrees")}`
        + `${failed > 0 ? `, ${failed} could not be read` : ""}${late > 0 ? `, ${late} timed out` : ""}`));
      if (skipped > 0) out(skippedText(skipped));
      return 0;
    } catch (e) {
      err(`scan failed: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  if (command === "brief") {
    if (rest.length > 1) { err("brief takes one folder"); return 0; }
    const cwd = io.cwd ?? process.cwd();
    // A path that is already whole is used as it is spelled; anything else is read from the current folder.
    const folder = rest[0] === undefined ? cwd : /^([a-zA-Z]:)?[\\/]/.test(rest[0]) ? rest[0] : resolve(cwd, rest[0]);
    let text = "";
    try { text = briefLine(await readScan(cachePath), folder, now()); } catch { /* nothing to say */ }
    if (json) out(JSON.stringify({ line: text }));
    else if (text) out(text);
    return 0;
  }

  return usage(`unknown command: ${command}`);
};

/** True when this file is the script node was started with, also when reached through a link. */
const isEntry = (): boolean => {
  const started = process.argv[1];
  if (!started) return false;
  const here = norm(fileURLToPath(import.meta.url));
  if (norm(resolve(started)) === here) return true;
  try { return norm(realpathSync(started)) === here; } catch { return false; }
};

if (isEntry()) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

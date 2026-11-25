// The one door to the outside world for the worktree scanner: run a program, get its output. No vscode import.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";

export type RunResult = {
  /** The exit code; -1 when the program could not be started or was killed. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** Runs one program with no shell. It never throws and never rejects: a failure is a result. */
export type Run = (cmd: string, args: readonly string[], opts: { cwd: string; timeoutMs?: number }) => Promise<RunResult>;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 16 * 1024 * 1024;

/** What stderr reads when the folder to run in does not exist. */
export const FOLDER_NOT_FOUND = "folder not found";

/** The ok test every caller uses: the program ran, exited 0 and was not cut off. */
export const ok = (r: { code: number; timedOut: boolean }) => r.code === 0 && !r.timedOut;

/** Why a call failed, in one line: timed out, else the first line of stderr, else the exit code. */
export const failedText = (what: string, r: RunResult) =>
  r.timedOut ? `${what} timed out` : r.stderr.trim().split(/\r?\n/)[0] || `${what} failed (${r.code})`;

/**
 * The real adapter, on execFile. A missing folder, a missing program, a timeout or output past `maxBuffer`
 * all come back as code -1; stderr says which ("folder not found", "program not found: git",
 * "output too large"), because execFile reports the first two alike as ENOENT and kills the child for the
 * last two alike. GIT_OPTIONAL_LOCKS=0 keeps `git status` from taking the index lock in a repo another
 * session is using.
 */
export const makeRealRun = (maxBuffer: number = MAX_BUFFER): Run => async (cmd, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  // Asked without blocking: this also runs inside the extension host.
  if (!(await access(cwd).then(() => true, () => false))) return { code: -1, stdout: "", stderr: FOLDER_NOT_FOUND, timedOut: false };
  return new Promise<RunResult>((resolve) => {
    try {
      execFile(
        cmd, [...args],
        { cwd, timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
        (err, stdout, stderr) => {
          const out = typeof stdout === "string" ? stdout : "";
          const errOut = typeof stderr === "string" ? stderr : "";
          if (!err) return resolve({ code: 0, stdout: out, stderr: errOut, timedOut: false });
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (e.code === "ENOENT") return resolve({ code: -1, stdout: out, stderr: `program not found: ${cmd}`, timedOut: false });
          // Killed for printing too much, not for running too long.
          if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolve({ code: -1, stdout: out, stderr: `output too large: ${cmd}`, timedOut: false });
          const timedOut = e.killed === true || e.signal === "SIGTERM";
          const code = typeof e.code === "number" && !timedOut ? e.code : -1;
          resolve({ code, stdout: out, stderr: errOut || String(e.message ?? ""), timedOut });
        },
      );
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String((e as Error)?.message ?? e), timedOut: false });
    }
  });
};

export const realRun: Run = makeRealRun();

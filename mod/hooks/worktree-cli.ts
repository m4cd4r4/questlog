// Where the worktree CLI is, and the check on that path, in ONE place. The extension writes `cli.json` with the
// CLI's path; the mod reads it and runs `brief` at session start, because the mod is installed without the
// extension's files. It lives in the mod (a plugin may only import files inside its own folder) and the
// extension imports it from here, as it does close.ts. No imports, so both builds take it as is.

/** The subfolder of Questlog's data folder that holds the scan cache, the scan claim and `cli.json`. */
export const WORKTREES_DIR = 'worktrees'

/** The file the extension writes with the CLI's path. Not a session row, so the row readers never parse it. */
export const CLI_PATH_FILE = 'cli.json'

/** The scan cache, beside `cli.json`: what `brief` reads. */
export const SCAN_CACHE_FILE = 'scan.cache'

/** The CLI's file name inside the extension's `dist` folder. The mod runs a path only when it ends in this name. */
export const CLI_FILE = 'questlog-wt.mjs'

/** The separator a path already uses: a backslash when it has one, else a forward slash. */
const sepOf = (path: string) => (path.includes('\\') ? '\\' : '/')

/** `<dir>/<name>` with the separator `dir` already uses, and no doubled separator. */
const under = (dir: string, ...names: string[]) => {
  const sep = sepOf(dir)
  return [dir.replace(/[\\/]+$/, ''), ...names].join(sep)
}

/** `worktrees/cli.json` inside Questlog's data folder (`<config>/questlog`). */
export const cliPathFileIn = (questlogDir: string): string => under(questlogDir, WORKTREES_DIR, CLI_PATH_FILE)

/** The CLI of the extension installed at `extensionPath`. */
export const cliOf = (extensionPath: string): string => under(extensionPath, 'dist', CLI_FILE)

/** `cli.json`'s whole text: one field, the CLI's path. */
export const cliPathText = (extensionPath: string): string => JSON.stringify({ path: cliOf(extensionPath) })

/**
 * The CLI's path out of `cli.json`, or '' for anything else. Only an absolute local path (a drive letter, or
 * one leading forward slash) whose last part is `questlog-wt.mjs`: the mod runs this file at every session
 * start. A network share (`\\host\share`, `//host/share`) and a drive-relative path (`\x`) give ''.
 */
export const cliPathOf = (text: string): string => {
  let path: unknown
  try { path = (JSON.parse(text) as { path?: unknown } | null)?.path } catch { return '' }
  if (typeof path !== 'string' || /[\r\n\0]/.test(path)) return ''
  if (!/^([a-zA-Z]:[\\/]|\/)(?![\\/])/.test(path)) return ''
  return path.split(/[\\/]/).pop() === CLI_FILE ? path : ''
}

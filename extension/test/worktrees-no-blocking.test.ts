import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The extension host is shared by every extension in the window, and a blocking read of every row file once
// froze it (exthost-block.test.ts). The scan runs inside the host too, so nothing under src/worktrees may make
// a blocking file call. Only cli.ts may: it is its own process.
const WORKTREES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "worktrees");

/**
 * A blocking node:fs name or import: `readFileSync(`, a bare `statSync` passed along, `from "node:fs"`,
 * `require("fs")`, `import("node:fs")`. The promise API (`node:fs/promises`) passes.
 */
const BLOCKING = /\b[a-z]\w*Sync\b|from\s*["'](?:node:)?fs["']|(?:require|import)\(\s*["'](?:node:)?fs["']\s*\)/;

/** The code with its comments taken out, so a comment that names a blocking call is not a call. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("the pattern sees a blocking call, name or import, and passes the promise API and comments", () => {
  for (const line of ['readFileSync(p, "utf8")', "existsSync (p)", "paths.map(statSync)", 'import { stat } from "node:fs";', "import * as fs from 'fs';", 'const fs = require("fs")', 'await import("node:fs")']) {
    assert.equal(BLOCKING.test(code(line)), true, line);
  }
  for (const line of ['import { readFile } from "node:fs/promises";', "await fsp.stat(p)", "// readFileSync is not used here", "/* existsSync */ x()", "const Sync = 1"]) {
    assert.equal(BLOCKING.test(code(line)), false, line);
  }
});

test("no file under src/worktrees, at any depth, but cli.ts makes a blocking file call", () => {
  const files = readdirSync(WORKTREES, { recursive: true, encoding: "utf8" }).filter((n) => n.endsWith(".ts") && n !== "cli.ts");
  assert.equal(files.includes("scan.ts") && files.includes("refresh.ts") && files.includes("sources.ts"), true, "the source files were not found");
  // The removal path runs inside the host on a click, so it is held to the same rule
  assert.equal(files.includes("close.ts") && files.includes("claim.ts"), true, "the removal and claim files were not found");
  const guilty = files.filter((n) => BLOCKING.test(code(readFileSync(join(WORKTREES, n), "utf8"))));
  assert.deepEqual(guilty, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The extension host is shared by every extension in the window, and a blocking read of every row file once
// froze it (exthost-block.test.ts). The scan runs inside the host too, so nothing under src/worktrees may make
// a blocking file call. Only cli.ts may: it is its own process.
const WORKTREES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "worktrees");

/** A blocking node:fs call or import: `readFileSync(`, `existsSync(`, `from "node:fs"`, `require("fs")`. */
const BLOCKING = /\b\w+Sync\s*\(|from\s*["'](?:node:)?fs["']|require\(\s*["'](?:node:)?fs["']\s*\)/;

test("the pattern sees a blocking call or import, and passes the promise API", () => {
  for (const line of ['readFileSync(p, "utf8")', "existsSync (p)", 'import { stat } from "node:fs";', "import * as fs from 'fs';", 'const fs = require("fs")']) {
    assert.equal(BLOCKING.test(line), true, line);
  }
  for (const line of ['import { readFile } from "node:fs/promises";', "await fsp.stat(p)", "// no Sync here"]) assert.equal(BLOCKING.test(line), false, line);
});

test("no file under src/worktrees but cli.ts makes a blocking file call", () => {
  const files = readdirSync(WORKTREES).filter((n) => n.endsWith(".ts") && n !== "cli.ts");
  assert.equal(files.includes("scan.ts") && files.includes("refresh.ts") && files.includes("sources.ts"), true, "the source files were not found");
  const guilty = files.filter((n) => BLOCKING.test(readFileSync(join(WORKTREES, n), "utf8")));
  assert.deepEqual(guilty, []);
});

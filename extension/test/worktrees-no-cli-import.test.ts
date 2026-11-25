import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// cli.ts runs entry-point code when it is imported (it reads import.meta.url), and the extension bundle is
// CommonJS, where that is empty. Nothing the extension loads may import it; what both need lives in listing.ts.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const WORKTREES = join(SRC, "worktrees");

/** Any import, re-export or require of a module named cli, with or without its extension. */
const IMPORTS_CLI = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](?:\.{1,2}\/)(?:[\w.-]+\/)*cli(?:\.[cm]?[tj]s)?["']/;

const CLI = join(WORKTREES, "cli.ts");

/** Every .ts file under extension/src, at any depth, but cli.ts itself. */
const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((n) => n.endsWith(".ts"))
  .map((n) => join(SRC, n))
  .filter((f) => f !== CLI);

test("the pattern sees every way of importing cli.ts", () => {
  for (const line of [
    'import { main } from "./cli.ts";',
    'import { main } from "./cli";',
    "import { select } from './worktrees/cli.ts';",
    'import { select } from "./worktrees/cli";',
    'export { sizeText } from "../worktrees/cli.js";',
    'const m = await import("./cli.ts");',
    'const m = require("./worktrees/cli");',
  ]) assert.equal(IMPORTS_CLI.test(line), true, line);
  for (const line of ['import { x } from "./client.ts";', 'import { y } from "./cli-helpers.ts";', 'import { z } from "./listing.ts";', "// see cli.ts"]) {
    assert.equal(IMPORTS_CLI.test(line), false, line);
  }
});

test("no file under extension/src but cli.ts itself imports cli.ts", () => {
  assert.equal(files.length > 25, true, "the source files were not found");
  for (const name of ["extension.ts", "model.ts", "webview.ts", "rows.ts", "plans.ts", join("worktrees", "scan.ts"), join("worktrees", "view.ts")]) {
    assert.equal(files.includes(join(SRC, name)), true, `${name} is read`);
  }
  assert.equal(files.includes(CLI), false);
  const guilty = files.filter((f) => IMPORTS_CLI.test(readFileSync(f, "utf8")));
  assert.deepEqual(guilty, []);
});

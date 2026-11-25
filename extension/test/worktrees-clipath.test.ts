import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_FILE, CLI_PATH_FILE, SCAN_CACHE_FILE as MOD_SCAN_CACHE_FILE, WORKTREES_DIR, cliOf, cliPathFileIn, cliPathOf, cliPathText } from "../../mod/hooks/worktree-cli.ts";
import { defaultScanPath, SCAN_CACHE_FILE, writeWhole } from "../src/worktrees/scan.ts";
import { questlogDir } from "../src/worktrees/sources.ts";

// The extension writes cli.json and the mod reads it. Both sides take the names and the path check from one
// file in the mod, so these tests hold the two ends together.

const flip = (p: string) => (p.includes("\\") ? p.split("\\").join("/") : p.split("/").join("\\"));

test("cli.json sits in the worktrees subfolder of Questlog's folder, beside the scan cache", () => {
  const env = { CLAUDE_CONFIG_DIR: join("/work", "cfg") };
  const file = cliPathFileIn(questlogDir(env, "/home/acme"));
  assert.equal(file, join("/work", "cfg", "questlog", "worktrees", "cli.json"));
  assert.equal(cliPathFileIn(questlogDir({}, join("/home", "acme"))), join("/home", "acme", ".claude", "questlog", "worktrees", "cli.json"));
  assert.equal(dirname(file), dirname(defaultScanPath(env, "/home/acme")));
  assert.equal(WORKTREES_DIR, "worktrees");
});

test("cliPathFileIn keeps the separator the folder uses and never doubles one", () => {
  assert.equal(cliPathFileIn("C:\\cfg\\questlog"), "C:\\cfg\\questlog\\worktrees\\cli.json");
  assert.equal(cliPathFileIn("C:\\cfg\\questlog\\"), "C:\\cfg\\questlog\\worktrees\\cli.json");
  assert.equal(cliPathFileIn("/cfg/questlog/"), "/cfg/questlog/worktrees/cli.json");
});

test("the two sides name the same files", () => {
  assert.equal(MOD_SCAN_CACHE_FILE, SCAN_CACHE_FILE);
  assert.equal(CLI_PATH_FILE, "cli.json");
  assert.equal(CLI_FILE, "questlog-wt.mjs");
});

test("the CLI the text names is the file the build writes", () => {
  const build = readFileSync(fileURLToPath(new URL("../esbuild.mjs", import.meta.url)), "utf8");
  assert.equal(build.includes(`"dist/${CLI_FILE}"`), true, "esbuild.mjs writes dist/questlog-wt.mjs");
});

test("the text holds one field, the CLI in the extension's dist folder", () => {
  const ext = join(tmpdir(), "acme-ext");
  assert.deepEqual(JSON.parse(cliPathText(ext)), { path: join(ext, "dist", CLI_FILE) });
  assert.equal(cliOf(ext), join(ext, "dist", CLI_FILE));
  assert.equal(cliOf("C:\\ext\\acme\\"), "C:\\ext\\acme\\dist\\questlog-wt.mjs");
});

test("the text the extension writes goes through cliPathOf back to the same path, with either slash", () => {
  const ext = join(tmpdir(), "acme-ext");
  assert.equal(cliPathOf(cliPathText(ext)), cliOf(ext));
  // A drive-letter path reads the same with either slash; a path with no drive letter must keep its forward slash
  if (/^[a-zA-Z]:/.test(ext)) assert.equal(cliPathOf(cliPathText(flip(ext))), cliOf(flip(ext)));
  assert.equal(cliPathOf(JSON.stringify({ path: "C:\\work\\acme-ext\\dist\\questlog-wt.mjs" })), "C:\\work\\acme-ext\\dist\\questlog-wt.mjs");
  assert.equal(cliPathOf(JSON.stringify({ path: "C:/work/acme-ext/dist/questlog-wt.mjs" })), "C:/work/acme-ext/dist/questlog-wt.mjs");
  assert.equal(cliPathOf(JSON.stringify({ path: "/work/acme-ext/dist/questlog-wt.mjs" })), "/work/acme-ext/dist/questlog-wt.mjs");
});

test("cliPathOf gives nothing for a relative path, another file name and broken text", () => {
  const of = (path: unknown) => cliPathOf(JSON.stringify({ path }));
  for (const p of ["dist/questlog-wt.mjs", "questlog-wt.mjs", "./questlog-wt.mjs", "C:questlog-wt.mjs", "/work/acme-ext/dist/other.mjs", "/work/acme-ext/dist/questlog-wt.mjs.exe", "/work/acme-ext/dist/questlog-wt.mjs/", "/work/acme-ext/dist/QUESTLOG-WT.MJS", "/work/acme-ext/dist/x\nquestlog-wt.mjs", "/work/dist/questlog-wt.mjs\0", ""]) {
    assert.equal(of(p), "", JSON.stringify(p));
  }
  assert.equal(of(7), "");
  assert.equal(of(["/work/dist/questlog-wt.mjs"]), "");
  assert.equal(cliPathOf(""), "");
  assert.equal(cliPathOf("{"), "");
  assert.equal(cliPathOf("null"), "");
  assert.equal(cliPathOf('"/work/dist/questlog-wt.mjs"'), "");
  assert.equal(cliPathOf(JSON.stringify({ file: "/work/dist/questlog-wt.mjs" })), "");
});

test("cliPathOf gives nothing for a network share or a drive-relative path", () => {
  const of = (path: unknown) => cliPathOf(JSON.stringify({ path }));
  for (const p of ["\\\\host\\share\\dist\\questlog-wt.mjs", "//host/share/dist/questlog-wt.mjs", "\\\\?\\C:\\work\\dist\\questlog-wt.mjs", "/\\host\\share\\questlog-wt.mjs", "\\work\\dist\\questlog-wt.mjs", "C:\\\\host\\questlog-wt.mjs"]) {
    assert.equal(of(p), "", p);
  }
});

test("written whole into a temp folder, cli.json reads back through cliPathOf, and the last writer wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "questlog-clipath-"));
  try {
    const file = cliPathFileIn(join(dir, "questlog"));
    await writeWhole(file, cliPathText(join(dir, "acme-ext")));
    assert.equal(cliPathOf(await readFile(file, "utf8")), cliOf(join(dir, "acme-ext")));
    await writeWhole(file, cliPathText(join(dir, "acme-ext-2")));
    assert.equal(cliPathOf(await readFile(file, "utf8")), cliOf(join(dir, "acme-ext-2")));
    assert.deepEqual(await readdir(dirname(file)), [CLI_PATH_FILE]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("plugin.json holds worktree_line as a boolean that is on by default, with a title and a description", () => {
  const file = fileURLToPath(new URL("../../mod/.claude-plugin/plugin.json", import.meta.url));
  const plugin = JSON.parse(readFileSync(file, "utf8")) as { userConfig?: Record<string, { type?: string; default?: unknown; title?: string; description?: string }> };
  const option = plugin.userConfig?.worktree_line;
  assert.equal(option?.type, "boolean");
  assert.equal(option?.default, true);
  assert.equal(option?.title, "Worktree line at session start");
  assert.match(option?.description ?? "", /Needs the Questlog VS Code extension/);
});

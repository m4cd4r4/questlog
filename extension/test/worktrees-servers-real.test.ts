// The real server lister against this machine: a listener the test starts itself, from a folder under the OS temp folder.
// The pure tests hold the builder's belief about netstat, the process table and lsof; this one checks it here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realRun } from "../src/worktrees/run.ts";
import { realListServers } from "../src/worktrees/servers-real.ts";
import { norm } from "../src/rows.ts";

const has = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { windowsHide: true, stdio: "ignore", timeout: 10_000 });
  return !r.error;
};

/** Why the real lister cannot run here, or empty when it can. */
const missingTool = (): string => {
  if (process.platform === "win32") {
    if (!has("netstat", ["-ano", "-p", "TCP"])) return "netstat is not on this machine";
    if (!has("powershell", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"])) return "powershell is not on this machine";
    return "";
  }
  return has("lsof", ["-v"]) ? "" : "lsof is not on this machine";
};

const SERVER = [
  'const server = require("node:net").createServer();',
  'server.listen(0, "127.0.0.1", () => console.log(server.address().port));',
].join("\n");

test("the real lister finds a listener started from a folder under the OS temp folder and names that folder", async (t) => {
  const why = missingTool();
  if (why) return t.skip(why);

  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "questlog-wt-server-")));
  const folder = join(root, "acme-app-feature-a");
  let child: ChildProcess | undefined;
  try {
    mkdirSync(folder);
    const script = join(folder, "server.cjs");
    writeFileSync(script, SERVER);
    child = spawn(process.execPath, [script], { cwd: folder, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the test server never printed its port")), 10_000);
      child!.stdout!.once("data", (d) => { clearTimeout(timer); resolve(Number.parseInt(String(d).trim(), 10)); });
      child!.once("error", (e) => { clearTimeout(timer); reject(e); });
    });
    assert.ok(Number.isInteger(port) && port > 0, `port printed: ${port}`);

    const listeners = await realListServers(realRun, [folder]);
    assert.ok(listeners, "the port table could not be read");
    const mine = listeners.find((l) => l.port === port);
    assert.ok(mine, `port ${port} was not mapped to a folder`);
    assert.equal(norm(mine.folder), norm(folder));
  } finally {
    // Windows keeps the folder locked while a process runs in it, so wait for the child to go before removing it.
    if (child && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill();
      await gone;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

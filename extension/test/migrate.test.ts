import { test } from "node:test";
import assert from "node:assert/strict";
import { MIGRATED_SETTINGS, migrateSettings, type Config } from "../src/migrate.ts";

type Values = Record<string, { globalValue?: unknown; workspaceValue?: unknown }>;

function fake(values: Values) {
  const updates: [string, unknown, boolean][] = [];
  const config: Config = {
    inspect: (key) => values[key],
    update: async (key, value, global) => {
      updates.push([key, value, global]);
    },
  };
  return { config, updates };
}

test("migrateSettings copies user and workspace values to the new section", async () => {
  const old = fake({ registryPath: { globalValue: "C:/r.json" }, resumeCommand: { workspaceValue: "claude -r {id}" } });
  const next = fake({});
  await migrateSettings(old.config, next.config);
  assert.deepEqual(next.updates, [["registryPath", "C:/r.json", true], ["resumeCommand", "claude -r {id}", false]]);
});

test("migrateSettings keeps a value already set under the new name", async () => {
  const old = fake({ agentViewSeconds: { globalValue: 30 } });
  const next = fake({ agentViewSeconds: { globalValue: 60 } });
  await migrateSettings(old.config, next.config);
  assert.deepEqual(next.updates, []);
});

test("migrateSettings carries a false value and skips unset keys", async () => {
  const old = fake({ useAgentView: { globalValue: false }, registryPath: {} });
  const next = fake({});
  await migrateSettings(old.config, next.config);
  assert.deepEqual(next.updates, [["useAgentView", false, true]]);
});

test("the four settings are the ones migrated", () => {
  assert.deepEqual([...MIGRATED_SETTINGS], ["registryPath", "useAgentView", "agentViewSeconds", "resumeCommand"]);
});

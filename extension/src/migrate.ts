/** The part of a VS Code configuration section the settings copy uses. */
export type Config = {
  inspect(key: string): { globalValue?: unknown; workspaceValue?: unknown } | undefined;
  update(key: string, value: unknown, global: boolean): PromiseLike<void>;
};

export const OLD_SECTION = "sessionCompass";
export const MIGRATED_KEY = "questlog.settingsMigrated";
export const MIGRATED_SETTINGS = ["registryPath", "useAgentView", "agentViewSeconds", "resumeCommand"] as const;

/** Copies settings saved under the extension's old name; a value already set under the new name stays. */
export async function migrateSettings(from: Config, to: Config) {
  for (const key of MIGRATED_SETTINGS) {
    const old = from.inspect(key);
    const now = to.inspect(key);
    if (old?.globalValue !== undefined && now?.globalValue === undefined) await to.update(key, old.globalValue, true);
    if (old?.workspaceValue !== undefined && now?.workspaceValue === undefined) await to.update(key, old.workspaceValue, false);
  }
}

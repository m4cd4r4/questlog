import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});

// The worktree CLI: one file with no dependencies, run as `node dist/questlog-wt.mjs`.
await build({
  entryPoints: ["src/worktrees/cli.ts"],
  bundle: true,
  outfile: "dist/questlog-wt.mjs",
  platform: "node",
  target: "node18",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});

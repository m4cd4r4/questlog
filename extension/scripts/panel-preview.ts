// Draws the sidebar page outside VS Code, from seeded data, so its look can be checked in a plain browser.
// Run from extension/: node scripts/panel-preview.ts [output folder]
// Writes one page per seed and theme into the folder (default: questlog-panel-preview under the OS temp folder)
// and prints the paths. Not bundled, not shipped. Every path in it is made up.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildModel, worktreeRowsOf } from "../src/model.ts";
import { plansFromRegistry, type ParentPlan, type RegistryEntry } from "../src/plans.ts";
import type { Row } from "../src/rows.ts";
import { pageHtml } from "../src/webview.ts";
import type { ScanFile, ScannedRepo, ScannedWorktree } from "../src/worktrees/scan.ts";
// The scan's shape is built by the tests' own helpers, so a new fact field is added in one place.
import { scannedRepo as repo, scannedWt as wt } from "../test/worktrees-fixtures.ts";

const NOW = Date.UTC(2026, 0, 10, 4);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, MB = 1024 * 1024;

const size = (bytes: number, shares = false) => ({ bytes, measuredAt: NOW, key: "k", ...(shares ? { sharesNodeModules: true as const } : {}) });
const scanOf = (repos: ScannedRepo[]): ScanFile => ({ version: 1, scannedAt: NOW - 5 * MIN, repos });
const pad = (n: number) => String(n).padStart(2, "0");

const NAMES = ["pricing-table", "nav-rework", "checkout-copy", "footer-links", "search-index", "image-cache", "login-errors", "billing-export",
  "onboarding-tour", "email-digest", "dark-theme", "audit-log", "csv-import", "rate-limits", "webhook-retry", "team-invites",
  "profile-page", "usage-chart", "api-tokens", "status-banner", "mobile-menu", "help-centre", "tag-filter", "saved-views",
  "export-pdf", "locale-dates", "cache-headers", "queue-metrics", "sso-setup", "trial-banner", "seat-counter", "long-running-migration-of-the-order-history-tables"];

/** 32 worktrees: 21 closable, 4 need you, the rest in flight. */
const exampleRepo = (): ScannedRepo => {
  const at = (i: number) => `/work/acme-app-${NAMES[i]}`;
  const list: ScannedWorktree[] = [wt("/work/acme-app", "main", { main: true })];
  list.push(wt(at(0), "feat/pricing-table", {
    dirty: 3, changed: 2, untracked: 1, lastCommitAt: NOW - 2 * HOUR, size: size(412 * MB, true), pr: { state: "open", number: 212 },
    overlaps: [{ path: at(4), count: 2, files: ["src/pricing.ts", "src/plans.ts"] }], brief: "recoverable",
  }));
  list.push(wt(at(1), "feat/nav-rework", { unpushed: 2, lastCommitAt: NOW - 3 * DAY, size: size(38 * MB) }));
  list.push(wt(at(2), "feat/checkout-copy", { dirty: 1, changed: 0, untracked: 1, lastCommitAt: NOW - 9 * DAY, size: size(1.6 * 1024 * MB), pr: { state: "merged", number: 187 } }));
  list.push(wt(at(3), "feat/footer-links", { stashes: 1, lastCommitAt: NOW - 20 * DAY, size: "unknown" }));
  for (let i = 4; i < 11; i++) {
    list.push(wt(at(i), `feat/${NAMES[i]}`, i % 2 === 0
      ? { pr: { state: "open", number: 200 + i }, lastCommitAt: NOW - i * 5 * HOUR, size: size((20 + i * 7) * MB) }
      : { lastCommitAt: NOW - i * DAY, size: size((20 + i * 7) * MB) }));
  }
  for (let i = 11; i < 32; i++) {
    list.push(wt(at(i), `feat/${NAMES[i]}`, { pr: { state: i % 5 === 0 ? "closed" : "merged", number: 100 + i }, lastCommitAt: NOW - (i - 6) * DAY, size: size((12 + i * 9) * MB, i % 3 === 0) }));
  }
  return repo("/work/acme-app", list);
};

/** A repo nobody has a session in: only worktrees, one of them gone and one with a dev server. */
const quietRepo = (): ScannedRepo => repo("/work/field-notes", [
  wt("/work/field-notes", "main", { main: true }),
  wt("/work/field-notes-map-view", "feat/map-view", { server: { port: 5173 }, pr: { state: "open", number: 31 }, lastCommitAt: NOW - 40 * MIN, size: size(96 * MB, true) }),
  wt("/work/field-notes-offline", "feat/offline", { prunable: true, prunableReason: "gitdir file points to non-existent location" }),
  wt("/work/field-notes-sync", "", { detached: true, lastCommitAt: NOW - 30 * DAY, size: size(11 * MB) }),
  wt("/work/field-notes-tags", "feat/tags", { pr: { state: "merged", number: 28 }, lastCommitAt: NOW - 12 * DAY, size: size(54 * MB) }),
]);

/** Real scale: one repo of 154 worktrees, 100 needing you, 30 closable, 14 in flight and 10 not read, timed out. */
const largeRepo = (): ScannedRepo => {
  const list: ScannedWorktree[] = [wt("/work/big-platform", "main", { main: true })];
  for (let i = 1; i <= 154; i++) {
    const path = `/work/big-platform-${NAMES[i % NAMES.length]}-${pad(i)}`;
    const branch = `feat/${NAMES[i % NAMES.length]}-${pad(i)}`;
    const age = { lastCommitAt: NOW - ((i % 60) + 1) * DAY };
    if (i <= 100) list.push(wt(path, branch, i % 3 === 0 ? { ...age, dirty: 2, changed: 0, untracked: 2 } : i % 3 === 1 ? { ...age, dirty: 4, changed: 3, untracked: 1, size: size(i * 9 * MB) } : { ...age, unpushed: 1, size: size(i * 3 * MB) }));
    else if (i <= 130) list.push(wt(path, branch, { ...age, pr: { state: "merged", number: 1000 + i }, size: size(i * 2 * MB) }));
    else if (i <= 144) list.push(wt(path, branch, { ...age, pr: { state: "open", number: 1000 + i } }));
    else list.push(wt(path, branch, { unread: true }));
  }
  return repo("/work/big-platform", list, { timedOut: true, tookMs: 20_000 });
};

/** Two sequences no plan names: "pricing" with a merged step and a gap (s1, s2, s4), "search" in waves, beside two worktrees in neither. */
const sequenceRepo = (): ScannedRepo => repo("/work/acme-app", [
  wt("/work/acme-app", "main", { main: true }),
  wt("/work/acme-app-pricing-s1", "feat/pricing-s1", { pr: { state: "merged", number: 301 }, lastCommitAt: NOW - 12 * DAY, size: size(48 * MB) }),
  wt("/work/acme-app-pricing-s2", "feat/pricing-s2", { dirty: 2, changed: 2, untracked: 0, pr: { state: "open", number: 305 }, lastCommitAt: NOW - 3 * HOUR, size: size(212 * MB, true) }),
  wt("/work/acme-app-pricing-s4", "feat/pricing-s4", { ownCommits: 0, lastCommitAt: NOW - 2 * DAY, size: size(36 * MB) }),
  wt("/work/acme-app-search-wave1", "feat/search-wave1", { pr: { state: "merged", number: 288 }, lastCommitAt: NOW - 20 * DAY, size: size(64 * MB) }),
  wt("/work/acme-app-search-wave2", "feat/search-wave2", { pr: { state: "merged", number: 296 }, lastCommitAt: NOW - 9 * DAY, size: size(71 * MB) }),
  wt("/work/acme-app-search-wave3", "feat/search-wave3", { pr: { state: "open", number: 309 }, lastCommitAt: NOW - 5 * HOUR, size: size(88 * MB) }),
  wt("/work/acme-app-nav-rework", "feat/nav-rework", { unpushed: 2, lastCommitAt: NOW - 3 * DAY, size: size(38 * MB) }),
  wt("/work/acme-app-footer-links", "feat/footer-links", { pr: { state: "open", number: 311 }, lastCommitAt: NOW - 6 * DAY, size: size(22 * MB) }),
]);

/** A registry plan of four slices, three with a worktree on disk: the plan card takes its facts from this scan. */
const planRepo = (): ScannedRepo => repo("/work/acme-app", [
  wt("/work/acme-app", "main", { main: true }),
  wt("/work/acme-app-checkout-cart", "feat/checkout-cart", { pr: { state: "merged", number: 321 }, lastCommitAt: NOW - 4 * DAY, size: size(52 * MB) }),
  wt("/work/acme-app-checkout-form", "feat/checkout-form", { dirty: 2, changed: 2, untracked: 0, pr: { state: "open", number: 326 }, lastCommitAt: NOW - 2 * HOUR, size: size(140 * MB, true) }),
  wt("/work/acme-app-checkout-totals", "feat/checkout-totals", { dirty: 1, changed: 1, untracked: 0, pr: { state: "merged", number: 318 }, lastCommitAt: NOW - 6 * DAY, size: size(47 * MB) }),
]);

const slice = (slug: string, label: string, wave: number, status: string, over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  slug, plan: "Checkout rework", label, wave, status, repo_path: "/work/acme-app",
  worktree_path: status === "planned" ? null : `/work/acme-app-${slug}`, last_activity_at: new Date(NOW - 2 * HOUR).toISOString(), ...over,
});
/** The registry as the host reads it: S1 and S2 materialised, S3 called merged while its folder is still there, S4 not minted. */
const planEntries = (): RegistryEntry[] => [
  slice("checkout-cart", "S1", 1, "materialised"),
  slice("checkout-form", "S2", 2, "materialised"),
  slice("checkout-totals", "S3", 3, "merged"),
  slice("checkout-receipts", "S4", 4, "planned", { depends_on: ["checkout-form"] }),
];

const row = (id: string, repoName: string, plan: string, over: Partial<Row> = {}): Row =>
  ({ id, repo: repoName, where: "", plan, done: 1, total: 3, now: "", updatedAt: NOW - 4 * MIN, cwd: `/work/${repoName}`, ...over });
/** A tab closed with steps left: every scene has one, so the block's place before the ended line shows. */
const ended = (id: string, repoName: string, plan: string): Row => row(id, repoName, plan, { ended: true, done: 2, total: 5, updatedAt: NOW - 3 * HOUR });

type Seed = { scan: ScanFile; rows: Row[]; focusedId?: string; plans?: ParentPlan[]; state?: Record<string, unknown> };
const example = (): Seed => ({
  scan: scanOf([exampleRepo(), quietRepo()]),
  rows: [
    row("11111111-aaaa-4bbb-8ccc-000000000001", "acme-app", "Pricing table rework", {
      where: "pricing-table", done: 2, total: 5, now: "Wire the new tiers into checkout",
      steps: [{ text: "Read the pricing spec", status: "done" }, { text: "Table markup", status: "done" }, { text: "Wire the new tiers into checkout", status: "now" }, { text: "Tests", status: "todo" }, { text: "PR", status: "todo" }],
    }),
    row("22222222-aaaa-4bbb-8ccc-000000000002", "acme-app", "Search index tidy", { where: "search-index", done: 1, total: 4, updatedAt: NOW - 9 * HOUR }),
    ended("77777777-aaaa-4bbb-8ccc-000000000007", "acme-app", "Footer links audit"),
  ],
  focusedId: "11111111-aaaa-4bbb-8ccc-000000000001",
});

const SEEDS: Record<string, Seed> = {
  example: example(),
  // The same, with one row opened to its reason and facts and the closable rows shown
  "example-open": { ...example(), state: { open: ["w:/work/acme-app-pricing-table", "wc:/work/acme-app"] } },
  sequence: {
    scan: scanOf([sequenceRepo()]),
    rows: [
      row("44444444-aaaa-4bbb-8ccc-000000000004", "acme-app", "Pricing tiers, step 2", { where: "pricing-s2", done: 1, total: 4, now: "Tier limits in the checkout form" }),
      ended("88888888-aaaa-4bbb-8ccc-000000000008", "acme-app", "Search wave 3 review"),
    ],
    focusedId: "44444444-aaaa-4bbb-8ccc-000000000004",
  },
  plan: {
    scan: scanOf([planRepo()]),
    rows: [
      row("55555555-aaaa-4bbb-8ccc-000000000005", "acme-app", "Checkout form fields", { where: "checkout-form", done: 2, total: 4, now: "Validate the postcode field" }),
      ended("99999999-aaaa-4bbb-8ccc-000000000009", "acme-app", "Checkout totals rounding"),
    ],
    // The card is what the code makes of the registry and the scan: no step is written by hand
    plans: plansFromRegistry(planEntries(), { now: NOW, exists: () => true }),
    // The plan card opened, so its slices and their live facts show
    state: { open: ["c:plan:acme-app:Checkout rework"], seen: ["c:plan:acme-app:Checkout rework"] },
  },
  large: {
    scan: scanOf([largeRepo()]),
    rows: [
      row("33333333-aaaa-4bbb-8ccc-000000000003", "big-platform", "Queue metrics dashboard", { where: "queue-metrics-27", done: 3, total: 6, now: "Chart the retry counts" }),
      ended("aaaaaaaa-aaaa-4bbb-8ccc-00000000000a", "big-platform", "Retry counter fix"),
    ],
  },
};

// Stand-ins for the VS Code theme variables the page's CSS reads (Dark Modern and Light Modern values).
const THEMES: Record<string, Record<string, string>> = {
  dark: {
    "--vscode-foreground": "#cccccc", "--vscode-descriptionForeground": "#9d9d9d", "--vscode-widget-border": "#313131",
    "--vscode-list-hoverBackground": "#2a2d2e", "--vscode-list-inactiveSelectionBackground": "#37373d",
    "--vscode-testing-iconPassed": "#73c991", "--vscode-charts-yellow": "#cca700", "--vscode-charts-red": "#f14c4c", "--vscode-charts-blue": "#3794ff",
    "--vscode-font-family": "'Segoe UI', system-ui, sans-serif", "--vscode-sideBar-background": "#181818", "--vscode-focusBorder": "#0078d4",
  },
  light: {
    "--vscode-foreground": "#3b3b3b", "--vscode-descriptionForeground": "#616161", "--vscode-widget-border": "#e5e5e5",
    "--vscode-list-hoverBackground": "#f2f2f2", "--vscode-list-inactiveSelectionBackground": "#e4e6f1",
    "--vscode-testing-iconPassed": "#388a34", "--vscode-charts-yellow": "#bf8803", "--vscode-charts-red": "#e51400", "--vscode-charts-blue": "#1a85ff",
    "--vscode-font-family": "'Segoe UI', system-ui, sans-serif", "--vscode-sideBar-background": "#f8f8f8", "--vscode-focusBorder": "#005fb8",
  },
};

const NONCE = "preview";
// "<" is escaped so no seeded text can end the script element
const asScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const page = (seed: string, theme: string, withScan: boolean): string => {
  const { rows, focusedId, plans = [], state = {} } = SEEDS[seed];
  // Without the scan the page is what it was before the Worktrees block: no block, plan cards from the registry only
  const scan: ScanFile = withScan ? SEEDS[seed].scan : scanOf([]);
  const model = buildModel({ rows, plans, note: [], now: NOW, ...(withScan ? { scan } : {}), ...(focusedId ? { focusedId } : {}) });
  // The host's answer to worktreeRows, worked out here for every block, so the toggles open in the browser too
  const answers = Object.fromEntries(scan.repos.map((r) => [r.path, worktreeRowsOf(scan, plans, NOW, r.path) ?? []]));
  const vars = Object.entries(THEMES[theme]).map(([k, v]) => `${k}: ${v};`).join(" ");
  const head = `<style nonce="${NONCE}">:root { ${vars} } html { background: ${THEMES[theme]["--vscode-sideBar-background"]}; }</style>`;
  const stub = `<script nonce="${NONCE}">
(() => {
  // In a function: the page script declares its own top-level names
  window.__posts = [];
  let kept = ${asScript(state)};
  const answers = ${asScript(answers)};
  window.acquireVsCodeApi = () => ({ getState: () => kept, setState: (s) => { kept = s; }, postMessage: (m) => {
    window.__posts.push(m);
    if (m && m.type === "worktreeRows" && answers[m.repoPath]) setTimeout(() => window.postMessage({ type: "worktreeRows", repoPath: m.repoPath, rows: answers[m.repoPath] }, "*"), 0);
  } });
  window.addEventListener("load", () => window.postMessage({ type: "model", model: ${asScript(model)} }, "*"));
})();
</script>`;
  let html = pageHtml(NONCE, "");
  html = html.replace("</head>", `${head}</head>`);
  html = html.replace("<body>", `<body${theme === "light" ? ' class="vscode-light"' : ""}>${stub}`);
  return html;
};

// node scripts/panel-preview.ts [folder] [--no-scan]: --no-scan also writes each page without the scan, named -noscan
const args = process.argv.slice(2);
const noScan = args.includes("--no-scan");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(tmpdir(), "questlog-panel-preview"));
mkdirSync(dir, { recursive: true });
for (const seed of Object.keys(SEEDS)) {
  for (const theme of Object.keys(THEMES)) {
    for (const withScan of noScan ? [true, false] : [true]) {
      const file = join(dir, `${seed}-${theme}${withScan ? "" : "-noscan"}.html`);
      writeFileSync(file, page(seed, theme, withScan));
      console.log(file);
    }
  }
}

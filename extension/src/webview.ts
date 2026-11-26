// The sidebar page: CSS from the approved mockup, mapped to VS Code theme variables. The script draws from
// the ViewModel the host posts and never builds markup from strings, so session text cannot inject HTML.

const CSS = `
:root {
  --ink: var(--vscode-foreground); --mute: var(--vscode-descriptionForeground); --faint: color-mix(in srgb, var(--vscode-foreground) 45%, transparent);
  --line: var(--vscode-widget-border, color-mix(in srgb, var(--vscode-foreground) 16%, transparent));
  --surf: color-mix(in srgb, var(--vscode-foreground) 8%, transparent); --surf2: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
  --hover: var(--vscode-list-hoverBackground); --sel: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground));
  --accent: #d1805f; --accent-bg: color-mix(in srgb, #d1805f 24%, transparent); --accent-ink: #d1805f;
  --green: var(--vscode-testing-iconPassed, #4ec27a); --amber: var(--vscode-charts-yellow, #e0a243);
  --red: var(--vscode-charts-red, #e5534b); --blue: var(--vscode-charts-blue, #4a9eed);
  --green-bg: color-mix(in srgb, var(--green) 22%, transparent); --amber-bg: color-mix(in srgb, var(--amber) 22%, transparent);
  --blue-bg: color-mix(in srgb, var(--blue) 22%, transparent);
}
body.vscode-light { --accent: #b9603f; --accent-ink: #8a3f22; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0 0 12px; color: var(--ink); font: 13px/1.4 var(--vscode-font-family); background: transparent; }
button { font: inherit; color: inherit; }
button:focus-visible, .card:focus-visible, .grp:focus-visible, .sec:focus-visible, .step:focus-visible, .endedline:focus-visible, .wt-head:focus-visible, .wt-tog:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
svg { display: block; }
.grow { flex: 1; }
.ib { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 5px; color: var(--mute); border: 0; background: none; cursor: pointer; padding: 0; }
.ib:hover { background: var(--hover); color: var(--ink); }
.chev { width: 16px; height: 16px; display: grid; place-items: center; transition: transform .15s; flex: none; }
[aria-expanded="false"] > .chev { transform: rotate(-90deg); }
.pill { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: var(--surf2); color: var(--mute); }
.pill.blue { background: var(--blue-bg); color: var(--blue); }
.pill.warm { background: var(--accent-bg); color: var(--accent-ink); }
.sec { display: flex; align-items: center; gap: 4px; padding: 10px 10px 6px 12px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); cursor: pointer; user-select: none; }
.grp { display: flex; align-items: center; gap: 4px; padding: 7px 12px 3px; font-weight: 600; cursor: pointer; user-select: none; }
.summary { margin: 8px 12px; padding: 10px 12px; background: var(--surf); border-radius: 10px; }
.s-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.s-top b { font-size: 18px; font-weight: 600; }
.stack { display: flex; height: 6px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--surf2); }
.stack i { display: block; height: 100%; }
.legend { display: flex; gap: 12px; margin-top: 8px; color: var(--mute); font-size: 12px; flex-wrap: wrap; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; background: var(--surf); border-radius: 9px; padding: 3px; margin: 2px 12px 6px; }
.seg button { border: 0; background: none; color: var(--mute); padding: 5px 0; border-radius: 7px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--vscode-sideBar-background); color: var(--ink); box-shadow: 0 0 0 1px var(--line) inset; }
.card { position: relative; display: grid; grid-template-columns: 10px 1fr auto; gap: 3px 10px; align-items: center; padding: 8px 12px; margin: 1px 8px; border-radius: 9px; cursor: pointer; }
.card:hover { background: var(--hover); }
.card.sel { background: var(--sel); }
.card .t { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card.sel .t { font-weight: 600; }
.card .age { grid-column: 3; color: var(--mute); font-size: 12px; font-variant-numeric: tabular-nums; }
.card .acts { grid-column: 3; grid-row: 1; display: none; gap: 2px; justify-self: end; }
.card:hover .age, .card:focus-within .age { display: none; }
.card:hover .acts, .card:focus-within .acts { display: flex; }
.card .nowline { grid-column: 2 / 4; color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .closedline { grid-column: 2 / 4; color: var(--mute); font-size: 12px; overflow-wrap: anywhere; }
.endedline { display: flex; align-items: center; gap: 4px; padding: 5px 12px 5px 16px; color: var(--mute); font-size: 12px; cursor: pointer; user-select: none; }
.endedline:hover { background: var(--hover); }
.card .meta { grid-column: 2 / 4; display: flex; align-items: center; gap: 8px; color: var(--mute); font-size: 12px; min-width: 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); flex: none; }
.dot.g { background: var(--green); } .dot.a { background: var(--amber); } .dot.b { background: var(--blue); } .dot.r { background: var(--red); }
.dot.live { animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--blue) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 6px transparent; } }
@media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }
.steps { display: flex; gap: 3px; }
.steps i { width: 16px; height: 4px; border-radius: 2px; background: var(--surf2); }
.steps i.on { background: var(--accent); }
.steps i.hold { background: var(--amber); }
.chip { font-size: 11px; padding: 1px 7px; border-radius: 5px; background: var(--surf2); color: var(--mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cnt { white-space: nowrap; }
.chip.amber, .chip.blue { flex: none; }
.steps { flex: none; }
.chip.amber { background: var(--amber-bg); color: var(--amber); }
.chip.blue { background: var(--blue-bg); color: var(--blue); }
.caret { display: inline-block; width: 10px; margin-right: 6px; color: var(--faint); transition: transform .15s; }
.card[aria-expanded="true"] .caret { transform: rotate(90deg); }
.stepsx { margin: 0 8px 4px 28px; padding-left: 10px; border-left: 1px solid var(--line); }
.step { padding: 5px 8px; border-radius: 7px; }
.step[data-d] { cursor: pointer; }
.step:hover { background: var(--hover); }
.s-row { display: flex; align-items: center; gap: 8px; }
.s-ic { width: 14px; height: 14px; flex: none; display: grid; place-items: center; }
.s-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step.done .s-t, .step.not.needed .s-t { color: var(--mute); text-decoration: line-through; text-decoration-color: var(--faint); }
.step.now .s-t, .step.needs .s-t { font-weight: 600; }
.s-more { color: var(--faint); font-size: 11px; }
.step.open .s-more { color: var(--accent); }
.detail { display: none; margin: 4px 0 2px 22px; padding: 7px 10px; background: var(--surf); border-radius: 7px; color: var(--mute); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.step.open .detail { display: block; }
.note { display: flex; gap: 8px; align-items: baseline; padding: 3px 22px; color: var(--ink); cursor: pointer; }
.note:hover { background: var(--hover); }
.mline { padding: 2px 22px; color: var(--ink); overflow-wrap: anywhere; }
.mline.sub { color: var(--mute); }
.mline.repo { color: var(--mute); font-size: 12px; display: flex; align-items: center; gap: 4px; padding-left: 2px; }
.mline.plan { display: flex; align-items: center; gap: 4px; padding-left: 22px; font-size: 12px; }
.mline.plan .grow { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mline.more { color: var(--accent); font-size: 12px; }
.mline.tog { cursor: pointer; user-select: none; }
.mline.tog:hover { background: var(--hover); }
.mline.tog:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.mmeta { color: var(--faint); font-size: 11px; white-space: nowrap; flex: none; }
.mstep { padding: 3px 12px 3px 46px; font-size: 12px; color: var(--mute); }
.mdetail { margin: 3px 0 2px 22px; padding: 6px 9px; background: var(--surf); border-radius: 7px; line-height: 1.45; overflow-wrap: anywhere; }
.chip.link { border: 0; cursor: pointer; color: var(--accent); flex: none; }
.divider { height: 1px; background: var(--line); margin: 8px 0 2px; }
.empty { padding: 14px 22px; color: var(--mute); }
.wt-note { padding: 0 14px 6px; color: var(--mute); font-size: 12px; }
.wt-path { padding: 6px 12px 0 30px; color: var(--faint); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-head { display: flex; align-items: baseline; gap: 6px; margin: 2px 8px 0; padding: 5px 4px 4px 14px; border-radius: 7px; color: var(--mute); font-size: 12px; cursor: pointer; user-select: none; }
.wt-head .chev { align-self: flex-start; margin-top: 1px; }
.wt-head b { font-weight: 600; color: var(--ink); flex: none; }
.wt-c { min-width: 0; overflow-wrap: anywhere; }
.wt-head:hover, .wt-tog:hover { background: var(--hover); }
.wt-seq { margin: 0 8px 0 22px; padding: 2px 12px; color: var(--mute); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-seq-n { color: var(--ink); }
.wt-seq-s { margin-left: 10px; }
.wt-seq .dot { display: inline-block; margin-right: 4px; }
.card.wt { margin-left: 22px; padding: 4px 12px; }
.card.wt .age span + span { margin-left: 8px; }
.wt-age { display: inline-block; min-width: 26px; text-align: right; }
.dot.hollow { background: none; box-shadow: inset 0 0 0 1.5px var(--faint); }
.wt-x { margin: 0 8px 4px 54px; padding: 7px 10px; background: var(--surf); border-radius: 7px; color: var(--mute); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.wt-x .why { color: var(--ink); }
.wt-tog { display: flex; align-items: center; gap: 6px; margin: 1px 8px 1px 22px; padding: 4px 12px; border-radius: 7px; color: var(--mute); font-size: 12px; cursor: pointer; user-select: none; }
.wt-tog-l { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-safe { flex: none; border: 0; cursor: pointer; padding: 2px 8px; }
.wt-safe:hover { color: var(--ink); }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
const st = { filter: saved.filter || "all", closed: new Set(saved.closed || []), open: new Set(saved.open || []), seen: new Set(saved.seen || []), model: null };
const persist = () => vscode.setState({ filter: st.filter, closed: [...st.closed], open: [...st.open], seen: [...st.seen] });
const NS = "http://www.w3.org/2000/svg";
const ICONS = {
  chev: "M2 3.5l3 3 3-3",
  open: "M9 3h4v4M13 3L7 9M12 10v3H3V4h3",
  copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
  panel: "M2.5 3h11v10h-11zM2.5 9.5h11",
  resume: "M5 3.5v9l7.5-4.5z",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.8M9.2 7v3.8",
  undo: "M5.5 3L2.5 6l3 3M2.5 6h6.5a3.5 3.5 0 0 1 0 7H6",
  refresh: "M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3",
  check: "M2.5 6.5l2.3 2.3 4.7-5",
  x: "M4 4l8 8M12 4l-8 8",
};
function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", name === "chev" ? 10 : name === "check" ? 12 : 14);
  svg.setAttribute("height", name === "chev" ? 10 : name === "check" ? 12 : 14);
  svg.setAttribute("viewBox", "0 0 " + (name === "chev" ? 10 : name === "check" ? 12 : 16) + " " + (name === "chev" ? 10 : name === "check" ? 12 : 16));
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", name === "check" ? 1.8 : 1.4);
  const p = document.createElementNS(NS, "path"); p.setAttribute("d", ICONS[name]); svg.append(p);
  return svg;
}
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
const post = (m) => vscode.postMessage(m);
const DOT = { here: "b live", run: "g live", wait: "r live", held: "a", idle: "", done: "g", closed: "g" };

function toggle(set, key) { set.has(key) ? set.delete(key) : set.add(key); persist(); draw(); }
// A row opened by default stays that way until the person touches it; after that their choice wins
function flip(key, open) { st.seen.add(key); open ? st.open.delete(key) : st.open.add(key); persist(); draw(); }
function act(title, name, msg) {
  return h("button", { class: "ib", title, "aria-label": title, on: { click: (e) => { e.stopPropagation(); post(msg); } } }, icon(name));
}
function segments(c) {
  const bits = [];
  for (let i = 0; i < c.total; i++) bits.push(h("i", { class: i < c.done ? "on" : i >= c.total - c.held ? "hold" : "" }));
  return h("span", { class: "steps" }, bits);
}
// A step is keyed by its text (plus an occurrence count for repeats), so reordering or inserting steps keeps each one's open state.
function stepKeys(c) {
  const seen = {};
  return c.steps.map((s) => { seen[s.text] = (seen[s.text] || 0) + 1; return "s:" + c.id + "#" + s.text + "#" + seen[s.text]; });
}
function pruneState(m) {
  const live = new Set();
  for (const g of m.groups) { live.add("e:" + g.repo); for (const c of [...g.cards, ...(g.ended || [])]) { live.add("c:" + c.id); for (const k of stepKeys(c)) live.add(k); } }
  // Worktree rows are keyed by path ("w:"), their blocks by the main checkout ("wb:" block, "wm:" show more, "wc:" closable)
  for (const g of m.groups) for (const b of g.worktrees || []) {
    for (const p of ["wb:", "wm:", "wc:"]) live.add(p + b.repoPath);
    for (const r of [...b.rows, ...(wrows[b.repoPath] || [])]) live.add("w:" + r.path);
  }
  const stale = (k) => /^(c|s|e|w|wb|wm|wc):/.test(k) && !live.has(k);
  for (const set of [st.seen, st.open, st.closed]) for (const k of [...set]) if (stale(k)) set.delete(k);
}
const WDOT = { "needs-you": "a", busy: "b", "in-flight": "", orphan: "", closable: "g", missing: "r", unread: "hollow" };
const MAX_WT_ROWS = 10;
// A block's rows past the first ten, and its Closable ones, come on request (worktreeRows): with every row on every
// refresh, 320 worktrees measured 121 KB. Kept by the block's main checkout; asked for again once per new scan.
const wrows = {}, wasked = {};
function fullRows(b) {
  if (!wasked[b.repoPath]) { wasked[b.repoPath] = true; post({ type: "worktreeRows", repoPath: b.repoPath }); }
  return wrows[b.repoPath];
}
function onKey(el) { return (e) => { if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); } }; }
// The row shows r.short, the slug with the repo's name dropped from the front (built in worktrees/view.ts); the tooltip keeps the whole slug
function wtRow(r) {
  const key = "w:" + r.path;
  const expandable = !!(r.reason || r.facts.length);
  const open = expandable && st.open.has(key);
  // Remove is drawn only on a row whose verdict offers it; the host checks the path against the last scan and asks before anything is removed
  const acts = [r.canOpen ? act("Open worktree", "open", { type: "openWorktree", path: r.path }) : null, act("Copy path", "copy", { type: "copyPath", path: r.path }),
    r.canRemove ? act("Remove worktree", "trash", { type: "closeWorktree", path: r.path }) : null];
  const head = h("div", { class: "card wt", tabindex: 0, "aria-expanded": expandable ? String(open) : null, "aria-label": r.slug + ", " + r.label, on: { click: () => { if (expandable) toggle(st.open, key); } } },
    h("span", { class: "dot " + (WDOT[r.verdict] || ""), title: r.label }),
    h("span", { class: "t", title: r.slug }, expandable ? h("span", { class: "caret" }, "\\u203a") : null, r.short),
    h("span", { class: "age" }, r.pr != null ? h("span", {}, "#" + r.pr) : null, r.size ? h("span", {}, r.size) : null, r.age ? h("span", { class: "wt-age" }, r.age) : null),
    h("span", { class: "acts" }, acts));
  head.addEventListener("keydown", onKey(head));
  return [head, open ? h("div", { class: "wt-x" }, r.reason ? h("div", { class: "why" }, r.reason) : null, r.facts.map((f) => h("div", {}, f))) : null];
}
function wtToggle(set, key, open, label, extra) {
  const el = h("div", { class: "wt-tog", tabindex: 0, role: "button", "aria-expanded": String(open), on: { click: () => toggle(set, key) } }, h("span", { class: "chev" }, icon("chev")), h("span", { class: "wt-tog-l" }, label), extra);
  el.addEventListener("keydown", onKey(el));
  return el;
}
// "Remove N safe" names the repo and never a list: the host builds the list from the last scan and shows it before anything is removed
function removeSafe(b) {
  const title = "Remove the " + (b.safe === 1 ? "worktree" : b.safe + " worktrees") + " whose pull request merged and that " + (b.safe === 1 ? "is" : "are") + " clean and pushed. The list is shown first.";
  return h("button", { class: "chip wt-safe", title, on: { click: (e) => { e.stopPropagation(); post({ type: "closeAllSafe", repoPath: b.repoPath }); } } }, "Remove " + b.safe + " safe");
}
const MAX_WT_SEQ = 5;
// One line per sequence: its name, then each step in order as the step's verdict dot and its name. The rows under it are not regrouped.
function wtSeq(s) {
  const whole = s.name + ": " + s.steps.map((x) => x.step + " " + x.label).join(", ");
  return h("div", { class: "wt-seq", title: whole, "aria-label": "Sequence " + whole },
    h("span", { class: "wt-seq-n" }, s.name),
    s.steps.map((x) => h("span", { class: "wt-seq-s" }, h("span", { class: "dot " + (WDOT[x.verdict] || "") }), x.step)));
}
// One scanned repo's worktrees, after its group's cards and before its ended line. The path heads the block only when the group holds two repos of one name.
function wtBlock(b, many) {
  const open = !st.closed.has("wb:" + b.repoPath);
  const out = [many ? h("div", { class: "wt-path", title: b.repoPath }, b.repoPath) : null,
    h("div", { class: "wt-head", tabindex: 0, role: "button", "aria-expanded": String(open), on: { click: () => toggle(st.closed, "wb:" + b.repoPath) } },
      h("span", { class: "chev" }, icon("chev")), h("b", {}, "Worktrees"), h("span", { class: "wt-c" }, b.count))];
  if (!open) return out;
  const seqs = b.sequences || [];
  for (const s of seqs.slice(0, MAX_WT_SEQ)) out.push(wtSeq(s));
  if (seqs.length > MAX_WT_SEQ) out.push(h("div", { class: "wt-seq more" }, "and " + (seqs.length - MAX_WT_SEQ) + " more " + (seqs.length - MAX_WT_SEQ === 1 ? "sequence" : "sequences")));
  const all = b.more > 0 && st.open.has("wm:" + b.repoPath), shown = b.closable > 0 && st.open.has("wc:" + b.repoPath);
  // Until the rows arrive, an opened toggle shows the rows the model already holds
  const full = all || shown ? fullRows(b) : undefined;
  const rest = all && full ? full.filter((r) => r.verdict !== "closable") : b.rows;
  for (const r of rest) out.push(...wtRow(r));
  if (b.more > 0) out.push(wtToggle(st.open, "wm:" + b.repoPath, all, all ? "Show fewer" : "Show " + b.more + " more"));
  if (b.closable > 0) {
    out.push(wtToggle(st.open, "wc:" + b.repoPath, shown, b.closable + " closable", b.safe > 0 ? removeSafe(b) : null));
    if (shown && full) for (const r of full.filter((x) => x.verdict === "closable")) out.push(...wtRow(r));
  }
  return out;
}
// A step's link (its pull request, say): the host opens it in the browser, and only an http or https address
function linkChip(s) {
  return s.link ? h("button", { class: "chip link", title: s.link, on: { click: (e) => { e.stopPropagation(); post({ type: "openLink", url: s.link }); } } }, "Open link") : null;
}
// The steps of the plans opened under "This month", by session id, and the ids already asked for
const msteps = {}, masked = {};
// One repo of "This month": its line, then (opened) the plans it finished, each opening to its steps
function monthRepo(r) {
  const key = "mr:" + r.repo, has = r.plans.length > 0, open = has && st.open.has(key);
  const out = [h("div", { class: "mline repo" + (has ? " tog" : ""), tabindex: has ? 0 : null, role: has ? "button" : null, "aria-expanded": has ? String(open) : null, on: { click: () => { if (has) toggle(st.open, key); } } },
    h("span", { class: "chev" }, has ? icon("chev") : null), h("span", { class: "grow" }, r.line))];
  if (!open) return out;
  for (const p of r.plans) {
    const pk = "mp:" + r.repo + ":" + p.id, ps = p.hasSteps, po = ps && st.open.has(pk);
    // Steps come on request, once per plan: with every model they measured 760 KB a refresh on a busy month
    if (po && !msteps[p.id] && !masked[p.id]) { masked[p.id] = true; post({ type: "monthSteps", id: p.id }); }
    out.push(h("div", { class: "mline plan" + (ps ? " tog" : ""), tabindex: ps ? 0 : null, role: ps ? "button" : null, "aria-expanded": ps ? String(po) : null, on: { click: () => { if (ps) toggle(st.open, pk); } } },
      h("span", { class: "chev" }, ps ? icon("chev") : null), h("span", { class: "grow", title: p.title }, p.title), h("span", { class: "mmeta" }, p.meta)));
    if (po) for (const s of msteps[p.id] || []) {
      const mark = h("span", { class: "s-ic", style: s.status === "done" ? "color:var(--green)" : "color:var(--faint)" });
      mark.append(s.status === "done" ? icon("check") : s.status === "not needed" ? icon("x") : h("span", { class: "dot" }));
      out.push(h("div", { class: "mstep" }, h("div", { class: "s-row" }, mark, h("span", { class: "s-t", title: s.text }, s.text), linkChip(s)), s.detail ? h("div", { class: "mdetail" }, s.detail) : null));
    }
  }
  return out;
}
function stepRow(c, s, key) {
  // A step a close said was not needed opens on its reason
  const open = st.seen.has(key) ? st.open.has(key) : !!(((s.status === "now" && c.kind === "session") || s.status === "not needed") && s.detail);
  const mark = s.status === "done" ? (() => { const w = h("span", { style: "color:var(--green)" }); w.append(icon("check")); return w; })()
    : s.status === "now" ? h("span", { class: "dot b live" })
    : s.status === "blocked" ? h("span", { class: "dot r", title: "Blocked" })
    : s.status === "needs" ? h("span", { class: "dot a", title: "Needs you" })
    : s.status === "not needed" ? (() => { const w = h("span", { style: "color:var(--faint)" }); w.append(icon("x")); return w; })()
    : (() => { const w = h("span", { style: "color:var(--faint)" }); const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", 12); svg.setAttribute("height", 12); svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", 1.4); const ci = document.createElementNS(NS, "circle"); ci.setAttribute("cx", 6); ci.setAttribute("cy", 6); ci.setAttribute("r", 4); svg.append(ci); w.append(svg); return w; })();
  return h("div", {
    class: "step " + s.status + (open ? " open" : ""), "data-d": s.detail ? true : null, tabindex: s.detail ? 0 : null,
    on: { click: () => { if (s.detail) flip(key, open); else if (s.resume) post({ type: "copyResume", text: s.resume }); } },
  },
    h("div", { class: "s-row" }, h("span", { class: "s-ic" }, mark), h("span", { class: "s-t", title: s.text }, s.text), linkChip(s), s.status === "not needed" ? h("span", { class: "s-more" }, "Not needed") : s.detail ? h("span", { class: "s-more" }, "Details") : null),
    s.detail ? h("div", { class: "detail" }, s.detail, s.resume || s.worktree ? h("div", { style: "margin-top:6px;display:flex;gap:6px" }, s.resume ? h("button", { class: "chip", on: { click: (e) => { e.stopPropagation(); post({ type: "copyResume", text: s.resume }); } } }, "Copy resume") : null, s.worktree ? h("button", { class: "chip", on: { click: (e) => { e.stopPropagation(); post({ type: "openWorktree", path: s.worktree }); } } }, "Open worktree") : null) : null) : null);
}
function card(c) {
  const expandable = c.steps.length > 0;
  const ckey = "c:" + c.id;
  const expanded = expandable && (st.seen.has(ckey) ? st.open.has(ckey) : c.open);
  const acts = c.kind === "session"
    ? [act("Open details", "open", { type: "details", id: c.id }), act("Copy session ID", "copy", { type: "copyId", id: c.id }), ...(c.canResume ? [act("Reopen session", "resume", { type: "copySessionResume", id: c.id })] : []), ...(c.closedBy ? [act("Undo close", "undo", { type: "undoClose", id: c.id })] : c.total > 0 && c.done < c.total ? [act("Close", "check", { type: "close", id: c.id })] : []), act("Show or hide Questlog panel", "panel", { type: "pane", id: c.id }), act("Hide this session", "x", { type: "dismiss", id: c.id })]
    : [];
  const meta = c.total > 0
    ? [segments(c), h("span", { class: "cnt" }, c.done + " of " + c.total), c.held ? h("span", { class: "chip amber" }, c.held + " held") : null, c.state === "here" ? h("span", { class: "chip blue" }, "this tab") : null, c.where ? h("span", { class: "chip", title: c.where }, c.where) : null]
    : [c.state === "here" ? h("span", { class: "chip blue" }, "this tab") : null, c.where ? h("span", { class: "chip", title: c.where }, c.where) : null];
  const head = h("div", {
    class: "card" + (c.state === "here" ? " sel" : ""), tabindex: 0, "aria-expanded": expandable ? String(expanded) : null,
    on: { click: () => { if (expandable) flip(ckey, expanded); else if (c.kind === "session") post({ type: "details", id: c.id }); },
      keydown: (e) => { if (e.target === head && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); head.click(); } } },
  },
    h("span", { class: "dot " + DOT[c.state] }),
    h("span", { class: "t", title: c.title }, expandable ? h("span", { class: "caret" }, "\\u203a") : null, c.title),
    h("span", { class: "age" }, c.age),
    h("span", { class: "acts" }, acts),
    h("span", { class: "meta" }, meta),
    c.closedBy ? h("span", { class: "closedline" }, "Closed by " + c.closedBy.tag + (c.closedBy.plan ? " " + c.closedBy.plan : "") + (c.closedBy.evidence ? ": " + c.closedBy.evidence : "")) : null,
    !expanded && c.now ? h("span", { class: "nowline", title: c.now }, "\\u2192 " + c.now) : null);
  return [head, expanded ? h("div", { class: "stepsx" }, stepKeys(c).map((key, i) => stepRow(c, c.steps[i], key))) : null];
}
const FOCUSABLE = "[tabindex],button";
function sigOf(el) {
  const box = el.closest(".card,.grp,.sec,.step,.wt-head,.wt-tog");
  const label = box ? (box.querySelector(".t,.s-t,.grow") || box).textContent.slice(0, 80) : "";
  return el.className + "|" + (el.title || "") + "|" + (box ? "" : el.textContent.slice(0, 20)) + "|" + label;
}
// The model is re-posted on every tick and file change, so a redraw would drop keyboard focus: remember which control had it and focus its twin.
function draw() {
  const root = document.getElementById("root"), a = document.activeElement;
  let key = null;
  if (a && root.contains(a)) { const sig = sigOf(a); key = { sig, n: [...root.querySelectorAll(FOCUSABLE)].filter((x) => sigOf(x) === sig).indexOf(a) }; }
  render();
  if (!key) return;
  const hits = [...root.querySelectorAll(FOCUSABLE)].filter((x) => sigOf(x) === key.sig);
  const target = hits[key.n] || hits[0];
  if (target) target.focus({ preventScroll: true });
}
function render() {
  const m = st.model; if (!m) return;
  const f = st.filter;
  const keep = (c) => f === "all" || (f === "active" ? c.state === "run" || c.state === "here" || c.state === "wait" : c.state === "held");
  const s = m.summary, total = Math.max(1, s.sessions);
  const root = document.getElementById("root"); root.replaceChildren();
  const seg = (n, color) => n > 0 ? h("i", { style: "width:" + (n / total * 100) + "%;background:" + color }) : null;
  const leg = (n, cls, label) => n > 0 ? h("span", {}, h("span", { class: "dot " + cls }), label + " " + n) : null;
  root.append(h("div", { class: "summary" },
    h("div", { class: "s-top" }, h("span", {}, h("b", {}, s.sessions), s.sessions === 1 ? " session" : " sessions"), s.here ? h("span", { class: "pill blue" }, s.here + " here") : null),
    h("div", { class: "stack" }, seg(s.here, "var(--blue)"), seg(s.running, "var(--green)"), seg(s.waiting, "var(--red)"), seg(s.held, "var(--amber)"), h("i", { style: "flex:1;background:var(--surf2)" })),
    h("div", { class: "legend" }, leg(s.here, "b", "here"), leg(s.running, "g", "running"), leg(s.waiting, "r", "needs you"), leg(s.held, "a", "unfinished"), leg(s.idle, "", "idle"))));
  root.append(h("div", { class: "seg", role: "group", "aria-label": "Filter" },
    ["all", "active", "held"].map((k) => h("button", { "aria-pressed": String(f === k), on: { click: () => { st.filter = k; persist(); draw(); } } }, k === "held" ? "Unfinished" : k[0].toUpperCase() + k.slice(1)))));
  if (m.worktreeNote) root.append(h("div", { class: "wt-note" }, m.worktreeNote));
  if (m.note.length > 0) {
    const open = !st.closed.has("note");
    root.append(h("div", { class: "sec", tabindex: 0, role: "button", "aria-expanded": String(open), on: { click: () => toggle(st.closed, "note") } },
      h("span", { class: "chev" }, icon("chev")), "Restart note", h("span", { class: "grow" }), h("span", { class: "pill warm" }, m.note.length)));
    if (open) for (const line of m.note) root.append(h("div", { class: "note", title: line, on: { click: () => post({ type: "openNote" }) } }, h("span", { class: "dot a" }), h("span", {}, line)));
    root.append(h("div", { class: "divider" }));
  }
  let shown = 0;
  for (const g of m.groups) {
    const cards = g.cards.filter(keep);
    const ended = f === "active" ? [] : (g.ended || []);
    if (cards.length === 0 && ended.length === 0 && f !== "all") continue;
    // Active and Unfinished filter sessions: the worktree blocks show under All only
    const blocks = f === "all" ? g.worktrees || [] : [];
    const open = !st.closed.has("g:" + g.repo);
    root.append(h("div", { class: "grp", tabindex: 0, role: "button", "aria-expanded": String(open), on: { click: () => toggle(st.closed, "g:" + g.repo) } },
      h("span", { class: "chev" }, icon("chev")), h("span", { class: "grow" }, g.repo), cards.length ? h("span", { class: "pill" }, cards.length) : blocks.length ? null : h("span", { class: "chip" }, "no live session")));
    shown += cards.length + ended.length + blocks.length;
    if (open) for (const c of cards) root.append(...card(c).filter(Boolean));
    // The worktree blocks sit after the session cards and before the ended line
    if (open) for (const b of blocks) root.append(...wtBlock(b, blocks.length > 1).filter(Boolean));
    if (open && ended.length > 0) {
      const key = "e:" + g.repo, out = st.open.has(key);
      root.append(h("div", { class: "endedline", tabindex: 0, role: "button", "aria-expanded": String(out), on: { click: () => toggle(st.open, key) } }, h("span", { class: "chev" }, icon("chev")), ended.length + (ended.length === 1 ? " tab" : " tabs") + " closed with steps left"));
      if (out) for (const c of ended) root.append(...card(c).filter(Boolean));
    }
  }
  if (shown === 0) root.append(h("div", { class: "empty" }, m.groups.length === 0 ? "No live Claude Code sessions recorded. A session appears here once it calls the questlog tool (the questlog mod adds it)." : "Nothing here right now."));
  // The same lines /questlog-stats prints (mod/hooks/stats.ts), after the live sessions
  const mo = m.month;
  if (mo) {
    const open = !st.closed.has("month");
    root.append(h("div", { class: "divider" }));
    root.append(h("div", { class: "sec", tabindex: 0, role: "button", "aria-expanded": String(open), on: { click: () => toggle(st.closed, "month") } },
      h("span", { class: "chev" }, icon("chev")), "This month", h("span", { class: "grow" }), h("span", { class: "pill" }, mo.sessions)));
    if (open) {
      root.append(h("div", { class: "mline" }, mo.head));
      for (const l of mo.lines) root.append(h("div", { class: "mline sub" }, l));
      // Five repos, most sessions first; the rest wait behind one line
      const more = mo.repos.length > 5, all = st.open.has("m:more");
      for (const r of more && !all ? mo.repos.slice(0, 5) : mo.repos) root.append(...monthRepo(r));
      if (more) root.append(h("div", { class: "mline more tog", tabindex: 0, role: "button", on: { click: () => toggle(st.open, "m:more") } }, all ? "Show the top 5 repos" : (mo.repos.length - 5) + " more " + (mo.repos.length - 5 === 1 ? "repo" : "repos")));
    }
  }
}
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "model") {
    // A new scan: the rows already held stay on show until the fresh ones arrive, and each open block asks once more
    if (!st.model || st.model.worktreeScanAt !== e.data.model.worktreeScanAt) for (const k of Object.keys(wasked)) delete wasked[k];
    st.model = e.data.model; pruneState(st.model); draw();
  }
  else if (e.data && e.data.type === "worktreeRows" && typeof e.data.repoPath === "string" && Array.isArray(e.data.rows)) { wrows[e.data.repoPath] = e.data.rows; if (st.model) draw(); }
  else if (e.data && e.data.type === "monthSteps" && typeof e.data.id === "string" && Array.isArray(e.data.steps)) { msteps[e.data.id] = e.data.steps; if (st.model) draw(); }
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".grp, .sec, .step, .endedline, .mline.tog, .wt-head, .wt-tog")){ e.preventDefault(); e.target.click(); } });
post({ type: "ready" });
`;

export const pageHtml = (nonce: string, cspSource: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${CSS}</style></head><body><div id="root"></div><script nonce="${nonce}">${SCRIPT}</script></body></html>`;

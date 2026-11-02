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
button:focus-visible, .card:focus-visible, .grp:focus-visible, .sec:focus-visible, .step:focus-visible, .endedline:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
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
.step.done .s-t { color: var(--mute); text-decoration: line-through; text-decoration-color: var(--faint); }
.step.now .s-t { font-weight: 600; }
.s-more { color: var(--faint); font-size: 11px; }
.step.open .s-more { color: var(--accent); }
.detail { display: none; margin: 4px 0 2px 22px; padding: 7px 10px; background: var(--surf); border-radius: 7px; color: var(--mute); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.step.open .detail { display: block; }
.note { display: flex; gap: 8px; align-items: baseline; padding: 3px 22px; color: var(--ink); cursor: pointer; }
.note:hover { background: var(--hover); }
.divider { height: 1px; background: var(--line); margin: 8px 0 2px; }
.empty { padding: 14px 22px; color: var(--mute); }
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
  for (const g of m.groups) for (const c of [...g.cards, ...(g.ended || [])]) { live.add("c:" + c.id); for (const k of stepKeys(c)) live.add(k); }
  const stale = (k) => (k.startsWith("c:") || k.startsWith("s:")) && !live.has(k);
  for (const set of [st.seen, st.open]) for (const k of [...set]) if (stale(k)) set.delete(k);
}
function stepRow(c, s, key) {
  const open = st.seen.has(key) ? st.open.has(key) : !!(s.status === "now" && s.detail && c.kind === "session");
  const mark = s.status === "done" ? (() => { const w = h("span", { style: "color:var(--green)" }); w.append(icon("check")); return w; })()
    : s.status === "now" ? h("span", { class: "dot b live" })
    : s.status === "blocked" ? h("span", { class: "dot r", title: "Blocked" })
    : (() => { const w = h("span", { style: "color:var(--faint)" }); const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", 12); svg.setAttribute("height", 12); svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", 1.4); const ci = document.createElementNS(NS, "circle"); ci.setAttribute("cx", 6); ci.setAttribute("cy", 6); ci.setAttribute("r", 4); svg.append(ci); w.append(svg); return w; })();
  return h("div", {
    class: "step " + s.status + (open ? " open" : ""), "data-d": s.detail ? true : null, tabindex: s.detail ? 0 : null,
    on: { click: () => { if (s.detail) flip(key, open); else if (s.resume) post({ type: "copyResume", text: s.resume }); } },
  },
    h("div", { class: "s-row" }, h("span", { class: "s-ic" }, mark), h("span", { class: "s-t", title: s.text }, s.text), s.detail ? h("span", { class: "s-more" }, "Details") : null),
    s.detail ? h("div", { class: "detail" }, s.detail, s.resume ? h("div", { style: "margin-top:6px;display:flex;gap:6px" }, h("button", { class: "chip", on: { click: (e) => { e.stopPropagation(); post({ type: "copyResume", text: s.resume }); } } }, "Copy resume"), s.worktree ? h("button", { class: "chip", on: { click: (e) => { e.stopPropagation(); post({ type: "openWorktree", path: s.worktree }); } } }, "Open worktree") : null) : null) : null);
}
function card(c) {
  const expandable = c.steps.length > 0;
  const ckey = "c:" + c.id;
  const expanded = expandable && (st.seen.has(ckey) ? st.open.has(ckey) : c.open);
  const acts = c.kind === "session"
    ? [act("Open details", "open", { type: "details", id: c.id }), act("Copy session ID", "copy", { type: "copyId", id: c.id }), ...(c.canResume ? [act("Reopen session", "resume", { type: "copySessionResume", id: c.id })] : []), ...(c.closedBy ? [act("Undo close", "undo", { type: "undoClose", id: c.id })] : []), act("Show or hide Questlog panel", "panel", { type: "pane", id: c.id }), act("Hide this session", "x", { type: "dismiss", id: c.id })]
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
    c.closedBy ? h("span", { class: "closedline" }, "Closed by " + c.closedBy.tag + " " + c.closedBy.plan + ": " + c.closedBy.evidence) : null,
    !expanded && c.now ? h("span", { class: "nowline", title: c.now }, "\\u2192 " + c.now) : null);
  return [head, expanded ? h("div", { class: "stepsx" }, stepKeys(c).map((key, i) => stepRow(c, c.steps[i], key))) : null];
}
const FOCUSABLE = "[tabindex],button";
function sigOf(el) {
  const box = el.closest(".card,.grp,.sec,.step");
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
    const open = !st.closed.has("g:" + g.repo);
    root.append(h("div", { class: "grp", tabindex: 0, role: "button", "aria-expanded": String(open), on: { click: () => toggle(st.closed, "g:" + g.repo) } },
      h("span", { class: "chev" }, icon("chev")), h("span", { class: "grow" }, g.repo), cards.length ? h("span", { class: "pill" }, cards.length) : h("span", { class: "chip" }, "no live session")));
    shown += cards.length + ended.length;
    if (open) for (const c of cards) root.append(...card(c).filter(Boolean));
    if (open && ended.length > 0) {
      const key = "e:" + g.repo, out = st.open.has(key);
      root.append(h("div", { class: "endedline", tabindex: 0, role: "button", "aria-expanded": String(out), on: { click: () => toggle(st.open, key) } }, h("span", { class: "chev" }, icon("chev")), ended.length + " closed with steps left"));
      if (out) for (const c of ended) root.append(...card(c).filter(Boolean));
    }
  }
  if (shown === 0) root.append(h("div", { class: "empty" }, m.groups.length === 0 ? "No live Claude Code sessions recorded. A session appears here once it calls the questlog tool (the questlog mod adds it)." : "Nothing here right now."));
}
window.addEventListener("message", (e) => { if (e.data && e.data.type === "model") { st.model = e.data.model; pruneState(st.model); draw(); } });
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".grp, .sec, .step, .endedline")) { e.preventDefault(); e.target.click(); } });
post({ type: "ready" });
`;

export const pageHtml = (nonce: string, cspSource: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${CSS}</style></head><body><div id="root"></div><script nonce="${nonce}">${SCRIPT}</script></body></html>`;

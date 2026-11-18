import "./style.css";
import bundleJson from "./generated/bundle.json";
import { createEditor, type Editor } from "./editor.ts";
import { formatClientFailure, formatFeedback, formatProgress, type Feedback } from "./lib/feedback.ts";
import { parseCsv, variableName } from "./lib/csv.ts";
import { renderInline, renderMarkdown } from "./lib/markdown.ts";
import { createStore } from "./lib/storage.ts";
import type { Bundle, Exercise, RunMode } from "./lib/types.ts";
import { Runner, type EngineState } from "./runner.ts";
import { PROGRESS_ESTIMATE_BYTES, TIME_LIMIT_MS } from "./config.ts";

const bundle = bundleJson as unknown as Bundle;
const store = createStore();
const progress = store.load();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  list: $("exercise-list"),
  nav: $("exercise-nav"),
  navToggle: $("nav-toggle"),
  count: $("progress-count"),
  meta: $("ex-meta"),
  title: $("ex-title"),
  prompt: $("ex-prompt"),
  vars: $("ex-vars"),
  run: $<HTMLButtonElement>("run"),
  check: $<HTMLButtonElement>("check"),
  resetCode: $("reset-code"),
  badge: $("done-badge"),
  output: $("output"),
  data: $("data-preview"),
  engine: $("engine"),
  engineText: $("engine-text"),
  engineBar: $<HTMLProgressElement>("engine-bar"),
  engineInfo: $("engine-info"),
  main: $("main"),
};

let current: Exercise = bundle.exercises[0]!;
let editor: Editor;
let busy = false;
let engineReady = false;

// ---------- engine (Pyodide worker) ----------

function onEngine(s: EngineState) {
  if (s.kind === "loading") {
    engineReady = false;
    els.engine.hidden = false;
    els.engine.classList.remove("failed");
    const p = formatProgress(s.loaded, PROGRESS_ESTIMATE_BYTES);
    els.engineBar.hidden = false;
    els.engineBar.value = p.percent;
    els.engineText.textContent =
      s.loaded > 0
        ? `Getting Python and pandas ready: ${p.label}. The first visit is the slow one; after that it is cached.`
        : "Getting Python ready...";
  } else if (s.kind === "restarting") {
    engineReady = false;
    els.engine.hidden = false;
    els.engineBar.hidden = true;
    els.engineText.textContent = "Restarting Python after the stopped run...";
  } else if (s.kind === "ready") {
    engineReady = true;
    els.engine.hidden = true;
    els.engineInfo.textContent = `${s.info}. Runs in your browser.`;
    els.engineInfo.dataset.transferredBytes = String(s.transferred);
  } else if (s.kind === "stale") {
    engineReady = false;
    els.engine.hidden = false;
    els.engine.classList.add("failed");
    els.engineBar.hidden = true;
    els.engineText.textContent = "A new version is available, reload the page. ";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    els.engineText.append(btn);
  } else {
    engineReady = false;
    els.engine.hidden = false;
    els.engine.classList.add("failed");
    els.engineBar.hidden = true;
    els.engineText.textContent = `Python could not start (${s.message}). Check your connection and reload the page.`;
  }
  refreshButtons();
}

function sendUrlsToServiceWorker(urls: string[]) {
  els.engineInfo.dataset.files = String(urls.length);
  els.engineInfo.dataset.urls = JSON.stringify(urls);
  navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage({ type: "cache-urls", urls })).catch(() => undefined);
}

const runner = new Runner(onEngine, sendUrlsToServiceWorker);

function refreshButtons() {
  const off = busy || !engineReady;
  els.run.disabled = off;
  els.check.disabled = off;
  els.run.textContent = busy ? "Running..." : "Run";
}

// ---------- navigation list ----------

function renderList() {
  els.list.textContent = "";
  for (const ex of bundle.exercises) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#/${ex.id}`;
    const done = !!progress.done[ex.id];
    a.className = (done ? "done " : "") + (ex.id === current.id ? "current" : "");
    if (ex.id === current.id) a.setAttribute("aria-current", "page");
    const num = ex.id.slice(0, 2);
    a.innerHTML = `<span class="tick" aria-hidden="true">${done ? "&#10003;" : num}</span><span class="label">${renderInline(ex.title)}<small>${renderInline(ex.topic)} &middot; ${ex.difficulty}${done ? " &middot; done" : ""}</small></span>`;
    li.append(a);
    els.list.append(li);
  }
  const n = bundle.exercises.filter((e) => progress.done[e.id]).length;
  els.count.textContent = `${n}/${bundle.exercises.length} done`;
}

// ---------- data preview ----------

function renderData(ex: Exercise) {
  els.data.textContent = "";
  ex.data.forEach((file, i) => {
    const rows = parseCsv(bundle.data[file] ?? "");
    const [head = [], ...body] = rows;
    const det = document.createElement("details");
    det.open = i === 0;
    const sum = document.createElement("summary");
    sum.innerHTML = `<code>${variableName(file)}</code> &mdash; ${body.length} rows, ${head.length} columns`;
    det.append(sum);
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", `First rows of ${variableName(file)}`);
    const table = document.createElement("table");
    const thead = table.createTHead().insertRow();
    for (const h of head) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      thead.append(th);
    }
    const tb = table.createTBody();
    for (const r of body.slice(0, 6)) {
      const tr = tb.insertRow();
      for (const c of r) tr.insertCell().textContent = c === "" ? "NaN" : c;
    }
    wrap.append(table);
    det.append(wrap);
    if (body.length > 6) {
      const more = document.createElement("p");
      more.className = "muted small";
      more.textContent = `Showing the first 6 of ${body.length} rows. Empty cells show as NaN (missing).`;
      det.append(more);
    }
    els.data.append(det);
  });
}

// ---------- output panel ----------

function showFeedback(fb: Feedback) {
  els.output.textContent = "";
  const box = document.createElement("div");
  box.className = `fb ${fb.tone}`;
  const h = document.createElement("p");
  h.className = "fb-title";
  h.innerHTML = renderInline(fb.title);
  box.append(h);
  for (const l of fb.lines) {
    const p = document.createElement("p");
    p.innerHTML = renderInline(l);
    box.append(p);
  }
  if (fb.code) {
    const pre = document.createElement("pre");
    pre.textContent = fb.code;
    box.append(pre);
  }
  els.output.append(box);
  if (fb.stdout.trim()) {
    const t = document.createElement("p");
    t.className = "sub";
    t.textContent = "Your print output";
    const pre = document.createElement("pre");
    pre.className = "stdout";
    pre.textContent = fb.stdout;
    els.output.append(t, pre);
  }
  if (fb.preview) {
    const t = document.createElement("p");
    t.className = "sub";
    t.textContent = "Your result";
    const pre = document.createElement("pre");
    pre.className = "preview";
    pre.tabIndex = 0;
    pre.textContent = fb.preview;
    els.output.append(t, pre);
  }
  if (fb.tone === "pass") {
    const idx = bundle.exercises.findIndex((e) => e.id === current.id);
    const next = bundle.exercises[idx + 1];
    if (next) {
      const a = document.createElement("a");
      a.className = "btn primary next";
      a.href = `#/${next.id}`;
      a.textContent = `Next: ${next.title}`;
      els.output.append(a);
    }
  }
}

// ---------- running ----------

async function go(mode: RunMode) {
  if (busy || !engineReady) return;
  busy = true;
  refreshButtons();
  els.output.setAttribute("aria-busy", "true");
  const out = await runner.run({
    mode,
    code: editor.getCode(),
    data: Object.fromEntries(current.data.map((f) => [f, bundle.data[f] ?? ""])),
    solution: current.solution,
    check: current.check,
  });
  busy = false;
  els.output.removeAttribute("aria-busy");
  if (out.ok) {
    showFeedback(formatFeedback(out.result, mode));
    if (mode === "check" && out.result.passed) markDone(current.id);
  } else {
    showFeedback(formatClientFailure(out.failure, TIME_LIMIT_MS / 1000));
  }
  refreshButtons();
}

function markDone(id: string) {
  progress.done[id] = true;
  store.save(progress);
  renderList();
  els.badge.hidden = false;
}

// ---------- selecting an exercise ----------

function idFromHash(): string | undefined {
  const m = /^#\/(.+)$/.exec(location.hash);
  return m?.[1] && bundle.exercises.some((e) => e.id === m[1]) ? m[1] : undefined;
}

function open(ex: Exercise) {
  current = ex;
  progress.last = ex.id;
  store.save(progress);
  els.meta.textContent = `Exercise ${ex.id.slice(0, 2)} of ${bundle.exercises.length} · ${ex.topic} · ${ex.difficulty}`;
  els.title.textContent = ex.title;
  els.prompt.innerHTML = renderMarkdown(ex.prompt);
  els.vars.innerHTML =
    "Loaded for you as DataFrames: " + ex.data.map((f) => `<code>${variableName(f)}</code>`).join(", ") + ". Leave your answer in a variable called <code>result</code>.";
  els.badge.hidden = !progress.done[ex.id];
  editor.setCode(progress.drafts[ex.id] ?? ex.starter);
  els.output.innerHTML = '<p class="muted">Press Run to see your result, or Check to compare it with the expected answer.</p>';
  renderData(ex);
  renderList();
  els.nav.classList.remove("open");
  els.navToggle.setAttribute("aria-expanded", "false");
  document.title = `${ex.title} - pandas drills`;
}

editor = createEditor($("editor-host"), {
  doc: "",
  onChange: (code) => {
    progress.drafts[current.id] = code;
    store.save(progress);
  },
  onRun: () => void go("run"),
  onCheck: () => void go("check"),
});

window.addEventListener("hashchange", () => {
  const id = idFromHash();
  const ex = bundle.exercises.find((e) => e.id === id);
  if (ex && ex.id !== current.id) {
    open(ex);
    els.main.focus({ preventScroll: false });
    window.scrollTo({ top: 0 });
  }
});
els.run.addEventListener("click", () => void go("run"));
els.check.addEventListener("click", () => void go("check"));
els.resetCode.addEventListener("click", () => {
  delete progress.drafts[current.id];
  store.save(progress);
  editor.setCode(current.starter);
  editor.focus();
});
els.navToggle.addEventListener("click", () => {
  const open = els.nav.classList.toggle("open");
  els.navToggle.setAttribute("aria-expanded", String(open));
});
$("reset").addEventListener("click", () => {
  if (!confirm("Forget which exercises you finished and your saved code on this device?")) return;
  progress.done = {};
  progress.drafts = {};
  store.save(progress);
  open(current);
});

const start = bundle.exercises.find((e) => e.id === idFromHash()) ?? bundle.exercises.find((e) => e.id === progress.last) ?? bundle.exercises[0]!;
open(start);
refreshButtons();

// ---------- offline cache ----------

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
}

// The teacher dashboard: heatmap, per-exercise numbers, stuck students, same-code hints and CSV export.
// It only draws a Report. The same code serves a real class and the demo class.
import type { Report, ReportCell } from "./lib/api.ts";
import { cellLabel, cellState, cellText, exerciseName, exerciseStats, resultsCsv, sameCodeGroups, STATE_INFO, studentCount, stuckStudents, type CellState } from "./lib/dashboard.ts";
import { kindLabel } from "./lib/kinds.ts";
import { el } from "./dom.ts";

export interface DashboardOptions {
  report: Report;
  /** Called when a heatmap cell is chosen. The caller fills `detail`. */
  onCell: (studentId: string, nickname: string, exerciseId: string, cell: ReportCell | undefined) => void;
  /** Where the caller shows the attempt list, placed right under the heatmap. */
  detail: HTMLElement;
  /** Used in the downloaded file name. */
  fileStem: string;
}

function legend(): HTMLElement {
  const items = (["first", "several", "open", "none"] as CellState[]).map((s) =>
    el("li", {}, el("span", { class: `cell sample ${s}`, ariaHidden: "true" }, s === "several" ? `${STATE_INFO[s].symbol} 3` : s === "open" ? `${STATE_INFO[s].symbol} 4` : STATE_INFO[s].symbol), ` ${STATE_INFO[s].long}`),
  );
  const list = el("ul", { class: "legend" }, ...items);
  list.setAttribute("aria-label", "What the cells mean");
  return list;
}

function heatmap(opts: DashboardOptions): HTMLElement {
  const { report } = opts;
  const wrap = el("div", { class: "table-wrap heatmap-wrap", tabIndex: 0 });
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Heatmap of students and exercises. Scroll sideways to see every exercise.");
  const table = el("table", { class: "results heatmap" });
  const head = table.createTHead().insertRow();
  head.append(el("th", { scope: "col", class: "corner" }, "Student"));
  for (const id of report.exercises) {
    const th = el("th", { scope: "col", title: exerciseName(id) }, id.slice(0, 2));
    th.setAttribute("aria-label", `Exercise ${exerciseName(id)}`);
    head.append(th);
  }
  const body = table.createTBody();
  const buttons: HTMLButtonElement[][] = [];
  report.students.forEach((s, r) => {
    const tr = body.insertRow();
    tr.append(el("th", { scope: "row" }, s.nickname));
    buttons[r] = [];
    report.exercises.forEach((ex, c) => {
      const cell = s.results[ex];
      const state = cellState(cell);
      const label = cellLabel(s.nickname, ex, cell);
      const btn = el("button", { type: "button", class: `cell ${state}` }, cellText(cell));
      btn.setAttribute("aria-label", state === "none" ? label : `${label} Show the attempts.`);
      btn.title = label;
      btn.tabIndex = r === 0 && c === 0 ? 0 : -1;
      btn.addEventListener("click", () => opts.onCell(s.id, s.nickname, ex, cell));
      buttons[r]![c] = btn;
      tr.insertCell().append(btn);
    });
  });
  // one tab stop for the whole grid, arrow keys move inside it
  const focusAt = (r: number, c: number) => {
    const target = buttons[r]?.[c];
    if (!target) return;
    for (const row of buttons) for (const b of row) b.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  };
  table.addEventListener("keydown", (e) => {
    const from = (e.target as HTMLElement).closest("button.cell");
    if (!from) return;
    let r = -1;
    let c = -1;
    buttons.forEach((row, i) => row.forEach((b, j) => b === from && ((r = i), (c = j))));
    const last = report.exercises.length - 1;
    const moves: Record<string, [number, number]> = { ArrowRight: [r, c + 1], ArrowLeft: [r, c - 1], ArrowDown: [r + 1, c], ArrowUp: [r - 1, c], Home: [r, 0], End: [r, last] };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    focusAt(to[0], to[1]);
  });
  table.addEventListener("focusin", (e) => {
    const t = (e.target as HTMLElement).closest("button.cell") as HTMLButtonElement | null;
    if (!t) return;
    for (const row of buttons) for (const b of row) b.tabIndex = b === t ? 0 : -1;
  });
  wrap.append(table);
  return wrap;
}

function exerciseTable(report: Report): HTMLElement {
  const wrap = el("div", { class: "table-wrap", tabIndex: 0 });
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Results for each exercise");
  const table = el("table", { class: "by-exercise" });
  const head = table.createTHead().insertRow();
  for (const h of ["Exercise", "Passed / tried", "Pass rate", "Most common problems (by students)"]) head.append(el("th", { scope: "col" }, h));
  const body = table.createTBody();
  for (const st of exerciseStats(report)) {
    const tr = body.insertRow();
    tr.append(el("th", { scope: "row" }, exerciseName(st.id)));
    tr.insertCell().textContent = `${st.passed} / ${st.attempted}`;
    tr.insertCell().textContent = st.rate === null ? "not tried yet" : `${Math.round(st.rate * 100)}%`;
    const problems = tr.insertCell();
    problems.className = "wrap";
    problems.textContent = st.topFailures.length ? st.topFailures.map((f) => `${f.label} (${studentCount(f.count)})`).join(", ") : st.attempted ? "no failed checks" : "";
  }
  wrap.append(table);
  return wrap;
}

function stuckSection(report: Report): HTMLElement {
  const rows = stuckStudents(report);
  const list = rows.length
    ? el(
        "ul",
        { class: "plain" },
        ...rows.map((r) =>
          el(
            "li",
            {},
            el("strong", {}, r.nickname),
            ` on ${exerciseName(r.exerciseId)}: ${r.attempts} attempts, not passed. Last result: ${kindLabel(r.lastKind)}.`,
            r.lastAt ? el("span", { class: "muted" }, ` Last tried ${new Date(r.lastAt).toLocaleString()}.`) : "",
          ),
        ),
      )
    : el("p", { class: "muted" }, "Nobody is stuck right now.");
  return el("section", { class: "dash-section", id: "dash-stuck" }, el("h3", {}, "Stuck"), el("p", { class: "muted small" }, "Three or more attempts on an exercise and no pass yet, most recent first."), list);
}

function sameCodeSection(report: Report): HTMLElement {
  const groups = sameCodeGroups(report);
  const list = groups.length
    ? el("ul", { class: "plain" }, ...groups.map((g) => el("li", {}, el("strong", {}, exerciseName(g.exerciseId)), `: ${g.nicknames.join(", ")}`)))
    : el("p", { class: "muted" }, "No two students passed with the same code.");
  return el(
    "section",
    { class: "dash-section", id: "dash-same" },
    el("h3", {}, "Same code"),
    el("p", { class: "muted small" }, "Students whose first passing code is the same after normalising (comments, blank lines and extra spaces ignored). Worth a look, not proof of copying: short exercises often have one obvious answer."),
    list,
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderDashboard(opts: DashboardOptions): HTMLElement {
  const { report } = opts;
  const exportBtn = el("button", { type: "button", class: "btn", id: "export-csv" }, "Export CSV");
  exportBtn.addEventListener("click", () => download(`${opts.fileStem}-results.csv`, resultsCsv(report)));
  if (report.students.length === 0) {
    return el("div", { class: "dashboard" }, el("p", { class: "muted" }, "Nobody has joined yet. Share the student link, then press Refresh."));
  }
  return el(
    "div",
    { class: "dashboard" },
    el(
      "section",
      { class: "dash-section", id: "dash-heatmap" },
      el("h3", {}, "Students and exercises"),
      el("p", { class: "muted small" }, "Select a cell to read that student's attempts. Arrow keys move between cells."),
      el("p", { class: "muted small", id: "dash-caveat" }, "Results come from each student's browser; this is practice data, not exam marks."),
      legend(),
      heatmap(opts),
      opts.detail,
    ),
    el("section", { class: "dash-section", id: "dash-exercises" }, el("h3", {}, "Each exercise"), exerciseTable(report)),
    stuckSection(report),
    sameCodeSection(report),
    el("section", { class: "dash-section", id: "dash-export" }, el("h3", {}, "Export"), el("p", { class: "muted small" }, "One row per student and exercise, made in your browser."), exportBtn),
  );
}

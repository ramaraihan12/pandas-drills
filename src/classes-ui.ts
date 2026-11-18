// Class pages: create a class, join a class, and the teacher's results page.
// Only used when the build has an API address (see lib/api.ts).
import { ApiError, type Api, type Report } from "./lib/api.ts";
import { loadAttempts, loadReport, removeClass } from "./lib/report.ts";
import { joinLink, teachLink } from "./lib/route.ts";
import type { createSessions } from "./lib/session.ts";

type Sessions = ReturnType<typeof createSessions>;

export interface ClassUiDeps {
  host: HTMLElement;
  api: Api;
  sessions: Sessions;
  /** Where "back to the exercises" goes, and what happens after joining. */
  exerciseHash: () => string;
  onSessionChange: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  node.append(...kids);
  return node;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Could not reach the server. Check your connection and try again.";
}

async function copy(text: string, input: HTMLInputElement, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input.select();
    document.execCommand("copy");
  }
  const old = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = old), 1500);
}

function linkRow(label: string, url: string) {
  const input = el("input", { type: "text", readOnly: true, value: url, class: "link-input" });
  input.setAttribute("aria-label", label);
  input.addEventListener("focus", () => input.select());
  const btn = el("button", { type: "button", class: "btn" }, "Copy");
  btn.setAttribute("aria-label", `Copy the ${label.toLowerCase()}`);
  btn.addEventListener("click", () => void copy(url, input, btn));
  return el("div", { class: "link-row" }, el("p", { class: "sub" }, label), el("div", { class: "copy-line" }, input, btn));
}

function back(deps: ClassUiDeps) {
  return el("a", { href: deps.exerciseHash(), class: "link back" }, "Back to the exercises");
}

function show(deps: ClassUiDeps, ...nodes: Node[]) {
  deps.host.textContent = "";
  deps.host.append(...nodes);
}

// ---------- create a class ----------

export function renderNewClass(deps: ClassUiDeps) {
  const origin = location.origin;
  const base = import.meta.env.BASE_URL;
  const input = el("input", { type: "text", id: "class-name", maxLength: 60, required: true, autocomplete: "off" });
  const status = el("p", { class: "form-error", role: "alert" });
  const submit = el("button", { type: "submit", class: "btn primary" }, "Create the class");
  const form = el(
    "form",
    {},
    el("label", { htmlFor: "class-name" }, "Class name"),
    input,
    el("p", { class: "hint" }, "Something your students will recognise, up to 60 characters."),
    status,
    submit,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    submit.disabled = true;
    try {
      const made = await deps.api.createClass(input.value);
      const expires = new Date(made.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      show(
        deps,
        el(
          "section",
          { class: "panel" },
          el("h2", {}, "Your class is ready"),
          linkRow("Student link", joinLink(origin, base, made.code)),
          el("p", { class: "muted small" }, "Share this one with your students. They open it, pick a nickname and start."),
          linkRow("Teacher link (private)", teachLink(origin, base, made.code, made.teacherKey)),
          el(
            "div",
            { class: "fb fail" },
            el("p", { class: "fb-title" }, "Keep the teacher link private"),
            el("p", {}, "Anyone with it can see your class's results and delete the class. It can't be recovered, so save it somewhere safe now."),
            el("p", {}, `The class and all its data are deleted after 180 days (on ${expires}) or when you delete it.`),
          ),
          back(deps),
        ),
      );
    } catch (err) {
      status.textContent = errorText(err);
      submit.disabled = false;
    }
  });
  show(deps, el("section", { class: "panel narrow" }, el("h2", {}, "Create a class"), el("p", { class: "muted" }, "Students join with a link and a nickname. Every Check they make is recorded for you."), form, back(deps)));
  input.focus();
}

// ---------- join a class ----------

export async function renderJoin(deps: ClassUiDeps, code: string) {
  show(deps, el("section", { class: "panel narrow" }, el("p", { class: "muted" }, "Looking for the class...")));
  const existing = deps.sessions.get(code);
  let info: { name: string } | null = null;
  try {
    info = await deps.api.getClass(code);
  } catch (err) {
    const gone = err instanceof ApiError && err.status === 404;
    show(
      deps,
      el(
        "section",
        { class: "panel narrow" },
        el("h2", {}, gone ? "Class not found" : "Could not load the class"),
        el("p", {}, gone ? "There is no class with that code. It may have expired or been deleted. Ask your teacher for a new link." : errorText(err)),
        back(deps),
      ),
    );
    return;
  }
  if (existing) {
    show(
      deps,
      el(
        "section",
        { class: "panel narrow" },
        el("h2", {}, info.name),
        el("p", {}, `You are in this class as ${existing.nickname}.`),
        el("a", { href: deps.exerciseHash(), class: "btn primary" }, "Go to the exercises"),
      ),
    );
    return;
  }
  const input = el("input", { type: "text", id: "nickname", maxLength: 24, required: true, autocomplete: "off" });
  const status = el("p", { class: "form-error", role: "alert" });
  const submit = el("button", { type: "submit", class: "btn primary" }, "Join the class");
  const form = el(
    "form",
    {},
    el("label", { htmlFor: "nickname" }, "Your nickname"),
    input,
    el("p", { class: "hint" }, "Use a nickname, not your full name"),
    status,
    submit,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    submit.disabled = true;
    try {
      const res = await deps.api.join(code, input.value);
      deps.sessions.join(code, { name: info.name, nickname: res.nickname, token: res.studentToken });
      deps.onSessionChange();
      location.hash = deps.exerciseHash();
    } catch (err) {
      status.textContent = errorText(err);
      submit.disabled = false;
    }
  });
  show(
    deps,
    el(
      "section",
      { class: "panel narrow" },
      el("h2", {}, `Join ${info.name}`),
      form,
      el(
        "div",
        { class: "stored" },
        el("p", { class: "sub" }, "What's stored"),
        el(
          "p",
          { class: "small" },
          "Your nickname, the code you check and whether it passed, for this class only. No email, no IP address. It is deleted after 180 days or when the teacher deletes the class.",
        ),
      ),
      back(deps),
    ),
  );
  input.focus();
}

// ---------- teacher results ----------

const KIND_TEXT: Record<string, string> = {
  passed: "passed",
  syntax: "syntax error",
  exception: "error while running",
  no_result: "no result variable",
  checker_error: "checker problem",
  wrong_type: "wrong type",
  wrong_shape: "wrong number of rows",
  wrong_columns: "wrong columns",
  wrong_values: "wrong values",
  wrong_dtype: "wrong data type",
  wrong_index: "wrong row labels",
  wrong_order: "wrong order",
  timeout: "took too long",
  worker_error: "page error",
};

function renderTable(report: Report, onCell: (studentId: string, nickname: string, exerciseId: string) => void): HTMLElement {
  const wrap = el("div", { class: "table-wrap", tabIndex: 0 });
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Results by student and exercise");
  const table = el("table", { class: "results" });
  const head = table.createTHead().insertRow();
  head.append(el("th", { scope: "col" }, "Student"));
  for (const id of report.exercises) {
    const th = el("th", { scope: "col", title: id }, id.slice(0, 2));
    head.append(th);
  }
  const body = table.createTBody();
  for (const s of report.students) {
    const tr = body.insertRow();
    tr.append(el("th", { scope: "row" }, s.nickname));
    for (const ex of report.exercises) {
      const cell = s.results[ex];
      const td = tr.insertCell();
      if (!cell) {
        td.className = "none";
        td.textContent = "-";
        td.title = "No attempts yet";
        continue;
      }
      const btn = el("button", { type: "button", class: `cell ${cell.passed ? "ok" : "no"}` }, `${cell.passed ? "\u2713" : "\u2717"} ${cell.attempts}`);
      btn.setAttribute("aria-label", `${s.nickname}, exercise ${ex.slice(0, 2)}: ${cell.passed ? "passed" : "not passed"}, ${cell.attempts} attempt${cell.attempts === 1 ? "" : "s"}. Show the code.`);
      btn.title = `${cell.passed ? "Passed" : "Not passed"} after ${cell.attempts} attempt${cell.attempts === 1 ? "" : "s"}. Last result: ${KIND_TEXT[cell.lastKind] ?? cell.lastKind}`;
      btn.addEventListener("click", () => onCell(s.id, s.nickname, ex));
      td.append(btn);
    }
  }
  const foot = table.createTFoot().insertRow();
  foot.append(el("th", { scope: "row" }, "Passed / tried"));
  for (const ex of report.exercises) {
    const p = report.perExercise[ex] ?? { attempted: 0, passed: 0 };
    foot.insertCell().textContent = `${p.passed}/${p.attempted}`;
  }
  wrap.append(table);
  return wrap;
}

export async function renderTeach(deps: ClassUiDeps, code: string, key: string) {
  show(deps, el("section", { class: "panel" }, el("p", { class: "muted" }, "Loading results...")));
  const loaded = await loadReport(deps.api, code, key);
  if (!loaded.ok) {
    show(deps, el("section", { class: "panel narrow" }, el("h2", {}, "Could not open the results"), el("p", {}, loaded.message), back(deps)));
    return;
  }
  const report = loaded.value;
  const detail = el("div", { class: "detail", "aria-live": "polite" } as Partial<HTMLDivElement>);
  detail.setAttribute("aria-live", "polite");

  const onCell = async (studentId: string, nickname: string, exerciseId: string) => {
    detail.textContent = "Loading...";
    const res = await loadAttempts(deps.api, code, key, studentId, exerciseId);
    detail.textContent = "";
    if (!res.ok) {
      detail.append(el("p", { class: "form-error" }, res.message));
      return;
    }
    detail.append(el("h3", {}, `${nickname}, exercise ${exerciseId.slice(0, 2)} (newest first, up to 20)`));
    for (const a of res.value) {
      const when = new Date(a.at).toLocaleString();
      detail.append(
        el("p", { class: "sub" }, `${a.passed ? "Passed" : "Not passed"} (${KIND_TEXT[a.kind] ?? a.kind}) at ${when}`),
        el("pre", { class: "attempt", tabIndex: 0, textContent: a.code }),
      );
    }
    if (res.value.length === 0) detail.append(el("p", { class: "muted" }, "No attempts."));
  };

  const del = el("button", { type: "button", class: "btn danger" }, "Delete class");
  const confirmBox = el("div", { class: "confirm", hidden: true });
  const yes = el("button", { type: "button", class: "btn danger" }, "Yes, delete the class and everything in it");
  const no = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  const delStatus = el("p", { class: "form-error", role: "alert" });
  confirmBox.append(el("p", {}, "This removes the class, every student and every submission. It can't be undone."), yes, no, delStatus);
  del.addEventListener("click", () => {
    confirmBox.hidden = false;
    del.hidden = true;
    no.focus();
  });
  no.addEventListener("click", () => {
    confirmBox.hidden = true;
    del.hidden = false;
    del.focus();
  });
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    const res = await removeClass(deps.api, code, key);
    if (!res.ok) {
      delStatus.textContent = res.message;
      yes.disabled = false;
      return;
    }
    show(deps, el("section", { class: "panel narrow" }, el("h2", {}, "Class deleted"), el("p", {}, "The class and all its data are gone."), back(deps)));
  });

  const refresh = el("button", { type: "button", class: "btn ghost" }, "Refresh");
  refresh.addEventListener("click", () => void renderTeach(deps, code, key));
  const expires = new Date(report.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  show(
    deps,
    el(
      "section",
      { class: "panel" },
      el("p", { class: "meta" }, `Class code ${code} · ${report.students.length} student${report.students.length === 1 ? "" : "s"} · deleted automatically on ${expires}`),
      el("h2", {}, report.name),
      report.students.length === 0
        ? el("p", { class: "muted" }, "Nobody has joined yet. Share the student link, then press Refresh.")
        : el("p", { class: "muted small" }, "Each cell shows passed (\u2713) or not yet (\u2717) and the number of Checks. Select a cell to read the code."),
      report.students.length ? renderTable(report, onCell) : el("span"),
      detail,
      el("div", { class: "actions" }, refresh, del),
      confirmBox,
      back(deps),
    ),
  );
}

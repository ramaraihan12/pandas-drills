// Class pages: create a class, join a class, and the teacher's results page.
// Only used when the build has an API address (see lib/api.ts).
import { ApiError, type Api } from "./lib/api.ts";
import { el } from "./dom.ts";
import { renderDashboard } from "./dashboard-ui.ts";
import { cellLabel } from "./lib/dashboard.ts";
import { kindLabel } from "./lib/kinds.ts";
import { loadAttempts, loadDemoReport, loadReport, removeClass, removeStudent, setJoining } from "./lib/report.ts";
import { forgetTeacherKey, readTeacherKey } from "./lib/teacherKey.ts";
import { BOT_CHECK_TEXT, TURNSTILE_SITEKEY, loadTurnstile } from "./lib/turnstile.ts";
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
  /** Leaves the class on this device (asks what to clear). Resolves true when the student left. */
  leaveClass: (code: string) => Promise<boolean>;
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

/** A row for a secret link: hidden by default, with a Show toggle and a Copy button. */
function secretRow(label: string, url: string) {
  const input = el("input", { type: "password", readOnly: true, value: url, class: "link-input", autocomplete: "off" });
  input.setAttribute("aria-label", label);
  const show = el("button", { type: "button", class: "btn ghost" }, "Show");
  show.setAttribute("aria-pressed", "false");
  show.setAttribute("aria-label", `Show the ${label.toLowerCase()}`);
  show.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    show.textContent = hidden ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(hidden));
  });
  const btn = el("button", { type: "button", class: "btn" }, "Copy");
  btn.setAttribute("aria-label", `Copy the ${label.toLowerCase()}`);
  btn.addEventListener("click", () => void copy(url, input, btn));
  return el("div", { class: "link-row" }, el("p", { class: "sub" }, label), el("div", { class: "copy-line" }, input, show, btn));
}

type Shell = Pick<ClassUiDeps, "host" | "exerciseHash">;

function back(deps: Shell) {
  return el("a", { href: deps.exerciseHash(), class: "link back" }, "Back to the exercises");
}

function show(deps: Shell, ...nodes: Node[]) {
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
  submit.disabled = true; // until the bot check gives a token
  const botBox = el("div", { id: "bot-check", class: "bot-check" });
  const botNote = el("p", { class: "hint", id: "bot-check-note" }, BOT_CHECK_TEXT.loading);
  const form = el(
    "form",
    {},
    el("label", { htmlFor: "class-name" }, "Class name"),
    input,
    el("p", { class: "hint" }, "Something your students will recognise, up to 60 characters."),
    botBox,
    botNote,
    status,
    submit,
  );
  let token = "";
  let widget: string | undefined;
  let api: Awaited<ReturnType<typeof loadTurnstile>> | undefined;
  const waiting = (text: string) => {
    token = "";
    submit.disabled = true;
    botNote.textContent = text;
  };
  const resetWidget = (text: string) => {
    waiting(text);
    if (api && widget !== undefined) api.reset(widget);
  };
  if (!TURNSTILE_SITEKEY) {
    waiting(BOT_CHECK_TEXT.missing);
  } else {
    loadTurnstile().then(
      (t) => {
        api = t;
        if (!botBox.isConnected) return; // the page was left before the script arrived
        widget = t.render(botBox, {
          sitekey: TURNSTILE_SITEKEY,
          callback: (value) => {
            token = value;
            submit.disabled = false;
            botNote.textContent = "";
          },
          "expired-callback": () => resetWidget(BOT_CHECK_TEXT.expired),
          "error-callback": () => resetWidget(BOT_CHECK_TEXT.error),
          "timeout-callback": () => resetWidget(BOT_CHECK_TEXT.expired),
        });
        botNote.textContent = BOT_CHECK_TEXT.ready;
      },
      () => waiting(BOT_CHECK_TEXT.blocked),
    );
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) return;
    status.textContent = "";
    submit.disabled = true;
    try {
      const made = await deps.api.createClass(input.value, token);
      const expires = new Date(made.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      show(
        deps,
        el(
          "section",
          { class: "panel" },
          el("h2", {}, "Your class is ready"),
          linkRow("Student link", joinLink(origin, base, made.code)),
          el("p", { class: "muted small" }, "Share this one with your students. They open it, pick a nickname and start."),
          secretRow("Teacher link (private)", teachLink(origin, base, made.code, made.teacherKey)),
          el(
            "div",
            { class: "fb fail" },
            el("p", { class: "fb-title" }, "Keep the teacher link private"),
            el("p", {}, "Anyone with it can see your class's results and delete the class. It can't be recovered, so save it somewhere safe now."),
            el("p", {}, "On a shared or classroom computer, open the teacher link in a private window."),
            el("p", {}, `The class and all its data are deleted automatically within a day of ${expires} (180 days), or when you delete it.`),
          ),
          back(deps),
        ),
      );
    } catch (err) {
      status.textContent = errorText(err);
      // a token works once, so whatever went wrong the student needs a fresh one
      resetWidget(BOT_CHECK_TEXT.ready);
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
    const notYou = el("button", { type: "button", class: "link", id: "not-you" }, `Not ${existing.nickname}? Leave and join as yourself`);
    notYou.addEventListener("click", async () => {
      if (await deps.leaveClass(code)) void renderJoin(deps, code);
    });
    show(
      deps,
      el(
        "section",
        { class: "panel narrow" },
        el("h2", {}, info.name),
        el("p", {}, `You are in this class as ${existing.nickname}.`),
        el("a", { href: deps.exerciseHash(), class: "btn primary" }, "Go to the exercises"),
        notYou,
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
          "Your nickname, the code you check and whether it passed, for this class only. No email, no IP address. It is deleted automatically after 180 days, or sooner when the teacher deletes the class.",
        ),
      ),
      back(deps),
    ),
  );
  input.focus();
}

// ---------- teacher results ----------

export async function renderTeach(deps: ClassUiDeps, code: string) {
  const key = readTeacherKey(code);
  if (!key) {
    show(
      deps,
      el(
        "section",
        { class: "panel narrow" },
        el("h2", {}, "Open your teacher link again"),
        el("p", {}, "The teacher key is only kept while this tab is open, and it is not in the address bar. Open your saved teacher link again to see the results."),
        back(deps),
      ),
    );
    return;
  }
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
        el("p", { class: "sub" }, `${a.passed ? "Passed" : "Not passed"} (${kindLabel(a.kind)}) at ${when}`),
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
    forgetTeacherKey(code);
    show(deps, el("section", { class: "panel narrow" }, el("h2", {}, "Class deleted"), el("p", {}, "The class and all its data are gone."), back(deps)));
  });

  // teacher actions: close or open joining, remove a student
  const manageStatus = el("p", { class: "form-error", role: "alert" });
  const manage = () => {
    const open = report.joiningOpen !== false;
    const lock = el("button", { type: "button", class: "btn", id: "toggle-joining" }, open ? "Close joining" : "Open joining");
    lock.addEventListener("click", async () => {
      lock.disabled = true;
      const res = await setJoining(deps.api, code, key, !open);
      if (!res.ok) {
        manageStatus.textContent = res.message;
        lock.disabled = false;
        return;
      }
      void renderTeach(deps, code);
    });
    const people = report.students.map((s) => {
      const rm = el("button", { type: "button", class: "btn ghost small" }, "Remove");
      rm.setAttribute("aria-label", `Remove ${s.nickname} and their results`);
      rm.addEventListener("click", async () => {
        if (!confirm(`Remove ${s.nickname} and every check they made? This can't be undone.`)) return;
        rm.disabled = true;
        const res = await removeStudent(deps.api, code, key, s.id);
        if (!res.ok) {
          manageStatus.textContent = res.message;
          rm.disabled = false;
          return;
        }
        void renderTeach(deps, code);
      });
      return el("li", {}, el("span", {}, s.nickname), " ", rm);
    });
    return el(
      "section",
      { class: "dash-section", id: "dash-manage" },
      el("h3", {}, "Manage the class"),
      el("p", { class: "muted small", id: "joining-state" }, open ? "New students can join with the student link." : "This class is closed to new students. Students already in it can keep going."),
      lock,
      el("h4", {}, "Remove a student"),
      el("p", { class: "muted small" }, "Removing a student deletes their nickname and all their results, for example when someone joined by mistake."),
      people.length ? el("ul", { class: "plain", id: "student-list" }, ...people) : el("p", { class: "muted" }, "Nobody has joined yet."),
      manageStatus,
    );
  };

  const refresh = el("button", { type: "button", class: "btn ghost" }, "Refresh");
  refresh.addEventListener("click", () => void renderTeach(deps, code));
  const expires = new Date(report.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  show(
    deps,
    el(
      "section",
      { class: "panel" },
      el("p", { class: "meta" }, `Class code ${code} · ${report.students.length} student${report.students.length === 1 ? "" : "s"} · deleted automatically within a day of ${expires}`),
      el("h2", {}, report.name),
      renderDashboard({ report, onCell, detail, fileStem: `class-${code}` }),
      manage(),
      el("div", { class: "actions" }, refresh, del),
      confirmBox,
      back(deps),
    ),
  );
}

// ---------- the demo class (static data, no API) ----------

export async function renderDemo(deps: Shell, url: string) {
  show(deps, el("section", { class: "panel" }, el("p", { class: "muted" }, "Loading the demo class...")));
  const loaded = await loadDemoReport(url);
  if (!loaded.ok) {
    show(deps, el("section", { class: "panel narrow" }, el("h2", {}, "Could not open the demo"), el("p", {}, loaded.message), back(deps)));
    return;
  }
  const report = loaded.value;
  const detail = el("div", { class: "detail" });
  detail.setAttribute("aria-live", "polite");
  const onCell: Parameters<typeof renderDashboard>[0]["onCell"] = (_id, nickname, exerciseId, cell) => {
    detail.textContent = "";
    detail.append(
      el("h3", {}, nickname),
      el("p", {}, cellLabel(nickname, exerciseId, cell)),
      el("p", { class: "muted small" }, "In a real class this panel lists the student's attempts with their code. The demo has no code, because nobody wrote it."),
    );
  };
  show(
    deps,
    el(
      "section",
      { class: "panel" },
      el("p", { class: "demo-banner", id: "demo-banner" }, "Made-up class with generated data, to show what a teacher sees."),
      el("p", { class: "meta" }, `Demo class · ${report.students.length} students`),
      el("h2", {}, report.name),
      renderDashboard({ report, onCell, detail, fileStem: "demo-class" }),
      back(deps),
    ),
  );
}

import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { LIMITS, ROWS_PER_SUBMISSION, SUBMISSIONS_PER_DAY, reportStatements, scheduledCleanup, submissionStatements } from "../src/app.ts";
import { sha256Hex } from "../src/util.ts";

const BASE = "https://api.test";
const ORIGIN = "http://localhost:5173";

function call(method: string, path: string, opts: { body?: unknown; token?: string; origin?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { Origin: opts.origin ?? ORIGIN };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined || opts.raw !== undefined) headers["Content-Type"] = "application/json";
  return exports.default.fetch(
    new Request(BASE + path, { method, headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }),
  );
}

async function makeClass(name = "Data 101") {
  const res = await call("POST", "/classes", { body: { name } });
  expect(res.status).toBe(201);
  return (await res.json()) as { code: string; teacherKey: string; expiresAt: string };
}

async function join(code: string, nickname: string) {
  const res = await call("POST", `/classes/${code}/join`, { body: { nickname } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { studentToken: string }).studentToken;
}

const submission = (over: Record<string, unknown> = {}) => ({ exerciseId: "01-select-columns", passed: true, kind: "passed", code: "result = 1", ...over });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions"),
    env.DB.prepare("DELETE FROM student_exercise"),
    env.DB.prepare("DELETE FROM students"),
    env.DB.prepare("DELETE FROM classes"),
    env.DB.prepare("DELETE FROM daily_counters"),
  ]);
});

describe("report for the dashboard", () => {
  it("counts failure kinds, tries to pass and the first passing code hash, without code", async () => {
    const cls = await makeClass();
    const ann = await join(cls.code, "Ann");
    const bo = await join(cls.code, "Bo");
    const cy = await join(cls.code, "Cy");
    const send = (token: string, over: Record<string, unknown>) => call("POST", "/submissions", { token, body: submission(over) });
    await send(ann, { passed: false, kind: "wrong_shape", code: "result = 0" });
    await send(ann, { passed: false, kind: "wrong_shape", code: "result = 0" });
    await send(ann, { code: "result = df[['a']]  # first pass" });
    await send(ann, { code: "result = something_else" }); // after the first pass: must not change the hash
    await send(bo, { code: "result = df[['a']]\n\n# note   " }); // same code once normalised
    await send(cy, { passed: false, kind: "syntax", code: "result = (" });
    const data = (await (await call("GET", `/classes/${cls.code}/report`, { token: cls.teacherKey })).json()) as any;
    const row = (n: string) => data.students.find((s: any) => s.nickname === n).results["01-select-columns"];
    expect(row("Ann")).toMatchObject({ attempts: 4, passed: true, triesToPass: 3 });
    expect(row("Ann").lastAt).toBeTruthy();
    expect(row("Ann").firstPassHash).toMatch(/^[0-9a-f]{16}$/);
    expect(row("Bo")).toMatchObject({ attempts: 1, triesToPass: 1, firstPassHash: row("Ann").firstPassHash });
    expect(row("Cy")).toMatchObject({ passed: false, triesToPass: null, firstPassHash: null });
    expect(data.perExercise["01-select-columns"].failures).toEqual({ wrong_shape: 1, syntax: 1 });
    expect(data.perExercise["02-filter-rows"].failures).toEqual({});
    expect(JSON.stringify(data)).not.toContain("something_else");
  });

  it("stores a hash of the normalised code", async () => {
    const cls = await makeClass();
    const t = await join(cls.code, "Ann");
    await call("POST", "/submissions", { token: t, body: submission({ code: "x  =  1   # hi\n\n" }) });
    const row = await env.DB.prepare("SELECT code, code_hash FROM submissions").first<{ code: string; code_hash: string }>();
    expect(row?.code).toBe("x  =  1   # hi\n\n");
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("happy path", () => {
  it("creates, joins, submits, reports and deletes", async () => {
    const cls = await makeClass();
    expect(cls.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(cls.teacherKey.length).toBeGreaterThanOrEqual(43);
    const days = (Date.parse(cls.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(179.9);
    expect(days).toBeLessThanOrEqual(180);

    const info = await call("GET", `/classes/${cls.code.toLowerCase()}`);
    expect(await info.json()).toMatchObject({ name: "Data 101" });

    const ann = await join(cls.code, "  Ann   B. ");
    const bo = await join(cls.code, "Bo");
    expect((await call("POST", "/submissions", { token: ann, body: submission({ passed: false, kind: "wrong_values", code: "result = 0" }) })).status).toBe(204);
    expect((await call("POST", "/submissions", { token: ann, body: submission() })).status).toBe(204);
    expect((await call("POST", "/submissions", { token: bo, body: submission({ passed: false, kind: "syntax" }) })).status).toBe(204);

    const rep = await call("GET", `/classes/${cls.code}/report`, { token: cls.teacherKey });
    expect(rep.status).toBe(200);
    const data = (await rep.json()) as any;
    expect(data.exercises).toHaveLength(15);
    const annRow = data.students.find((s: any) => s.nickname === "Ann B.");
    expect(annRow.results["01-select-columns"]).toMatchObject({ attempts: 2, passed: true, lastKind: "passed" });
    expect(annRow.results["01-select-columns"].firstPassAt).toBeTruthy();
    const boRow = data.students.find((s: any) => s.nickname === "Bo");
    expect(boRow.results["01-select-columns"]).toMatchObject({ attempts: 1, passed: false, firstPassAt: null, lastKind: "syntax" });
    expect(data.perExercise["01-select-columns"]).toEqual({ attempted: 2, passed: 1, failures: { wrong_values: 1, syntax: 1 } });

    const list = await call("GET", `/classes/${cls.code}/submissions?student=${annRow.id}&exercise=01-select-columns`, { token: cls.teacherKey });
    const att = ((await list.json()) as any).attempts;
    expect(att.map((a: any) => a.code)).toEqual(["result = 1", "result = 0"]);

    expect((await call("DELETE", `/classes/${cls.code}`, { token: cls.teacherKey })).status).toBe(204);
    expect((await call("GET", `/classes/${cls.code}`)).status).toBe(404);
    for (const t of ["students", "submissions", "classes"]) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n).toBe(0);
    }
  });

  it("stores only hashes of the secrets", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    const dump = JSON.stringify([
      (await env.DB.prepare("SELECT * FROM classes").all()).results,
      (await env.DB.prepare("SELECT * FROM students").all()).results,
    ]);
    expect(dump).not.toContain(cls.teacherKey);
    expect(dump).not.toContain(token);
  });
});

describe("rules", () => {
  it("answers 401 for a wrong or missing teacher key, and for an unknown class", async () => {
    const cls = await makeClass();
    const wrong = await call("GET", `/classes/${cls.code}/report`, { token: "x".repeat(43) });
    const none = await call("GET", `/classes/${cls.code}/report`);
    const unknown = await call("GET", `/classes/ZZZZZZ/report`, { token: cls.teacherKey });
    for (const r of [wrong, none, unknown]) expect(r.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect((await call("DELETE", `/classes/${cls.code}`, { token: "nope" })).status).toBe(401);
  });

  it("refuses a duplicate nickname, ignoring case", async () => {
    const cls = await makeClass();
    await join(cls.code, "Ann");
    const res = await call("POST", `/classes/${cls.code}/join`, { body: { nickname: "ANN" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That nickname is taken in this class" });
  });

  it("checks nicknames", async () => {
    const cls = await makeClass();
    for (const bad of ["", "   ", "x".repeat(25), "<b>hi</b>", 5]) {
      expect((await call("POST", `/classes/${cls.code}/join`, { body: { nickname: bad } })).status).toBe(400);
    }
    expect((await call("POST", `/classes/${cls.code}/join`, { body: { nickname: "Siti_Nur-Aini O'Neil.2" } })).status).toBe(201);
  });

  it("caps a class at 60 students", async () => {
    const cls = await makeClass();
    for (let i = 0; i < 60; i++) await join(cls.code, `s${i}`);
    const res = await call("POST", `/classes/${cls.code}/join`, { body: { nickname: "late" } });
    expect(res.status).toBe(409);
  });

  it("checks the class name", async () => {
    for (const name of ["", "  ", "x".repeat(61), 3]) expect((await call("POST", "/classes", { body: { name } })).status).toBe(400);
  });

  it("rejects code over 8 KB with 413", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    const res = await call("POST", "/submissions", { token, body: submission({ code: "a".repeat(8193) }) });
    expect(res.status).toBe(413);
    expect((await call("POST", "/submissions", { token, body: submission({ code: "a".repeat(8192) }) })).status).toBe(204);
  });

  it("rejects a body over 16 KB with 413", async () => {
    const res = await call("POST", "/classes", { raw: JSON.stringify({ name: "x", pad: "a".repeat(17000) }) });
    expect(res.status).toBe(413);
  });

  it("rejects an unknown exercise, kind or shape with 400", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    for (const over of [{ exerciseId: "99-nope" }, { kind: "made_up" }, { passed: "yes" }, { code: 5 }]) {
      expect((await call("POST", "/submissions", { token, body: submission(over) })).status).toBe(400);
    }
  });

  it("needs a valid student token", async () => {
    expect((await call("POST", "/submissions", { body: submission() })).status).toBe(401);
    expect((await call("POST", "/submissions", { token: "abc", body: submission() })).status).toBe(401);
  });

  it("limits a student to 60 submissions an hour", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    const row = (await env.DB.prepare("SELECT id, class_id FROM students").first<{ id: string; class_id: string }>())!;
    const now = Date.now();
    const old = env.DB.prepare("INSERT INTO submissions (class_id, student_id, exercise_id, passed, kind, code, created_at) VALUES (?, ?, 'x', 0, 'syntax', '', ?)");
    await env.DB.batch([
      ...Array.from({ length: 59 }, () => old.bind(row.class_id, row.id, now - 60000)),
      old.bind(row.class_id, row.id, now - 2 * 3600000), // older than an hour: not counted
    ]);
    expect((await call("POST", "/submissions", { token, body: submission() })).status).toBe(204);
    const res = await call("POST", "/submissions", { token, body: submission() });
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toMatch(/hour/);
  });

  it("stops after 50 new classes a day", async () => {
    await env.DB.prepare("INSERT INTO daily_counters (day, classes_created) VALUES (?, 49)").bind(new Date().toISOString().slice(0, 10)).run();
    await makeClass("fiftieth");
    const res = await call("POST", "/classes", { body: { name: "one too many" } });
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toMatch(/today/);
  });

  it("removes expired classes when a new one is created, with their students and submissions", async () => {
    const past = Date.now() - 1000;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO classes (id, code, name, teacher_key_hash, created_at, expires_at) VALUES ('old', 'OLDOLD', 'Old', 'h', 1, ?)").bind(past),
      env.DB.prepare("INSERT INTO students (id, class_id, nickname, nickname_norm, token_hash, created_at) VALUES ('s', 'old', 'A', 'a', 'th', 1)"),
      env.DB.prepare("INSERT INTO submissions (class_id, student_id, exercise_id, passed, kind, code, created_at) VALUES ('old', 's', 'x', 0, 'syntax', '', 1)"),
      env.DB.prepare("INSERT INTO student_exercise (class_id, student_id, exercise_id, attempts, passed, last_kind, last_at) VALUES ('old', 's', 'x', 1, 0, 'syntax', 1)"),
    ]);
    expect((await call("GET", "/classes/OLDOLD")).status).toBe(404); // expired classes already look gone
    await makeClass();
    for (const t of ["students", "submissions", "student_exercise"]) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n).toBe(0);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM classes").first<{ n: number }>())?.n).toBe(1);
  });
});

describe("cors", () => {
  it("answers a preflight from an allowed origin", async () => {
    const res = await exports.default.fetch(
      new Request(BASE + "/submissions", { method: "OPTIONS", headers: { Origin: "https://ramaraihan.is-a.dev", "Access-Control-Request-Method": "POST" } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ramaraihan.is-a.dev");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, DELETE, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
  });
  it("gives no CORS headers to other origins", async () => {
    const res = await call("GET", "/classes/ZZZZZZ", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const pre = await exports.default.fetch(new Request(BASE + "/classes", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(pre.status).toBe(403);
  });
});

async function seedStudent(classCode: string, nick: string) {
  const token = await join(classCode, nick);
  const row = (await env.DB.prepare("SELECT id, class_id FROM students WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ id: string; class_id: string }>())!;
  return { token, id: row.id, classId: row.class_id };
}
const input = (st: { id: string; classId: string }, over: Record<string, unknown> = {}) => ({
  classId: st.classId,
  studentId: st.id,
  exerciseId: "01-select-columns",
  passed: false,
  kind: "wrong_values",
  code: "result = 1",
  codeHash: "a".repeat(64),
  now: Date.now(),
  ...over,
});
const rowsWritten = (r: D1Result[]) => r.reduce((n, x) => n + (x.meta.rows_written ?? 0), 0);

describe("submission limits under parallel load", () => {
  it("stores exactly 60 of 200 parallel submissions from one student", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    const res = await Promise.all(Array.from({ length: 200 }, () => call("POST", "/submissions", { token, body: submission({ passed: false, kind: "wrong_values" }) })));
    expect(res.filter((r) => r.status === 204)).toHaveLength(60);
    expect(res.filter((r) => r.status === 429)).toHaveLength(140);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions").first<{ n: number }>())?.n).toBe(60);
    const cell = await env.DB.prepare("SELECT attempts FROM student_exercise").first<{ attempts: number }>();
    expect(cell?.attempts).toBe(60);
    expect((await env.DB.prepare("SELECT submissions_stored AS n FROM classes").first<{ n: number }>())?.n).toBe(60);
  });

  it("enforces the site-wide daily cap under parallel load, and counts only stored ones", async () => {
    const cls = await makeClass();
    const tokens = await Promise.all(Array.from({ length: 5 }, (_, i) => join(cls.code, `s${i}`)));
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("UPDATE daily_counters SET submissions = ? WHERE day = ?").bind(SUBMISSIONS_PER_DAY - 10, day).run();
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => call("POST", "/submissions", { token: tokens[i % 5]!, body: submission() })));
    expect(res.filter((r) => r.status === 204)).toHaveLength(10);
    const refused = res.find((r) => r.status === 429)!;
    expect(((await refused.json()) as any).error).toMatch(/today/);
    expect((await env.DB.prepare("SELECT submissions FROM daily_counters WHERE day = ?").bind(day).first<{ submissions: number }>())?.submissions).toBe(SUBMISSIONS_PER_DAY);
  });

  it("caps the submissions kept for one class", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    await env.DB.prepare("UPDATE classes SET submissions_stored = ?").bind(LIMITS.submissionsPerClass - 1).run();
    expect((await call("POST", "/submissions", { token, body: submission() })).status).toBe(204);
    const res = await call("POST", "/submissions", { token, body: submission() });
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toMatch(/class has stored/);
  });

  it("a refused submission leaves the counters and the summary alone", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    await env.DB.prepare("UPDATE classes SET submissions_stored = ?").bind(LIMITS.submissionsPerClass).run();
    await call("POST", "/submissions", { token, body: submission() });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM student_exercise").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM daily_counters WHERE submissions > 0").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("cost measurements", () => {
  it("one submission writes no more rows than ROWS_PER_SUBMISSION", async () => {
    const cls = await makeClass();
    const st = await seedStudent(cls.code, "Ann");
    await env.DB.prepare("DELETE FROM daily_counters").run(); // the first submission of a UTC day also creates the counter row
    const first = rowsWritten(await env.DB.batch(submissionStatements(env.DB, input(st, { passed: true, kind: "passed" }))));
    const next = rowsWritten(await env.DB.batch(submissionStatements(env.DB, input(st))));
    console.log(`rows_written: first submission ${first}, later ones ${next}`);
    expect(Math.max(first, next)).toBeLessThanOrEqual(ROWS_PER_SUBMISSION);
    expect(SUBMISSIONS_PER_DAY * ROWS_PER_SUBMISSION).toBeLessThanOrEqual(50_000);
  });

  it("a report for 60 students with 100 submissions each reads at most 2,500 rows", async () => {
    const cls = await makeClass();
    const cid = (await env.DB.prepare("SELECT id FROM classes").first<{ id: string }>())!.id;
    const ex = (await (await call("GET", "/classes/" + cls.code)).json(), (await import("../src/generated/exercise-ids.json")).default as string[]);
    const stmts: D1PreparedStatement[] = [];
    for (let s = 0; s < 60; s++) {
      stmts.push(env.DB.prepare("INSERT INTO students (id, class_id, nickname, nickname_norm, token_hash, created_at) VALUES (?, ?, ?, ?, ?, 1)").bind(`st${s}`, cid, `s${s}`, `s${s}`, `h${s}`));
    }
    for (let s = 0; s < 60; s++) {
      // 100 submissions spread over the exercises
      for (let e = 0; e < ex.length; e++) {
        stmts.push(
          env.DB.prepare("INSERT INTO student_exercise (class_id, student_id, exercise_id, attempts, passed, first_pass_at, tries_to_pass, first_pass_hash, last_kind, last_at, fail_kinds) VALUES (?, ?, ?, ?, 1, 5, 3, 'abc', 'passed', 9, 6)").bind(
            cid,
            `st${s}`,
            ex[e]!,
            e < 10 ? 7 : 6,
          ),
        );
      }
    }
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    const results = await env.DB.batch(reportStatements(env.DB, cid));
    const read = results.reduce((n, r) => n + (r.meta.rows_read ?? 0), 0);
    console.log(`report rows_read for 60 students x 100 submissions: ${read}`);
    expect(read).toBeLessThanOrEqual(2500); // measured: 960 (60 students + 900 summary rows)
    const rep = await call("GET", `/classes/${cls.code}/report`, { token: cls.teacherKey });
    expect(rep.status).toBe(200);
  });
});

describe("summary table", () => {
  it("counts distinct students per kind and leaves site faults out", async () => {
    const cls = await makeClass();
    const a = await join(cls.code, "Ann");
    const b = await join(cls.code, "Bo");
    const send = (t: string, kind: string) => call("POST", "/submissions", { token: t, body: submission({ passed: false, kind }) });
    for (const k of ["wrong_values", "wrong_values", "wrong_values", "checker_error", "timeout", "worker_error"]) await send(a, k);
    await send(b, "wrong_values");
    await send(b, "exception");
    const data = (await (await call("GET", `/classes/${cls.code}/report`, { token: cls.teacherKey })).json()) as any;
    expect(data.perExercise["01-select-columns"].failures).toEqual({ wrong_values: 2, exception: 1 });
    expect(data.perExercise["01-select-columns"].attempted).toBe(2);
  });
});

describe("expiry cleanup", () => {
  async function seedExpired(n: number) {
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < n; i++) {
      stmts.push(
        env.DB.prepare("INSERT INTO classes (id, code, name, teacher_key_hash, created_at, expires_at) VALUES (?, ?, 'Old', 'h', 1, ?)").bind(`o${i}`, `OLD${String(i).padStart(3, "0")}`, 1000 + i),
        env.DB.prepare("INSERT INTO students (id, class_id, nickname, nickname_norm, token_hash, created_at) VALUES (?, ?, 'A', 'a', ?, 1)").bind(`s${i}`, `o${i}`, `th${i}`),
        env.DB.prepare("INSERT INTO submissions (class_id, student_id, exercise_id, passed, kind, code, created_at) VALUES (?, ?, 'x', 0, 'syntax', '', 1)").bind(`o${i}`, `s${i}`),
        env.DB.prepare("INSERT INTO student_exercise (class_id, student_id, exercise_id, attempts, passed, last_kind, last_at) VALUES (?, ?, 'x', 1, 0, 'syntax', 1)").bind(`o${i}`, `s${i}`),
      );
    }
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  }
  const count = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

  it("runs on join and on report, in chunks of at most 20 classes", async () => {
    await seedExpired(45);
    const cls = await makeClass(); // removes 20
    expect(await count("classes")).toBe(45 - 20 + 1);
    await join(cls.code, "Ann"); // removes 20 more
    expect(await count("classes")).toBe(45 - 40 + 1);
    await call("GET", `/classes/${cls.code}/report`, { token: cls.teacherKey }); // the last 5
    expect(await count("classes")).toBe(1);
    for (const t of ["students", "submissions", "student_exercise"]) expect(await count(t)).toBe(t === "students" ? 1 : 0);
  });

  it("the scheduled handler cleans in bounded batches, with all their rows", async () => {
    const live = await makeClass();
    await seedExpired(130);
    await env.DB.prepare("INSERT INTO daily_counters (day, classes_created) VALUES ('2000-01-01', 1)").run();
    const removed = await scheduledCleanup(env);
    expect(removed).toBe(130);
    expect(await count("classes")).toBe(1);
    for (const t of ["students", "submissions", "student_exercise"]) expect(await count(t)).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM daily_counters WHERE day = '2000-01-01'").first<{ n: number }>())?.n).toBe(0);
    expect((await call("GET", `/classes/${live.code}`)).status).toBe(200);
  });

  it("the scheduled handler stops after a fixed number of batches", async () => {
    await seedExpired(30);
    const orig = LIMITS.cleanupBatchesScheduled;
    LIMITS.cleanupBatchesScheduled = 1;
    LIMITS.cleanupChunkScheduled = 10;
    try {
      expect(await scheduledCleanup(env)).toBe(10);
    } finally {
      LIMITS.cleanupBatchesScheduled = orig;
      LIMITS.cleanupChunkScheduled = 50;
    }
    expect(await count("classes")).toBe(20);
  });

  it("is wired as a worker scheduled() handler", async () => {
    await seedExpired(3);
    const ctx = createExecutionContext();
    await worker.scheduled!({ cron: "17 3 * * *", scheduledTime: Date.now(), type: "scheduled", noRetry() {} } as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await count("classes")).toBe(0);
  });
});

describe("teacher actions", () => {
  it("removes a student with their rows and frees their submissions", async () => {
    const cls = await makeClass();
    const a = await seedStudent(cls.code, "Ann");
    const b = await seedStudent(cls.code, "Bo");
    for (const t of [a.token, a.token, b.token]) await call("POST", "/submissions", { token: t, body: submission() });
    expect((await env.DB.prepare("SELECT submissions_stored AS n FROM classes").first<{ n: number }>())?.n).toBe(3);
    expect((await call("DELETE", `/classes/${cls.code}/students/${a.id}`, { token: "x".repeat(43) })).status).toBe(401);
    expect((await call("DELETE", `/classes/${cls.code}/students/${a.id}`, { token: cls.teacherKey })).status).toBe(204);
    expect((await call("DELETE", `/classes/${cls.code}/students/${a.id}`, { token: cls.teacherKey })).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE student_id = ?").bind(a.id).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM student_exercise WHERE student_id = ?").bind(a.id).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT submissions_stored AS n FROM classes").first<{ n: number }>())?.n).toBe(1);
    expect((await call("POST", "/submissions", { token: a.token, body: submission() })).status).toBe(401);
    expect((await call("POST", "/submissions", { token: b.token, body: submission() })).status).toBe(204);
  });

  it("cannot remove a student of another class", async () => {
    const one = await makeClass("One");
    const two = await makeClass("Two");
    const a = await seedStudent(one.code, "Ann");
    expect((await call("DELETE", `/classes/${two.code}/students/${a.id}`, { token: two.teacherKey })).status).toBe(404);
  });

  it("locks and unlocks joining", async () => {
    const cls = await makeClass();
    await join(cls.code, "Ann");
    expect((await call("POST", `/classes/${cls.code}/joining`, { body: { open: false }, token: "x".repeat(43) })).status).toBe(401);
    expect((await call("POST", `/classes/${cls.code}/joining`, { body: { open: false }, token: cls.teacherKey })).status).toBe(204);
    const closed = await call("POST", `/classes/${cls.code}/join`, { body: { nickname: "Bo" } });
    expect(closed.status).toBe(403);
    expect(await closed.json()).toEqual({ error: "This class is closed to new students" });
    const rep = (await (await call("GET", `/classes/${cls.code}/report`, { token: cls.teacherKey })).json()) as any;
    expect(rep.joiningOpen).toBe(false);
    expect((await call("POST", `/classes/${cls.code}/joining`, { body: { open: true }, token: cls.teacherKey })).status).toBe(204);
    expect((await call("POST", `/classes/${cls.code}/join`, { body: { nickname: "Bo" } })).status).toBe(201);
    expect((await call("POST", `/classes/${cls.code}/joining`, { body: { open: "no" }, token: cls.teacherKey })).status).toBe(400);
  });
});

describe("requests", () => {
  it("needs a JSON content type on POST", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const headers: Record<string, string> = { Origin: ORIGIN };
      if (ct) headers["Content-Type"] = ct;
      const res = await exports.default.fetch(new Request(BASE + "/classes", { method: "POST", headers, body: JSON.stringify({ name: "x" }) }));
      expect(res.status).toBe(415);
    }
    const ok = await exports.default.fetch(new Request(BASE + "/classes", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ name: "x" }) }));
    expect(ok.status).toBe(201);
  });

  it("refuses a present, unknown Origin with 403 and accepts none", async () => {
    expect((await call("POST", "/classes", { body: { name: "x" }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/classes", { body: { name: "x" }, origin: "https://ramaraihan.is-a.dev" })).status).toBe(201);
    const noOrigin = await exports.default.fetch(new Request(BASE + "/classes/ZZZZZZ"));
    expect(noOrigin.status).toBe(404);
  });

  it("allows localhost only when DEV_ORIGINS is set", async () => {
    const saved = env.DEV_ORIGINS;
    env.DEV_ORIGINS = undefined;
    try {
      expect((await call("GET", "/classes/ZZZZZZ", { origin: "http://localhost:5173" })).status).toBe(403);
    } finally {
      env.DEV_ORIGINS = saved;
    }
    expect((await call("GET", "/classes/ZZZZZZ", { origin: "http://localhost:5173" })).status).toBe(404);
  });
});

describe("names", () => {
  it("accepts Latin names with accents and refuses look-alike scripts", async () => {
    const cls = await makeClass();
    for (const ok of ["José", "Zoë O'Neil", "Łukasz-2", "Ann_B."]) expect((await call("POST", `/classes/${cls.code}/join`, { body: { nickname: ok } })).status).toBe(201);
    for (const bad of ["\u0410nn", "Ａnn\u0430", "名前", "a<b", "emoji😀", "a/b"]) {
      expect((await call("POST", `/classes/${cls.code}/join`, { body: { nickname: bad } })).status).toBe(400);
    }
    // fullwidth letters become plain ones (NFKC) and then are fine
    const res = await call("POST", `/classes/${cls.code}/join`, { body: { nickname: "\uFF22\uFF4F" } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).nickname).toBe("Bo");
  });

  it("limits class names to plain text without links", async () => {
    for (const bad of ["see https://x.example", "visit www.x.example", "WWW.X.COM", "<b>x</b>", "class \u0410\u0430\u{1F600}", "x\u0000y"]) {
      expect((await call("POST", "/classes", { body: { name: bad } })).status).toBe(400);
    }
    for (const good of ["Data 101 (Mon & Wed)", "Kelas 10-A: pandas!", "Año 2, grupo B"]) expect((await call("POST", "/classes", { body: { name: good } })).status).toBe(201);
  });
});

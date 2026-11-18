import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

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
    env.DB.prepare("DELETE FROM students"),
    env.DB.prepare("DELETE FROM classes"),
    env.DB.prepare("DELETE FROM daily_counters"),
  ]);
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
    expect(data.perExercise["01-select-columns"]).toEqual({ attempted: 2, passed: 1 });

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

  it("limits a student to 120 submissions an hour", async () => {
    const cls = await makeClass();
    const token = await join(cls.code, "Ann");
    const row = (await env.DB.prepare("SELECT id, class_id FROM students").first<{ id: string; class_id: string }>())!;
    const now = Date.now();
    const old = env.DB.prepare("INSERT INTO submissions (class_id, student_id, exercise_id, passed, kind, code, created_at) VALUES (?, ?, 'x', 0, 'syntax', '', ?)");
    await env.DB.batch([
      ...Array.from({ length: 119 }, () => old.bind(row.class_id, row.id, now - 60000)),
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
    ]);
    expect((await call("GET", "/classes/OLDOLD")).status).toBe(404); // expired classes already look gone
    await makeClass();
    for (const t of ["students", "submissions"]) {
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
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const pre = await exports.default.fetch(new Request(BASE + "/classes", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

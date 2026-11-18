import { SUBMISSION_KINDS } from "../../src/lib/kinds.ts";
import exerciseIds from "./generated/exercise-ids.json";
import { bearer, randomCode, randomId, randomSecret, sha256Hex, timingSafeEqual } from "./util.ts";

export interface Env {
  DB: D1Database;
}

export const LIMITS = {
  classLifetimeMs: 180 * 24 * 3600 * 1000,
  classesPerDay: 50,
  studentsPerClass: 60,
  submissionsPerHour: 120,
  bodyBytes: 16 * 1024,
  codeBytes: 8 * 1024,
  reportAttempts: 20,
};

const ORIGINS = new Set(["https://ramaraihan.is-a.dev", "http://localhost:5173", "http://localhost:4173"]);
const EXERCISES = new Set<string>(exerciseIds);
const KINDS = new Set<string>(SUBMISSION_KINDS);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > LIMITS.bodyBytes) throw new HttpError(413, "That request is too large.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.bodyBytes) {
      await reader.cancel();
      throw new HttpError(413, "That request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // falls through
  }
  throw new HttpError(400, "The request body must be a JSON object.");
}

interface ClassRow {
  id: string;
  code: string;
  name: string;
  teacher_key_hash: string;
  expires_at: number;
}

async function findClass(env: Env, code: string): Promise<ClassRow | null> {
  return env.DB.prepare("SELECT id, code, name, teacher_key_hash, expires_at FROM classes WHERE code = ? AND expires_at > ?")
    .bind(code.toUpperCase(), Date.now())
    .first<ClassRow>();
}

const FAKE_HASH = "0".repeat(64);

/** The teacher key must match. An unknown class and a wrong key look the same on purpose. */
async function requireTeacher(request: Request, env: Env, code: string): Promise<ClassRow> {
  const key = bearer(request);
  const cls = await findClass(env, code);
  const supplied = await sha256Hex(key ?? "");
  const ok = timingSafeEqual(supplied, cls?.teacher_key_hash ?? FAKE_HASH);
  if (!key || !cls || !ok) throw new HttpError(401, "That teacher link is not valid.");
  return cls;
}

function validNickname(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Please choose a nickname.");
  const nick = raw.trim().replace(/\s+/g, " ");
  const length = [...nick].length;
  if (length < 1 || length > 24) throw new HttpError(400, "A nickname must be 1 to 24 characters.");
  if (!/^[\p{L}\p{N} \-_.']+$/u.test(nick)) {
    throw new HttpError(400, "A nickname can use letters, digits, spaces and - _ . ' only.");
  }
  return nick;
}

// ---------- handlers ----------

async function createClass(request: Request, env: Env) {
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 60) throw new HttpError(400, "The class name must be 1 to 60 characters.");

  const now = Date.now();
  // lazy cleanup instead of a cron job: expired classes go whenever a new one is made
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions WHERE class_id IN (SELECT id FROM classes WHERE expires_at <= ?)").bind(now),
    env.DB.prepare("DELETE FROM students WHERE class_id IN (SELECT id FROM classes WHERE expires_at <= ?)").bind(now),
    env.DB.prepare("DELETE FROM classes WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM daily_counters WHERE day < ?").bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10)),
  ]);

  const day = new Date(now).toISOString().slice(0, 10);
  const bumped = await env.DB.prepare(
    "INSERT INTO daily_counters (day, classes_created) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET classes_created = classes_created + 1 WHERE classes_created < ? RETURNING classes_created",
  )
    .bind(day, LIMITS.classesPerDay)
    .first();
  if (!bumped) {
    throw new HttpError(429, "This site has reached its limit for new classes today. Please try again tomorrow.");
  }

  const teacherKey = randomSecret();
  const keyHash = await sha256Hex(teacherKey);
  const expiresAt = now + LIMITS.classLifetimeMs;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await env.DB.prepare("INSERT INTO classes (id, code, name, teacher_key_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(randomId(), code, name, keyHash, now, expiresAt)
        .run();
      return { status: 201, data: { code, teacherKey, expiresAt: new Date(expiresAt).toISOString() } };
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  throw new HttpError(503, "Could not make a class code just now. Please try again.");
}

async function classInfo(env: Env, code: string) {
  const cls = await findClass(env, code);
  if (!cls) throw new HttpError(404, "There is no class with that code. It may have expired.");
  return { status: 200, data: { name: cls.name, expiresAt: new Date(cls.expires_at).toISOString() } };
}

async function joinClass(request: Request, env: Env, code: string) {
  const body = await readJson(request);
  const nickname = validNickname(body.nickname);
  const cls = await findClass(env, code);
  if (!cls) throw new HttpError(404, "There is no class with that code. It may have expired.");

  const token = randomSecret();
  const taken = new HttpError(409, "That nickname is taken in this class");
  try {
    const res = await env.DB.prepare(
      "INSERT INTO students (id, class_id, nickname, nickname_norm, token_hash, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM students WHERE class_id = ?) < ?",
    )
      .bind(randomId(), cls.id, nickname, nickname.toLowerCase(), await sha256Hex(token), Date.now(), cls.id, LIMITS.studentsPerClass)
      .run();
    if (!res.meta.changes) throw new HttpError(409, `This class is full (${LIMITS.studentsPerClass} students).`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (String(err).includes("UNIQUE")) throw taken;
    throw err;
  }
  return { status: 201, data: { studentToken: token, nickname } };
}

async function submit(request: Request, env: Env) {
  const token = bearer(request);
  const student = token
    ? await env.DB.prepare(
        "SELECT s.id, s.class_id, s.token_hash FROM students s JOIN classes c ON c.id = s.class_id WHERE s.token_hash = ? AND c.expires_at > ?",
      )
        .bind(await sha256Hex(token), Date.now())
        .first<{ id: string; class_id: string; token_hash: string }>()
    : null;
  if (!token || !student || !timingSafeEqual(await sha256Hex(token), student.token_hash)) {
    throw new HttpError(401, "Your student session is not valid. Join the class again.");
  }

  const body = await readJson(request);
  if (typeof body.exerciseId !== "string" || !EXERCISES.has(body.exerciseId)) throw new HttpError(400, "That exercise does not exist.");
  if (typeof body.passed !== "boolean") throw new HttpError(400, "`passed` must be true or false.");
  if (typeof body.kind !== "string" || !KINDS.has(body.kind)) throw new HttpError(400, "That result kind is not known.");
  if (typeof body.code !== "string") throw new HttpError(400, "`code` must be text.");
  if (new TextEncoder().encode(body.code).length > LIMITS.codeBytes) throw new HttpError(413, "That code is longer than 8 KB.");

  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE student_id = ? AND created_at > ?")
    .bind(student.id, now - 3600000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIMITS.submissionsPerHour) {
    throw new HttpError(429, "That is a lot of checks in one hour. Please wait a bit and try again.");
  }
  await env.DB.prepare("INSERT INTO submissions (class_id, student_id, exercise_id, passed, kind, code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(student.class_id, student.id, body.exerciseId, body.passed ? 1 : 0, body.kind, body.code, now)
    .run();
  return { status: 204, data: null };
}

interface Cell {
  student_id: string;
  exercise_id: string;
  attempts: number;
  passed: number;
  first_pass_at: number | null;
  last_kind: string;
}

async function report(request: Request, env: Env, code: string) {
  const cls = await requireTeacher(request, env, code);
  const [students, cells] = await env.DB.batch([
    env.DB.prepare("SELECT id, nickname, created_at FROM students WHERE class_id = ? ORDER BY nickname_norm").bind(cls.id),
    env.DB.prepare(
      `SELECT s.student_id, s.exercise_id, COUNT(*) AS attempts, MAX(s.passed) AS passed,
              MIN(CASE WHEN s.passed = 1 THEN s.created_at END) AS first_pass_at,
              (SELECT x.kind FROM submissions x
                WHERE x.class_id = s.class_id AND x.student_id = s.student_id AND x.exercise_id = s.exercise_id
                ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS last_kind
         FROM submissions s WHERE s.class_id = ? GROUP BY s.student_id, s.exercise_id`,
    ).bind(cls.id),
  ]);
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const byStudent = new Map<string, Record<string, unknown>>();
  const perExercise: Record<string, { attempted: number; passed: number }> = Object.fromEntries(
    exerciseIds.map((id) => [id, { attempted: 0, passed: 0 }]),
  );
  for (const c of (cells?.results ?? []) as unknown as Cell[]) {
    const mine = byStudent.get(c.student_id) ?? {};
    mine[c.exercise_id] = { attempts: c.attempts, passed: c.passed === 1, firstPassAt: iso(c.first_pass_at), lastKind: c.last_kind };
    byStudent.set(c.student_id, mine);
    const agg = perExercise[c.exercise_id];
    if (agg) {
      agg.attempted += 1;
      if (c.passed === 1) agg.passed += 1;
    }
  }
  return {
    status: 200,
    data: {
      name: cls.name,
      expiresAt: new Date(cls.expires_at).toISOString(),
      exercises: exerciseIds,
      students: ((students?.results ?? []) as unknown as { id: string; nickname: string; created_at: number }[]).map((s) => ({
        id: s.id,
        nickname: s.nickname,
        joinedAt: iso(s.created_at),
        results: byStudent.get(s.id) ?? {},
      })),
      perExercise,
    },
  };
}

async function attempts(request: Request, env: Env, code: string, url: URL) {
  const cls = await requireTeacher(request, env, code);
  const student = url.searchParams.get("student") ?? "";
  const exercise = url.searchParams.get("exercise") ?? "";
  if (!student || !EXERCISES.has(exercise)) throw new HttpError(400, "Say which student and which exercise.");
  const rows = await env.DB.prepare(
    "SELECT passed, kind, code, created_at FROM submissions WHERE class_id = ? AND student_id = ? AND exercise_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  )
    .bind(cls.id, student, exercise, LIMITS.reportAttempts)
    .all<{ passed: number; kind: string; code: string; created_at: number }>();
  return {
    status: 200,
    data: {
      attempts: rows.results.map((r) => ({ passed: r.passed === 1, kind: r.kind, code: r.code, at: new Date(r.created_at).toISOString() })),
    },
  };
}

async function deleteClass(request: Request, env: Env, code: string) {
  const cls = await requireTeacher(request, env, code);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions WHERE class_id = ?").bind(cls.id),
    env.DB.prepare("DELETE FROM students WHERE class_id = ?").bind(cls.id),
    env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(cls.id),
  ]);
  return { status: 204, data: null };
}

// ---------- router ----------

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const m = request.method;
  if (path === "/classes" && m === "POST") return createClass(request, env);
  if (path === "/submissions" && m === "POST") return submit(request, env);
  let hit = /^\/classes\/([A-Za-z0-9]{1,12})$/.exec(path);
  if (hit?.[1]) {
    if (m === "GET") return classInfo(env, hit[1]);
    if (m === "DELETE") return deleteClass(request, env, hit[1]);
  }
  hit = /^\/classes\/([A-Za-z0-9]{1,12})\/(join|report|submissions)$/.exec(path);
  if (hit?.[1]) {
    if (hit[2] === "join" && m === "POST") return joinClass(request, env, hit[1]);
    if (hit[2] === "report" && m === "GET") return report(request, env, hit[1]);
    if (hit[2] === "submissions" && m === "GET") return attempts(request, env, hit[1], url);
  }
  throw new HttpError(404, "Nothing here.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request.headers.get("Origin"));
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const { status, data } = await route(request, env);
      return status === 204 ? new Response(null, { status, headers: { "Cache-Control": "no-store", ...cors } }) : json(data, status, cors);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      return json({ error: "Something went wrong on the server. Please try again." }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

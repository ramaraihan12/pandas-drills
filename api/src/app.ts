import { SUBMISSION_KINDS } from "../../src/lib/kinds.ts";
import { normalizeCode } from "../../src/lib/normalize.ts";
import exerciseIds from "./generated/exercise-ids.json";
import { bearer, randomCode, randomId, randomSecret, sha256Hex, timingSafeEqual } from "./util.ts";

export interface Env {
  DB: D1Database;
  /** Comma-separated extra origins (local dev ports). Set in .dev.vars or the test env, never in production. */
  DEV_ORIGINS?: string;
}

export const LIMITS = {
  classLifetimeMs: 180 * 24 * 3600 * 1000,
  classesPerDay: 50,
  studentsPerClass: 60,
  submissionsPerHour: 60,
  submissionsPerClass: 4000,
  /** Expired classes removed per cleanup batch, and how many batches the daily job runs. */
  cleanupChunk: 20,
  cleanupChunkScheduled: 50,
  cleanupBatchesScheduled: 10,
  bodyBytes: 16 * 1024,
  codeBytes: 8 * 1024,
  reportAttempts: 20,
};

/**
 * D1 free allows 100,000 rows written a day. One stored submission writes at most
 * ROWS_PER_SUBMISSION rows (measured in the tests: the submission and its two indexes, the
 * sequence row, the daily counter, the class counter and the summary row). Half the budget is
 * given to submissions; the other half is left for classes, students, removals and cleanup.
 * Measured (meta.rows_written, whole batch): 8 rows for the first submission of the day, 7 for
 * later ones. That makes the cap 6,250 a day. api.test.ts fails if a schema change pushes the
 * measurement above this number.
 */
export const ROWS_PER_SUBMISSION = 8;
export const SUBMISSIONS_PER_DAY = Math.floor(50_000 / ROWS_PER_SUBMISSION);

const PROD_ORIGINS = ["https://ramaraihan.is-a.dev"];
function allowedOrigins(env: Env): Set<string> {
  return new Set([...PROD_ORIGINS, ...(env.DEV_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)]);
}
/** Bit position of each kind in student_exercise.fail_kinds. Only ever append to SUBMISSION_KINDS. */
const KIND_BIT = new Map<string, number>(SUBMISSION_KINDS.map((k, i) => [k, i]));
/** Faults of the site or the checker, not of the student's code: kept out of "most common problems". */
const SITE_FAULTS = new Set(["checker_error", "worker_error", "timeout"]);
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

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !allowedOrigins(env).has(origin)) return {};
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
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    throw new HttpError(415, "Send the request as application/json.");
  }
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
  joining_open: number;
}

async function findClass(env: Env, code: string): Promise<ClassRow | null> {
  return env.DB.prepare("SELECT id, code, name, teacher_key_hash, expires_at, joining_open FROM classes WHERE code = ? AND expires_at > ?")
    .bind(code.toUpperCase(), Date.now())
    .first<ClassRow>();
}

/**
 * Deletes expired classes with their students, submissions and summary rows, `chunk` classes
 * at a time (the expires_at index keeps the lookup cheap). Returns how many were removed.
 * This runs in the daily cron job and, as a backstop, on create, join and report.
 */
export async function cleanupExpired(env: Env, now: number, chunk = LIMITS.cleanupChunk): Promise<number> {
  const ids = (await env.DB.prepare("SELECT id FROM classes WHERE expires_at <= ? ORDER BY expires_at LIMIT ?").bind(now, chunk).all<{ id: string }>()).results.map((r) => r.id);
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(",");
  await env.DB.batch(
    ["submissions", "student_exercise", "students"]
      .map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE class_id IN (${marks})`).bind(...ids))
      .concat(env.DB.prepare(`DELETE FROM classes WHERE id IN (${marks})`).bind(...ids)),
  );
  return ids.length;
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

const LATIN = "A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F";
const NICKNAME_RE = new RegExp(`^[${LATIN}0-9 \\-_.']+$`);
const CLASS_NAME_RE = /^[\p{L}\p{N} .,:;!?()'"&+\/#_\-]+$/u;

function validNickname(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Please choose a nickname.");
  const nick = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  const length = [...nick].length;
  if (length < 1 || length > 24) throw new HttpError(400, "A nickname must be 1 to 24 characters.");
  if (!NICKNAME_RE.test(nick)) {
    throw new HttpError(400, "A nickname can use Latin letters, digits, spaces and - _ . ' only.");
  }
  return nick;
}

function validClassName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (name.length < 1 || name.length > 60) throw new HttpError(400, "The class name must be 1 to 60 characters.");
  if (!CLASS_NAME_RE.test(name) || /:\/\/|www\./i.test(name)) {
    throw new HttpError(400, "The class name can use letters, digits, spaces and basic punctuation, and no web addresses.");
  }
  return name;
}

// ---------- handlers ----------

async function createClass(request: Request, env: Env) {
  const body = await readJson(request);
  const name = validClassName(body.name);

  const now = Date.now();
  await cleanupExpired(env, now);
  await env.DB.prepare("DELETE FROM daily_counters WHERE day < ?").bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10)).run();

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
  await cleanupExpired(env, Date.now());
  const cls = await findClass(env, code);
  if (!cls) throw new HttpError(404, "There is no class with that code. It may have expired.");
  if (!cls.joining_open) throw new HttpError(403, "This class is closed to new students");

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

export interface SubmissionInput {
  classId: string;
  studentId: string;
  exerciseId: string;
  passed: boolean;
  kind: string;
  code: string;
  codeHash: string;
  now: number;
}

/**
 * All the writes for one submission, as one batch. The first statement is the only gate: it
 * inserts only while the student, the class and the whole site are under their limits, so
 * parallel requests cannot go over any of them. Every later statement runs only if the
 * statement before it changed a row (changes() is per connection, and a batch is one
 * transaction), so a refused submission leaves no trace in the counters or the summary.
 */
export function submissionStatements(db: D1Database, s: SubmissionInput): D1PreparedStatement[] {
  const day = new Date(s.now).toISOString().slice(0, 10);
  const bit = 2 ** (KIND_BIT.get(s.kind) ?? 0);
  const failBit = s.passed ? 0 : bit;
  const pass = s.passed ? 1 : 0;
  return [
    db
      .prepare(
        `INSERT INTO submissions (class_id, student_id, exercise_id, passed, kind, code, code_hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM submissions WHERE student_id = ? AND created_at > ?) < ?
            AND (SELECT submissions_stored FROM classes WHERE id = ?) < ?
            AND COALESCE((SELECT submissions FROM daily_counters WHERE day = ?), 0) < ?`,
      )
      .bind(s.classId, s.studentId, s.exerciseId, pass, s.kind, s.code, s.codeHash, s.now, s.studentId, s.now - 3600000, LIMITS.submissionsPerHour, s.classId, LIMITS.submissionsPerClass, day, SUBMISSIONS_PER_DAY),
    db
      .prepare(
        "INSERT INTO daily_counters (day, classes_created, submissions) SELECT ?, 0, 1 WHERE changes() > 0 ON CONFLICT(day) DO UPDATE SET submissions = submissions + 1",
      )
      .bind(day),
    db.prepare("UPDATE classes SET submissions_stored = submissions_stored + 1 WHERE id = ? AND changes() > 0").bind(s.classId),
    db
      .prepare(
        `INSERT INTO student_exercise (class_id, student_id, exercise_id, attempts, passed, first_pass_at, tries_to_pass, first_pass_hash, last_kind, last_at, fail_kinds)
         SELECT ?1, ?2, ?3, 1, ?4, CASE WHEN ?4 = 1 THEN ?5 END, CASE WHEN ?4 = 1 THEN 1 END, CASE WHEN ?4 = 1 THEN ?6 END, ?7, ?5, ?8 WHERE changes() > 0
         ON CONFLICT (class_id, student_id, exercise_id) DO UPDATE SET
           attempts = attempts + 1,
           tries_to_pass = CASE WHEN passed = 0 AND ?4 = 1 THEN attempts + 1 ELSE tries_to_pass END,
           first_pass_at = CASE WHEN passed = 0 AND ?4 = 1 THEN ?5 ELSE first_pass_at END,
           first_pass_hash = CASE WHEN passed = 0 AND ?4 = 1 THEN ?6 ELSE first_pass_hash END,
           passed = MAX(passed, ?4),
           last_kind = ?7,
           last_at = ?5,
           fail_kinds = fail_kinds | ?8`,
      )
      .bind(s.classId, s.studentId, s.exerciseId, pass, s.now, s.codeHash, s.kind, failBit),
  ];
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
  const results = await env.DB.batch(
    submissionStatements(env.DB, {
      classId: student.class_id,
      studentId: student.id,
      exerciseId: body.exerciseId,
      passed: body.passed,
      kind: body.kind,
      code: body.code,
      codeHash: await sha256Hex(normalizeCode(body.code)),
      now,
    }),
  );
  if (!results[0]?.meta.changes) {
    // refused: say which limit it was
    const why = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM submissions WHERE student_id = ? AND created_at > ?) >= ? AS student,
              (SELECT submissions_stored FROM classes WHERE id = ?) >= ? AS class`,
    )
      .bind(student.id, now - 3600000, LIMITS.submissionsPerHour, student.class_id, LIMITS.submissionsPerClass)
      .first<{ student: number; class: number }>();
    if (why?.student) throw new HttpError(429, "That is a lot of checks in one hour. Please wait a bit and try again.");
    if (why?.class) throw new HttpError(429, `This class has stored its limit of ${LIMITS.submissionsPerClass} checks. Your answers still work, but they are not recorded.`);
    throw new HttpError(429, "This site has reached its limit for recorded checks today. Your answers still work; recording resumes tomorrow.");
  }
  return { status: 204, data: null };
}

interface Cell {
  student_id: string;
  exercise_id: string;
  attempts: number;
  passed: number;
  first_pass_at: number | null;
  last_at: number;
  tries_to_pass: number | null;
  first_pass_hash: string | null;
  last_kind: string;
  fail_kinds: number;
}

/** Enough of the hash to tell code apart inside one class, and short enough to keep the report small. */
const HASH_CHARS = 16;

/** The report reads only the student list and the summary rows: about students + students x exercises rows. */
export function reportStatements(db: D1Database, classId: string): D1PreparedStatement[] {
  return [
    db.prepare("SELECT id, nickname, created_at FROM students WHERE class_id = ? ORDER BY nickname_norm").bind(classId),
    db
      .prepare(
        "SELECT student_id, exercise_id, attempts, passed, first_pass_at, last_at, tries_to_pass, first_pass_hash, last_kind, fail_kinds FROM student_exercise WHERE class_id = ?",
      )
      .bind(classId),
  ];
}

async function report(request: Request, env: Env, code: string) {
  await cleanupExpired(env, Date.now());
  const cls = await requireTeacher(request, env, code);
  const [students, cells] = await env.DB.batch(reportStatements(env.DB, cls.id));
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const byStudent = new Map<string, Record<string, unknown>>();
  const perExercise: Record<string, { attempted: number; passed: number; failures: Record<string, number> }> = Object.fromEntries(
    exerciseIds.map((id) => [id, { attempted: 0, passed: 0, failures: {} }]),
  );
  for (const c of (cells?.results ?? []) as unknown as Cell[]) {
    const mine = byStudent.get(c.student_id) ?? {};
    const passed = c.passed === 1;
    mine[c.exercise_id] = {
      attempts: c.attempts,
      passed,
      firstPassAt: iso(c.first_pass_at),
      lastAt: iso(c.last_at),
      lastKind: c.last_kind,
      triesToPass: passed ? c.tries_to_pass : null,
      firstPassHash: c.first_pass_hash ? c.first_pass_hash.slice(0, HASH_CHARS) : null,
    };
    byStudent.set(c.student_id, mine);
    const agg = perExercise[c.exercise_id];
    if (agg) {
      agg.attempted += 1;
      if (passed) agg.passed += 1;
      // distinct students per kind
      for (const [kind, i] of KIND_BIT) {
        if (!SITE_FAULTS.has(kind) && kind !== "passed" && Math.floor(c.fail_kinds / 2 ** i) % 2 === 1) agg.failures[kind] = (agg.failures[kind] ?? 0) + 1;
      }
    }
  }
  return {
    status: 200,
    data: {
      name: cls.name,
      expiresAt: new Date(cls.expires_at).toISOString(),
      joiningOpen: cls.joining_open === 1,
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
    env.DB.prepare("DELETE FROM student_exercise WHERE class_id = ?").bind(cls.id),
    env.DB.prepare("DELETE FROM students WHERE class_id = ?").bind(cls.id),
    env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(cls.id),
  ]);
  return { status: 204, data: null };
}

async function removeStudent(request: Request, env: Env, code: string, studentId: string) {
  const cls = await requireTeacher(request, env, code);
  const exists = await env.DB.prepare("SELECT 1 AS x FROM students WHERE id = ? AND class_id = ?").bind(studentId, cls.id).first();
  if (!exists) throw new HttpError(404, "That student is not in this class.");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE classes SET submissions_stored = MAX(0, submissions_stored - (SELECT COALESCE(SUM(attempts), 0) FROM student_exercise WHERE class_id = ?1 AND student_id = ?2)) WHERE id = ?1",
    ).bind(cls.id, studentId),
    env.DB.prepare("DELETE FROM submissions WHERE class_id = ? AND student_id = ?").bind(cls.id, studentId),
    env.DB.prepare("DELETE FROM student_exercise WHERE class_id = ? AND student_id = ?").bind(cls.id, studentId),
    env.DB.prepare("DELETE FROM students WHERE class_id = ? AND id = ?").bind(cls.id, studentId),
  ]);
  return { status: 204, data: null };
}

async function setJoining(request: Request, env: Env, code: string) {
  const cls = await requireTeacher(request, env, code);
  const body = await readJson(request);
  if (typeof body.open !== "boolean") throw new HttpError(400, "`open` must be true or false.");
  await env.DB.prepare("UPDATE classes SET joining_open = ? WHERE id = ?").bind(body.open ? 1 : 0, cls.id).run();
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
  hit = /^\/classes\/([A-Za-z0-9]{1,12})\/(join|report|submissions|joining)$/.exec(path);
  if (hit?.[1]) {
    if (hit[2] === "join" && m === "POST") return joinClass(request, env, hit[1]);
    if (hit[2] === "joining" && m === "POST") return setJoining(request, env, hit[1]);
    if (hit[2] === "report" && m === "GET") return report(request, env, hit[1]);
    if (hit[2] === "submissions" && m === "GET") return attempts(request, env, hit[1], url);
  }
  hit = /^\/classes\/([A-Za-z0-9]{1,12})\/students\/([0-9a-f]{16})$/.exec(path);
  if (hit?.[1] && hit[2] && m === "DELETE") return removeStudent(request, env, hit[1], hit[2]);
  throw new HttpError(404, "Nothing here.");
}

/** The daily cron job: bounded batches of expired classes, so it stays inside the free plan. */
export async function scheduledCleanup(env: Env, now = Date.now()): Promise<number> {
  let total = 0;
  for (let i = 0; i < LIMITS.cleanupBatchesScheduled; i++) {
    const n = await cleanupExpired(env, now, LIMITS.cleanupChunkScheduled);
    total += n;
    if (n < LIMITS.cleanupChunkScheduled) break;
  }
  await env.DB.prepare("DELETE FROM daily_counters WHERE day < ?").bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10)).run();
  return total;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    if (origin && !allowedOrigins(env).has(origin)) return json({ error: "That origin is not allowed." }, 403, {});
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const { status, data } = await route(request, env);
      return status === 204 ? new Response(null, { status, headers: { "Cache-Control": "no-store", ...cors } }) : json(data, status, cors);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      return json({ error: "Something went wrong on the server. Please try again." }, 500, cors);
    }
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(scheduledCleanup(env));
  },
} satisfies ExportedHandler<Env>;

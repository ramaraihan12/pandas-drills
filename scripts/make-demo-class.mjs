// Writes public/demo/report.json: a made-up class for the "See a demo class" page.
// Everything is generated from a fixed seed, so running it again gives the same file.
// Usage: node scripts/make-demo-class.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 20261118;
const STUDENTS = 18;

// mulberry32, a tiny seeded random number generator
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (weighted) => {
  const total = weighted.reduce((n, [, w]) => n + w, 0);
  let x = rand() * total;
  for (const [value, w] of weighted) if ((x -= w) < 0) return value;
  return weighted[weighted.length - 1][0];
};

const exercises = readdirSync(join(root, "exercises"))
  .filter((n) => n !== "data" && statSync(join(root, "exercises", n)).isDirectory())
  .sort();
const difficulty = Object.fromEntries(
  exercises.map((id) => [id, /^difficulty:\s*(\w+)/m.exec(readFileSync(join(root, "exercises", id, "prompt.md"), "utf8"))?.[1] ?? "medium"]),
);
// chance that one attempt passes for an average student
const BASE = { easy: 0.93, medium: 0.65, hard: 0.5 };
// the harder topics get a lower chance on top of their difficulty label
const EXTRA = { "09-merge": 0.65, "10-pivot-table": 0.62, "11-dates": 0.58, "13-apply-and-map": 0.8, "14-top-n-per-group": 0.7, "15-clean-up-inventory": 0.7 };

// what goes wrong in each exercise, most common first
const FAILS = {
  default: [["wrong_values", 3], ["exception", 2], ["wrong_columns", 2], ["wrong_shape", 2], ["syntax", 1]],
  "09-merge": [["wrong_shape", 5], ["wrong_columns", 3], ["exception", 2], ["wrong_values", 1]],
  "10-pivot-table": [["wrong_index", 4], ["wrong_columns", 3], ["wrong_values", 2], ["exception", 1]],
  "11-dates": [["exception", 4], ["wrong_dtype", 4], ["wrong_values", 2], ["syntax", 1]],
  "06-missing-values": [["wrong_shape", 3], ["wrong_values", 3], ["exception", 1]],
  "14-top-n-per-group": [["wrong_order", 3], ["wrong_shape", 3], ["wrong_values", 2], ["exception", 1]],
};

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const nick = (n) => `Student ${String(n).padStart(2, "0")}`;
const START = Date.parse("2026-11-10T09:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

// fixed storylines on top of the random ones
const STUCK = { "Student 07": { "09-merge": 5 }, "Student 13": { "11-dates": 4 }, "Student 03": { "10-pivot-table": 3 } };
const SAME_PAIR = { exercise: "07-groupby-agg", students: ["Student 04", "Student 15"] };

const students = [];
const perExercise = Object.fromEntries(exercises.map((id) => [id, { attempted: 0, passed: 0, failures: {} }]));

for (let n = 1; n <= STUDENTS; n++) {
  const name = nick(n);
  const skill = 0.5 + rand() * 0.5; // 0.5 to 1.0
  // some students stop part-way through: the later exercises are then "not tried"
  const reach = rand() < 0.45 ? 8 + Math.floor(rand() * 6) : exercises.length;
  const joined = START + Math.floor(rand() * 40) * 60_000;
  let clock = joined + 3 * 60_000;
  const results = {};
  exercises.forEach((id, idx) => {
    const stuckTries = STUCK[name]?.[id];
    if (idx >= reach && stuckTries === undefined) return;
    const p = Math.min(0.97, BASE[difficulty[id]] * (EXTRA[id] ?? 1) * skill);
    const fails = FAILS[id] ?? FAILS.default;
    const isPair = SAME_PAIR.exercise === id && SAME_PAIR.students.includes(name);
    const limit = stuckTries ?? 6;
    const seq = []; // the kind of each attempt, in order, with the time it was made
    for (let i = 0; i < limit; i++) {
      clock += (1 + Math.floor(rand() * 6)) * 60_000;
      const win = stuckTries === undefined && (rand() < p || (isPair && i === 1));
      seq.push({ kind: win ? "passed" : pick(fails), at: clock });
      if (win) break;
    }
    const passed = seq.at(-1).kind === "passed";
    if (!passed && stuckTries === undefined && rand() < 0.8) seq.length = Math.min(seq.length, 2); // gave up early
    if (passed && rand() < 0.1) {
      clock += 2 * 60_000;
      seq.push({ kind: "passed", at: clock }); // checked again after passing
    }
    for (const a of seq) if (a.kind !== "passed") perExercise[id].failures[a.kind] = (perExercise[id].failures[a.kind] ?? 0) + 1;
    const passIndex = seq.findIndex((a) => a.kind === "passed");
        results[id] = {
      attempts: seq.length,
      passed,
      firstPassAt: passed ? iso(seq[passIndex].at) : null,
      lastAt: iso(seq.at(-1).at),
      lastKind: seq.at(-1).kind,
      triesToPass: passed ? passIndex + 1 : null,
      firstPassHash: passed ? hash(isPair ? `${id}:shared answer` : `${id}:${name}`) : null,
    };
    perExercise[id].attempted++;
    if (passed) perExercise[id].passed++;
    clock += 60_000;
  });
  students.push({ id: `demo-${String(n).padStart(2, "0")}`, nickname: name, joinedAt: iso(joined), results });
}

const report = {
  name: "Demo class: pandas workshop",
  expiresAt: "2027-05-01T00:00:00.000Z",
  exercises,
  students,
  perExercise,
};
const out = join(root, "public", "demo", "report.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
console.log(`wrote ${students.length} students, ${exercises.length} exercises to public/demo/report.json`);

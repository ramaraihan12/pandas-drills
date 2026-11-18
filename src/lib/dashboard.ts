// Pure functions behind the teacher dashboard: no DOM, no network. They take a Report
// (from the API or from the demo file) and return plain data for the page to draw.
import { kindLabel } from "./kinds.ts";
import type { Report, ReportCell } from "./api.ts";

export type CellState = "first" | "several" | "open" | "none";

export const STATE_INFO: Record<CellState, { symbol: string; short: string; long: string }> = {
  first: { symbol: "\u2713", short: "first try", long: "passed on the first try" },
  several: { symbol: "\u2713", short: "passed after tries", long: "passed after several tries" },
  open: { symbol: "\u2717", short: "not passed yet", long: "tried, not passed yet" },
  none: { symbol: "\u2013", short: "not tried", long: "not tried" },
};

/** Attempts up to and including the first pass. Older reports only have the total. */
export function triesToPass(cell: ReportCell): number {
  return cell.triesToPass ?? cell.attempts;
}

export function cellState(cell: ReportCell | undefined): CellState {
  if (!cell || cell.attempts === 0) return "none";
  if (!cell.passed) return "open";
  return triesToPass(cell) <= 1 ? "first" : "several";
}

/** The text in a heatmap cell: a symbol and, when it helps, a number. */
export function cellText(cell: ReportCell | undefined): string {
  const state = cellState(cell);
  if (!cell || state === "none" || state === "first") return STATE_INFO[state].symbol;
  return `${STATE_INFO[state].symbol} ${state === "several" ? triesToPass(cell) : cell.attempts}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A full sentence for screen readers and tooltips. */
export function cellLabel(nickname: string, exerciseId: string, cell: ReportCell | undefined): string {
  const state = cellState(cell);
  const where = `${nickname}, ${exerciseName(exerciseId)}`;
  if (!cell || state === "none") return `${where}: not tried.`;
  if (state === "first") return `${where}: passed on the first try.`;
  if (state === "several") return `${where}: passed after ${plural(triesToPass(cell), "try")}.`;
  return `${where}: not passed yet after ${plural(cell.attempts, "attempt")}. Last result: ${kindLabel(cell.lastKind)}.`;
}

/** "01-select-columns" becomes "01 select columns". */
export function exerciseName(id: string): string {
  return id.replace(/-/g, " ");
}

export interface ExerciseStats {
  id: string;
  attempted: number;
  passed: number;
  /** passed / attempted, or null when nobody has tried it. */
  rate: number | null;
  /** The most common ways attempts failed, most common first. */
  topFailures: { kind: string; label: string; count: number }[];
}

export function exerciseStats(report: Report, top = 3): ExerciseStats[] {
  return report.exercises.map((id) => {
    const p = report.perExercise[id] ?? { attempted: 0, passed: 0 };
    const failures = Object.entries(p.failures ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([kind, count]) => ({ kind, label: kindLabel(kind), count }));
    return { id, attempted: p.attempted, passed: p.passed, rate: p.attempted ? p.passed / p.attempted : null, topFailures: failures };
  });
}

export interface StuckEntry {
  studentId: string;
  nickname: string;
  exerciseId: string;
  attempts: number;
  lastAt: string | null;
  lastKind: string;
}

/** Students with `min` or more attempts on an exercise and no pass, the most recently active first. */
export function stuckStudents(report: Report, min = 3): StuckEntry[] {
  const out: StuckEntry[] = [];
  for (const s of report.students) {
    for (const exerciseId of report.exercises) {
      const c = s.results[exerciseId];
      if (c && !c.passed && c.attempts >= min) {
        out.push({ studentId: s.id, nickname: s.nickname, exerciseId, attempts: c.attempts, lastAt: c.lastAt ?? null, lastKind: c.lastKind });
      }
    }
  }
  return out.sort((a, b) => Date.parse(b.lastAt ?? "") - Date.parse(a.lastAt ?? "") || a.nickname.localeCompare(b.nickname) || a.exerciseId.localeCompare(b.exerciseId));
}

export interface SameCodeGroup {
  exerciseId: string;
  nicknames: string[];
}

/** Groups of two or more students whose first passing code hashes the same, per exercise. */
export function sameCodeGroups(report: Report): SameCodeGroup[] {
  const out: SameCodeGroup[] = [];
  for (const exerciseId of report.exercises) {
    const byHash = new Map<string, string[]>();
    for (const s of report.students) {
      const h = s.results[exerciseId]?.firstPassHash;
      if (h) byHash.set(h, [...(byHash.get(h) ?? []), s.nickname]);
    }
    for (const names of byHash.values()) if (names.length >= 2) out.push({ exerciseId, nicknames: names.sort((a, b) => a.localeCompare(b)) });
  }
  return out;
}

// ---------- CSV ----------

/** Quotes a field when needed, and defuses spreadsheet formulas by prefixing a single quote. */
export function csvField(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = ["nickname", "exercise", "attempts", "passed", "first_pass_time"];

/** One row per student and exercise, including exercises that were not tried. */
export function resultsCsv(report: Report): string {
  const rows: string[][] = [CSV_HEADER];
  for (const s of report.students) {
    for (const ex of report.exercises) {
      const c = s.results[ex];
      rows.push([s.nickname, ex, String(c?.attempts ?? 0), c?.passed ? "yes" : "no", c?.firstPassAt ?? ""]);
    }
  }
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

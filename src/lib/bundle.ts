import type { Bundle, Difficulty, Exercise } from "./types.ts";

export interface FrontMatter {
  meta: Record<string, string>;
  body: string;
}

/** Minimal front matter reader: `key: value` lines between two `---` lines. */
export function parseFrontMatter(text: string): FrontMatter {
  const src = text.replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) {
    throw new Error("prompt.md must start with a front matter block (---)");
  }
  const end = src.indexOf("\n---\n", 4);
  if (end === -1) throw new Error("front matter is not closed with ---");
  const meta: Record<string, string> = {};
  for (const line of src.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i === -1) throw new Error(`bad front matter line: "${line}"`);
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(end + 5).trim() };
}

export interface ExerciseFiles {
  prompt: string;
  starter: string;
  solution: string;
  check: string;
}

const NEEDED = ["id", "title", "topic", "difficulty", "data"];

export function buildExercise(folder: string, files: ExerciseFiles): Exercise {
  const { meta, body } = parseFrontMatter(files.prompt);
  for (const key of NEEDED) {
    if (!meta[key]) throw new Error(`${folder}: front matter is missing "${key}"`);
  }
  if (meta.id !== folder) {
    throw new Error(`${folder}: front matter id "${meta.id}" does not match the folder name`);
  }
  if (meta.difficulty !== "easy" && meta.difficulty !== "medium") {
    throw new Error(`${folder}: difficulty must be easy or medium, got "${meta.difficulty}"`);
  }
  if (!body) throw new Error(`${folder}: the prompt has no text`);
  for (const name of ["starter", "solution", "check"] as const) {
    if (!files[name].trim()) throw new Error(`${folder}: ${name}.py is empty`);
  }
  const data = (meta.data ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: meta.id!,
    title: meta.title!,
    topic: meta.topic!,
    difficulty: meta.difficulty as Difficulty,
    data,
    prompt: body,
    starter: files.starter,
    solution: files.solution,
    check: files.check,
  };
}

export function assembleBundle(exercises: Exercise[], dataFiles: Record<string, string>): Bundle {
  const seen = new Set<string>();
  const used: Record<string, string> = {};
  const sorted = [...exercises].sort((a, b) => a.id.localeCompare(b.id));
  for (const ex of sorted) {
    if (seen.has(ex.id)) throw new Error(`duplicate exercise id ${ex.id}`);
    seen.add(ex.id);
    for (const name of ex.data) {
      const csv = dataFiles[name];
      if (csv === undefined) throw new Error(`${ex.id}: data file "${name}" not found in exercises/data/`);
      used[name] = csv.replace(/\r\n/g, "\n");
    }
  }
  return { version: 1, exercises: sorted, data: used };
}

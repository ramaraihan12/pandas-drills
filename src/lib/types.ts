export type Difficulty = "easy" | "medium";

export interface Exercise {
  id: string;
  title: string;
  topic: string;
  difficulty: Difficulty;
  /** CSV file names (keys of Bundle.data) loaded as DataFrames named after the file. */
  data: string[];
  /** Markdown body of prompt.md */
  prompt: string;
  starter: string;
  solution: string;
  check: string;
}

export interface Bundle {
  version: 1;
  exercises: Exercise[];
  data: Record<string, string>;
}

export interface ErrorInfo {
  type: string;
  line: number | null;
  text?: string;
  code_line?: string;
  offset?: number | null;
  columns?: Record<string, string[]>;
  missing?: string[];
  suggestions?: Record<string, string>;
  tuple_hint?: boolean;
  /** A KeyError raised by the student's own dict or list, not by pandas. */
  dict_key?: string;
}

/** What drills.run() returns (parsed from its JSON). */
export interface GradeResult {
  passed: boolean;
  kind: string;
  message: string;
  stdout: string;
  preview: string | null;
  error: ErrorInfo | null;
  /** Plain-words warnings and hints (for example about inplace=True). Shown with a wrong answer. */
  notes?: string[];
}

export type RunMode = "run" | "check";

export interface RunRequest {
  mode: RunMode;
  code: string;
  data: Record<string, string>;
  solution: string;
  check: string;
}

/** Results made on the page side, not by Python. */
export interface ClientFailure {
  kind: "timeout" | "worker_error";
  message: string;
}

import type { ClientFailure, ErrorInfo, GradeResult } from "./types.ts";

export type Tone = "pass" | "fail" | "error" | "info";

export interface Feedback {
  tone: Tone;
  title: string;
  /** Plain paragraphs. */
  lines: string[];
  /** Monospace block, for example the offending line of code. */
  code?: string;
  /** The student's own print() output. */
  stdout: string;
  /** A text preview of `result`. */
  preview: string | null;
}

const TITLES: Record<string, string> = {
  wrong_type: "Not the right kind of result",
  wrong_shape: "Not the right number of rows",
  wrong_columns: "The columns are not right",
  wrong_values: "Some values are different",
  wrong_dtype: "The data type is not right",
  wrong_index: "The row labels are not right",
  wrong_order: "The order is not right",
  checker_error: "The checker had a problem",
};

function listColumns(columns: Record<string, string[]> | undefined): string[] {
  if (!columns) return [];
  return Object.entries(columns).map(([table, cols]) => `Columns in \`${table}\`: ${cols.join(", ")}`);
}

function describeError(err: ErrorInfo): { title: string; lines: string[]; code?: string } {
  const where = err.line ? ` on line ${err.line}` : "";
  const code = err.code_line ? (err.line ? `${err.line} | ${err.code_line}` : err.code_line) : undefined;

  if (err.type === "SyntaxError") {
    return {
      title: `Syntax error${where}`,
      lines: [
        `Python could not read your code: ${err.text ?? "invalid syntax"}.`,
        "Check brackets, quotes and colons near that line (the mistake is sometimes on the line before).",
      ],
      code,
    };
  }
  if (err.type === "KeyError" && err.dict_key !== undefined) {
    return {
      title: `KeyError${where}: key not found`,
      lines: [
        `'${err.dict_key}' is not a key in your dictionary (or mapping).`,
        "Add that key to the dictionary, or check the spelling of the keys you wrote.",
      ],
      code,
    };
  }
  if (err.type === "KeyError" && err.tuple_hint) {
    return {
      title: `KeyError${where}: several names without a list`,
      lines: [
        "To pick several columns, put the names inside a list: use two pairs of brackets, like `df[[\"a\", \"b\"]]`.",
        ...listColumns(err.columns),
      ],
      code,
    };
  }
  if ((err.type === "KeyError" || err.type === "AttributeError") && err.missing?.length) {
    const key = err.missing.map((k) => `'${k}'`).join(", ");
    const lines: string[] = [];
    const sugg = Object.entries(err.suggestions ?? {});
    for (const [k, s] of sugg) lines.push(`There is no column '${k}'. Did you mean '${s}'?`);
    if (!sugg.length) lines.push(`There is no column ${key}. Column names must match exactly, including capital letters.`);
    lines.push(...listColumns(err.columns));
    return { title: `${err.type}${where}: unknown column ${key}`, lines, code };
  }
  const lines = [err.text && err.text !== "" ? `${err.type}: ${err.text}` : err.type];
  if (err.type === "NameError") lines.push("A name is used before it exists. Check the spelling; Python cares about capital letters.");
  return { title: `${err.type}${where}`, lines, code };
}

export function formatFeedback(res: GradeResult, mode: "run" | "check"): Feedback {
  const fb = formatMain(res, mode);
  // warnings and hints help most when something is wrong
  if (res.notes?.length && fb.tone !== "pass") fb.lines = [...fb.lines, ...res.notes];
  return fb;
}

function formatMain(res: GradeResult, mode: "run" | "check"): Feedback {
  const base = { stdout: res.stdout ?? "", preview: res.preview ?? null };

  if (res.kind === "passed") {
    return {
      ...base,
      tone: "pass",
      title: "Correct",
      lines: ["Your result matches the reference answer on this data. Nice work."],
    };
  }
  if (res.kind === "syntax" && res.error) {
    return { ...base, tone: "error", ...describeError(res.error) };
  }
  if (res.kind === "exception" && res.error) {
    return { ...base, tone: "error", ...describeError(res.error) };
  }
  if (res.kind === "no_result") {
    return {
      ...base,
      tone: mode === "run" ? "info" : "fail",
      title: "No `result` yet",
      lines: [
        "Your code ran, but it did not create a variable named `result`.",
        "Put your answer in it, for example `result = orders[...]`.",
      ],
    };
  }
  if (res.kind === "ran") {
    return {
      ...base,
      tone: "info",
      title: "Your code ran",
      lines: ["This is what `result` looks like. Press Check to compare it with the expected answer."],
    };
  }
  const title = TITLES[res.kind] ?? "Not quite";
  const lines = res.message.split("\n").filter((l) => l.trim() !== "");
  const [first, ...rest] = lines;
  const tone: Tone = res.kind === "checker_error" ? "error" : "fail";
  // keep "Your row / Expected row" lines in a code block
  const codeLines = rest.filter((l) => /^(Your row|Expected row):/.test(l));
  const plain = rest.filter((l) => !codeLines.includes(l));
  return {
    ...base,
    tone,
    title,
    lines: first ? [first, ...plain] : plain,
    code: codeLines.length ? codeLines.join("\n") : undefined,
  };
}

export function formatClientFailure(f: ClientFailure, seconds: number): Feedback {
  if (f.kind === "timeout") {
    return {
      tone: "error",
      title: "That took too long",
      lines: [
        `Your code ran for more than ${seconds} seconds, so I stopped it.`,
        "Look for a loop that never ends, or a step that repeats far too many times. Python restarts in a moment.",
      ],
      stdout: "",
      preview: null,
    };
  }
  return {
    tone: "error",
    title: "Python stopped working",
    lines: [f.message || "The Python engine hit a problem.", "Reload the page if this keeps happening."],
    stdout: "",
    preview: null,
  };
}

/** Short text for a loading bar. */
export function formatProgress(loadedBytes: number, estimateBytes: number): { percent: number; label: string } {
  const mb = (n: number) => (n / 1_000_000).toFixed(1);
  const percent = Math.min(99, Math.round((loadedBytes / Math.max(estimateBytes, 1)) * 100));
  return { percent, label: `${mb(loadedBytes)} MB downloaded` };
}

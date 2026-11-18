// The result kinds a Check can end with. The grader (grader/drills.py) produces the
// first group, the page itself produces the last two. The class API accepts only these.
export const GRADER_KINDS = [
  "passed",
  "syntax",
  "exception",
  "no_result",
  "checker_error",
  "wrong_type",
  "wrong_shape",
  "wrong_columns",
  "wrong_values",
  "wrong_dtype",
  "wrong_index",
  "wrong_order",
] as const;

export const CLIENT_KINDS = ["timeout", "worker_error"] as const;

export const SUBMISSION_KINDS: readonly string[] = [...GRADER_KINDS, ...CLIENT_KINDS];

/** Plain words for each kind, shown to a teacher. They mirror the titles students see in the feedback. */
export const KIND_LABEL: Record<string, string> = {
  passed: "passed",
  syntax: "syntax error",
  exception: "error while running (for example an unknown column)",
  no_result: "no result variable",
  checker_error: "checker problem",
  wrong_type: "wrong kind of result",
  wrong_shape: "wrong number of rows",
  wrong_columns: "wrong columns",
  wrong_values: "wrong values",
  wrong_dtype: "wrong data type",
  wrong_index: "wrong row labels",
  wrong_order: "wrong order",
  timeout: "took too long",
  worker_error: "page error",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

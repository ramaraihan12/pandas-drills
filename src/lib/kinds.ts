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

import { describe, expect, it } from "vitest";
import { formatClientFailure, formatFeedback, formatProgress } from "../src/lib/feedback.ts";
import type { GradeResult } from "../src/lib/types.ts";

const base: GradeResult = { passed: false, kind: "ok", message: "", stdout: "", preview: null, error: null };

describe("formatFeedback", () => {
  it("celebrates a pass", () => {
    const f = formatFeedback({ ...base, passed: true, kind: "passed" }, "check");
    expect(f.tone).toBe("pass");
    expect(f.title).toBe("Correct");
  });

  it("shows the line number of a syntax error", () => {
    const f = formatFeedback(
      { ...base, kind: "syntax", error: { type: "SyntaxError", line: 3, text: "'(' was never closed", code_line: "x = (1" } },
      "check",
    );
    expect(f.title).toBe("Syntax error on line 3");
    expect(f.code).toBe("3 | x = (1");
  });

  it("explains a KeyError with the closest column and the real column names", () => {
    const f = formatFeedback(
      {
        ...base,
        kind: "exception",
        error: {
          type: "KeyError",
          line: 1,
          missing: ["produkt"],
          suggestions: { produkt: "product" },
          columns: { orders: ["order_id", "product", "quantity"] },
        },
      },
      "check",
    );
    expect(f.tone).toBe("error");
    expect(f.title).toContain("unknown column 'produkt'");
    expect(f.lines).toContain("There is no column 'produkt'. Did you mean 'product'?");
    expect(f.lines).toContain("Columns in `orders`: order_id, product, quantity");
  });

  it("still lists columns when nothing is close", () => {
    const f = formatFeedback(
      { ...base, kind: "exception", error: { type: "KeyError", line: 2, missing: ["zzz"], suggestions: {}, columns: { t: ["a", "b"] } } },
      "check",
    );
    expect(f.lines[0]).toMatch(/There is no column 'zzz'/);
    expect(f.lines.join(" ")).toContain("a, b");
  });

  it("explains the tuple mistake", () => {
    const f = formatFeedback({ ...base, kind: "exception", error: { type: "KeyError", line: 1, tuple_hint: true, columns: {} } }, "check");
    expect(f.lines[0]).toMatch(/inside a list/);
  });

  it("formats other runtime errors with the line", () => {
    const f = formatFeedback(
      { ...base, kind: "exception", error: { type: "ZeroDivisionError", line: 2, text: "division by zero", code_line: "b = a / 0" } },
      "check",
    );
    expect(f.title).toBe("ZeroDivisionError on line 2");
    expect(f.lines[0]).toBe("ZeroDivisionError: division by zero");
  });

  it("does not call a dictionary key a column", () => {
    const f = formatFeedback(
      { ...base, kind: "exception", error: { type: "KeyError", line: 5, text: "returned", code_line: "codes[s]", dict_key: "returned" } },
      "check",
    );
    expect(f.lines[0]).toBe("'returned' is not a key in your dictionary (or mapping).");
    expect(f.lines.join(" ")).not.toContain("no column");
  });

  it("adds warnings and hints to a wrong answer but not to a pass", () => {
    const notes = ["Hint: you use `inplace=True`."];
    const wrong = formatFeedback({ ...base, kind: "wrong_values", message: "different", notes }, "check");
    expect(wrong.lines).toContain(notes[0]);
    const ok = formatFeedback({ ...base, passed: true, kind: "passed", notes }, "check");
    expect(ok.lines).not.toContain(notes[0]);
  });

  it("asks for `result` when it is missing", () => {
    expect(formatFeedback({ ...base, kind: "no_result" }, "check").tone).toBe("fail");
    expect(formatFeedback({ ...base, kind: "no_result" }, "run").tone).toBe("info");
  });

  it("splits a values message and keeps the two rows in a code block", () => {
    const f = formatFeedback(
      { ...base, kind: "wrong_values", message: "Shapes match.\nYour row:     a=1\nExpected row: a=2" },
      "check",
    );
    expect(f.title).toBe("Some values are different");
    expect(f.lines).toEqual(["Shapes match."]);
    expect(f.code).toBe("Your row:     a=1\nExpected row: a=2");
  });

  it("keeps the student's print output and result preview", () => {
    const f = formatFeedback({ ...base, kind: "ran", stdout: "hi\n", preview: "DataFrame: 3 rows" }, "run");
    expect(f.stdout).toBe("hi\n");
    expect(f.preview).toBe("DataFrame: 3 rows");
    expect(f.tone).toBe("info");
  });

  it("covers the other wrong kinds", () => {
    for (const kind of ["wrong_type", "wrong_shape", "wrong_columns", "wrong_dtype", "wrong_index", "wrong_order"]) {
      const f = formatFeedback({ ...base, kind, message: "msg" }, "check");
      expect(f.tone).toBe("fail");
      expect(f.title).not.toBe("Not quite");
    }
  });
});

describe("formatClientFailure", () => {
  it("explains a timeout with the limit", () => {
    const f = formatClientFailure({ kind: "timeout", message: "" }, 10);
    expect(f.title).toBe("That took too long");
    expect(f.lines[0]).toContain("10 seconds");
  });
  it("reports a worker error", () => {
    expect(formatClientFailure({ kind: "worker_error", message: "boom" }, 10).lines[0]).toBe("boom");
  });
});

describe("formatProgress", () => {
  it("never shows 100 before the engine is ready", () => {
    expect(formatProgress(80_000_000, 50_000_000).percent).toBe(99);
  });
  it("shows megabytes", () => {
    expect(formatProgress(12_500_000, 50_000_000)).toEqual({ percent: 25, label: "12.5 MB downloaded" });
  });
});

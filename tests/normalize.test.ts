import { describe, expect, it } from "vitest";
import { normalizeCode } from "../src/lib/normalize.ts";

describe("normalizeCode", () => {
  it("drops comments, blank lines and trailing spaces", () => {
    expect(normalizeCode("# top\nx = 1   # why\n\n   \ny = 2   \n")).toBe("x = 1\ny = 2");
  });
  it("collapses runs of spaces but keeps indentation", () => {
    expect(normalizeCode("result  =   df[  'a' ]\nif x:\n    y  =  1")).toBe("result = df[ 'a' ]\nif x:\n    y = 1");
  });
  it("leaves strings alone, including a # and double spaces inside", () => {
    expect(normalizeCode('s  =  "a  # b"   # real comment')).toBe('s = "a  # b"');
    expect(normalizeCode("s = 'it\\'s  # ok'")).toBe("s = 'it\\'s  # ok'");
  });
  it("keeps triple-quoted strings as written, blank lines included", () => {
    expect(normalizeCode('d = """a  \n\n# b\n  c"""  \n')).toBe('d = """a  \n\n# b\n  c"""');
  });
  it("treats CRLF like LF and tabs between tokens like spaces", () => {
    expect(normalizeCode("a\t=\t1\r\nb = 2\r\n")).toBe("a = 1\nb = 2");
  });
  it("keeps differences that matter", () => {
    expect(normalizeCode("x = df['a']")).not.toBe(normalizeCode('x = df["a"]'));
    expect(normalizeCode("x = a\ny = b")).not.toBe(normalizeCode("y = b\nx = a"));
  });
  it("is stable and handles empty input", () => {
    const once = normalizeCode("a  =  1 # c\n\n b = 2");
    expect(normalizeCode(once)).toBe(once);
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode("# only a comment\n")).toBe("");
  });
  it("does not let an unterminated quote swallow the rest", () => {
    expect(normalizeCode("x = 'oops\ny  =  2")).toBe("x = 'oops\ny = 2");
  });
});

describe("normalizeCode on hostile input", () => {
  it("stays fast on 8 KB of whitespace", () => {
    const inputs = [
      " ".repeat(8192) + "x",
      "x" + " ".repeat(8190) + "y",
      "a =" + " \t".repeat(4000) + "\n",
      ("x" + " ".repeat(60) + "\n").repeat(130),
      " ".repeat(8192),
    ];
    for (const text of inputs) {
      const t0 = performance.now();
      normalizeCode(text);
      expect(performance.now() - t0).toBeLessThan(100);
    }
    expect(normalizeCode("x = 1" + " ".repeat(8000) + "\n")).toBe("x = 1");
  });
});

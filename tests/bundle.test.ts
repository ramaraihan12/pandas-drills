import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleBundle, buildExercise, parseFrontMatter } from "../src/lib/bundle.ts";
import { readBundle } from "../scripts/read-exercises.ts";

const files = { prompt: "", starter: "result = 1\n", solution: "result = 2\n", check: "def check(r, e):\n    pass\n" };
const prompt = (extra = "") =>
  `---\nid: 01-demo\ntitle: Demo\ntopic: selecting\ndifficulty: easy\ndata: orders.csv, customers.csv\n${extra}---\n\nDo the thing.\n`;

describe("parseFrontMatter", () => {
  it("splits meta and body", () => {
    const { meta, body } = parseFrontMatter(prompt());
    expect(meta.id).toBe("01-demo");
    expect(meta.data).toBe("orders.csv, customers.csv");
    expect(body).toBe("Do the thing.");
  });
  it("copes with windows line endings", () => {
    expect(parseFrontMatter(prompt().replace(/\n/g, "\r\n")).meta.title).toBe("Demo");
  });
  it("rejects a file with no front matter", () => {
    expect(() => parseFrontMatter("just text")).toThrow(/front matter/);
  });
  it("rejects an unclosed block", () => {
    expect(() => parseFrontMatter("---\nid: x\n")).toThrow(/not closed/);
  });
});

describe("buildExercise", () => {
  it("builds an exercise and splits the data list", () => {
    const ex = buildExercise("01-demo", { ...files, prompt: prompt() });
    expect(ex.data).toEqual(["orders.csv", "customers.csv"]);
    expect(ex.difficulty).toBe("easy");
    expect(ex.prompt).toBe("Do the thing.");
  });
  it("checks the id against the folder name", () => {
    expect(() => buildExercise("02-other", { ...files, prompt: prompt() })).toThrow(/does not match/);
  });
  it("requires every front matter field", () => {
    const p = prompt().replace("topic: selecting\n", "");
    expect(() => buildExercise("01-demo", { ...files, prompt: p })).toThrow(/missing "topic"/);
  });
  it("rejects an unknown difficulty", () => {
    const p = prompt().replace("easy", "hard");
    expect(() => buildExercise("01-demo", { ...files, prompt: p })).toThrow(/difficulty/);
  });
  it("rejects an empty solution", () => {
    expect(() => buildExercise("01-demo", { ...files, prompt: prompt(), solution: " \n" })).toThrow(/solution.py is empty/);
  });
});

describe("assembleBundle", () => {
  const ex = (id: string, data: string[] = ["a.csv"]) => ({ ...buildExercise("01-demo", { ...files, prompt: prompt() }), id, data });
  it("sorts by id and keeps only the data files in use", () => {
    const b = assembleBundle([ex("02-b"), ex("01-a")], { "a.csv": "x\n1\n", "unused.csv": "y\n" });
    expect(b.exercises.map((e) => e.id)).toEqual(["01-a", "02-b"]);
    expect(Object.keys(b.data)).toEqual(["a.csv"]);
  });
  it("fails on a missing data file", () => {
    expect(() => assembleBundle([ex("01-a", ["nope.csv"])], {})).toThrow(/nope.csv/);
  });
  it("fails on duplicate ids", () => {
    expect(() => assembleBundle([ex("01-a"), ex("01-a")], { "a.csv": "" })).toThrow(/duplicate/);
  });
});

describe("the real exercises folder", () => {
  const bundle = readBundle(join(import.meta.dirname, "..", "exercises"));
  it("has 15 exercises with ordered ids", () => {
    expect(bundle.exercises).toHaveLength(15);
    expect(bundle.exercises.map((e) => e.id.slice(0, 2))).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(2, "0")));
  });
  it("every exercise points at data that exists and solutions set result", () => {
    for (const e of bundle.exercises) {
      expect(e.data.length).toBeGreaterThan(0);
      for (const d of e.data) expect(bundle.data[d]).toBeTruthy();
      expect(e.solution).toMatch(/\bresult\b/);
      expect(e.check).toMatch(/def check\(/);
    }
  });
});

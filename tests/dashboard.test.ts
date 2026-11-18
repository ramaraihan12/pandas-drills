import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report, ReportCell } from "../src/lib/api.ts";
import { cellLabel, cellState, cellText, csvField, exerciseStats, resultsCsv, sameCodeGroups, stuckStudents } from "../src/lib/dashboard.ts";

const cell = (o: Partial<ReportCell> = {}): ReportCell => ({ attempts: 1, passed: true, firstPassAt: "2026-11-10T10:00:00.000Z", lastKind: "passed", triesToPass: 1, ...o });
const report: Report = {
  name: "T",
  expiresAt: "2027-01-01T00:00:00.000Z",
  exercises: ["01-a-b", "02-c-d"],
  students: [
    { id: "1", nickname: "Ann", joinedAt: "", results: { "01-a-b": cell({ firstPassHash: "aa" }), "02-c-d": cell({ attempts: 4, triesToPass: 3, firstPassHash: "bb" }) } },
    { id: "2", nickname: "=Bo", joinedAt: "", results: { "01-a-b": cell({ firstPassHash: "aa" }), "02-c-d": cell({ attempts: 3, passed: false, firstPassAt: null, triesToPass: null, lastKind: "wrong_shape", lastAt: "2026-11-10T12:00:00.000Z" }) } },
    { id: "3", nickname: "Cy", joinedAt: "", results: { "02-c-d": cell({ attempts: 5, passed: false, firstPassAt: null, triesToPass: null, lastKind: "exception", lastAt: "2026-11-10T13:00:00.000Z" }) } },
  ],
  perExercise: { "01-a-b": { attempted: 2, passed: 2, failures: {} }, "02-c-d": { attempted: 3, passed: 1, failures: { wrong_shape: 4, exception: 3, syntax: 2, wrong_values: 1 } } },
};

describe("cells", () => {
  it("has four states, each with a symbol", () => {
    expect(cellState(undefined)).toBe("none");
    expect(cellState(cell())).toBe("first");
    expect(cellState(cell({ attempts: 4, triesToPass: 3 }))).toBe("several");
    expect(cellState(cell({ passed: false, attempts: 2, triesToPass: null }))).toBe("open");
    expect(cellText(cell({ attempts: 4, triesToPass: 3 }))).toBe("\u2713 3");
    expect(cellText(cell({ passed: false, attempts: 2 }))).toBe("\u2717 2");
    expect(cellText(undefined)).toBe("\u2013");
    expect(cellLabel("Ann", "02-c-d", cell({ attempts: 4, triesToPass: 3 }))).toContain("passed after 3 tries");
  });
});

describe("exercise stats", () => {
  it("gives pass rate and the top three failures in words", () => {
    const [one, two] = exerciseStats(report);
    expect(one!.rate).toBe(1);
    expect(two!.rate).toBeCloseTo(1 / 3);
    expect(two!.topFailures.map((f) => f.kind)).toEqual(["wrong_shape", "exception", "syntax"]);
    expect(two!.topFailures[0]!.label).toBe("wrong number of rows");
  });
  it("has no rate when nobody tried", () => {
    expect(exerciseStats({ ...report, perExercise: {} })[0]!.rate).toBeNull();
  });
});

describe("stuck and same code", () => {
  it("lists 3+ attempts without a pass, newest first", () => {
    expect(stuckStudents(report).map((s) => s.nickname)).toEqual(["Cy", "=Bo"]);
    expect(stuckStudents(report, 4).map((s) => s.nickname)).toEqual(["Cy"]);
  });
  it("groups equal first-pass hashes of two or more students", () => {
    expect(sameCodeGroups(report)).toEqual([{ exerciseId: "01-a-b", nicknames: ["=Bo", "Ann"] }]);
  });
});

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("x\ny")).toBe('"x\ny"');
    expect(csvField(null)).toBe("");
  });
  it("defuses formulas", () => {
    for (const bad of ["=1+1", "+1", "-2", "@SUM(A1)"]) expect(csvField(bad)).toBe(`'${bad}`);
    expect(csvField("=a,b")).toBe(`"'=a,b"`);
  });
  it("writes one row per student and exercise, including untried", () => {
    const lines = resultsCsv(report).trim().split("\r\n");
    expect(lines[0]).toBe("nickname,exercise,attempts,passed,first_pass_time");
    expect(lines).toHaveLength(1 + 3 * 2);
    expect(lines).toContain("Cy,01-a-b,0,no,");
    expect(lines).toContain("'=Bo,02-c-d,3,no,");
  });
});

describe("demo file", () => {
  const demo = JSON.parse(readFileSync("public/demo/report.json", "utf8")) as Report;
  it("has the patterns the dashboard shows", () => {
    expect(demo.students).toHaveLength(18);
    expect(sameCodeGroups(demo)).toHaveLength(1);
    expect(stuckStudents(demo).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(demo)).not.toMatch(/"code"/);
  });
});

describe("studentCount", () => {
  it("says student or students", async () => {
    const { studentCount } = await import("../src/lib/dashboard.ts");
    expect([studentCount(1), studentCount(3)]).toEqual(["1 student", "3 students"]);
  });
});

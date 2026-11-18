import { describe, expect, it } from "vitest";
import { parseCsv, variableName } from "../src/lib/csv.ts";
import { renderMarkdown } from "../src/lib/markdown.ts";
import { createStore } from "../src/lib/storage.ts";

describe("parseCsv", () => {
  it("reads rows and empty cells", () => {
    expect(parseCsv("a,b\n1,\n2,x\n")).toEqual([["a", "b"], ["1", ""], ["2", "x"]]);
  });
  it("handles quotes", () => {
    expect(parseCsv('n\n"Doe, Jo"\n"say ""hi"""\n')).toEqual([["n"], ["Doe, Jo"], ['say "hi"']]);
  });
  it("names the variable after the file", () => {
    expect(variableName("orders.csv")).toBe("orders");
  });
});

describe("renderMarkdown", () => {
  it("renders paragraphs, code and bold", () => {
    expect(renderMarkdown("Use `df` and **bold**.")).toBe("<p>Use <code>df</code> and <strong>bold</strong>.</p>");
  });
  it("renders lists", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });
  it("escapes html", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
}

describe("progress storage", () => {
  it("round-trips", () => {
    const s = createStore(() => fakeStorage());
    const st = fakeStorage();
    const store = createStore(() => st);
    expect(store.load()).toEqual({ done: {}, drafts: {} });
    expect(store.save({ done: { "01": true }, drafts: { "01": "x" }, last: "01" })).toBe(true);
    expect(store.load().done["01"]).toBe(true);
    expect(s.load().done).toEqual({});
  });
  it("survives storage that throws", () => {
    const bad = () => {
      throw new Error("blocked");
    };
    const store = createStore(bad as unknown as () => Storage);
    expect(store.load()).toEqual({ done: {}, drafts: {} });
    expect(store.save({ done: {}, drafts: {} })).toBe(false);
  });
  it("survives corrupt data", () => {
    const st = fakeStorage();
    st.setItem("pandas-drills:v1", "{not json");
    expect(createStore(() => st).load()).toEqual({ done: {}, drafts: {} });
  });
});

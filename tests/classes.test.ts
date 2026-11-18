import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, type SubmissionBody } from "../src/lib/api.ts";
import { createSubmissionQueue, type QueuedSubmission, type SendResult } from "../src/lib/queue.ts";
import { joinLink, parseRoute, teachLink } from "../src/lib/route.ts";
import { createSessions } from "../src/lib/session.ts";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const mem = (): (() => Storage) => { const s = memoryStorage(); return () => s; };
const body = (n: number): SubmissionBody => ({ exerciseId: "01-select-columns", passed: n % 2 === 0, kind: "passed", code: `result = ${n}` });
const item = (n: number): QueuedSubmission => ({ classCode: "ABC234", token: "t", body: body(n) });

describe("submission queue", () => {
  it("sends in order and empties the queue", async () => {
    const sent: number[] = [];
    const q = createSubmissionQueue(async (i) => (sent.push(Number(i.body.code.slice(9))), "ok"), mem());
    q.enqueue(item(1));
    q.enqueue(item(2));
    await q.flush();
    expect(sent).toEqual([1, 2]);
    expect(q.size()).toBe(0);
  });

  it("keeps submissions when the network fails and retries on the next flush", async () => {
    const store = memoryStorage();
    let online = false;
    const sent: string[] = [];
    const q = createSubmissionQueue(async (i): Promise<SendResult> => {
      if (!online) throw new TypeError("Failed to fetch");
      sent.push(i.body.code);
      return "ok";
    }, () => store);
    q.enqueue(item(1));
    q.enqueue(item(2));
    await q.flush();
    expect(q.size()).toBe(2);
    expect(store.getItem("pandas-drills:queue:v1")).toContain("result = 1");
    online = true;
    q.enqueue(item(3)); // the next check triggers the retry
    await q.flush();
    expect(sent).toEqual(["result = 1", "result = 2", "result = 3"]);
    expect(q.size()).toBe(0);
  });

  it("survives a page reload", async () => {
    const store = memoryStorage();
    const first = createSubmissionQueue(async () => "retry", () => store);
    first.enqueue(item(7));
    await first.flush();
    const sent: string[] = [];
    const second = createSubmissionQueue(async (i) => (sent.push(i.body.code), "ok"), () => store);
    await second.flush();
    expect(sent).toEqual(["result = 7"]);
  });

  it("drops what the server will never accept", async () => {
    const q = createSubmissionQueue(async (i) => (i.body.code === "result = 1" ? "drop" : "ok"), mem());
    q.enqueue(item(1));
    q.enqueue(item(2));
    await q.flush();
    expect(q.size()).toBe(0);
  });

  it("does not send the same item twice when flushes overlap", async () => {
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "ok" as const;
    });
    const q = createSubmissionQueue(send, mem());
    q.enqueue(item(1));
    await Promise.all([q.flush(), q.flush()]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns at once and keeps at most 100 items", () => {
    const q = createSubmissionQueue(() => new Promise(() => undefined), mem());
    for (let i = 0; i < 130; i++) q.enqueue(item(i));
    expect(q.size()).toBe(100);
  });

  it("still works when storage is blocked", async () => {
    const sent: string[] = [];
    const q = createSubmissionQueue(async (i) => (sent.push(i.body.code), "ok"), () => {
      throw new Error("blocked");
    });
    q.enqueue(item(1));
    await q.flush();
    expect(sent).toEqual(["result = 1"]);
  });
});

describe("api client", () => {
  it("sends the key as a bearer header and never in the url", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "x" }), { status: 200 }));
    const api = createApi("http://api.test", fetchMock as unknown as typeof fetch);
    await api.report("ABC234", "SECRETKEY");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/classes/ABC234/report");
    expect(url).not.toContain("SECRETKEY");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SECRETKEY");
  });
  it("turns an error answer into an ApiError with the server's message", async () => {
    const api = createApi("http://api.test", (async () => new Response(JSON.stringify({ error: "That nickname is taken in this class" }), { status: 409 })) as typeof fetch);
    await expect(api.join("ABC234", "Ann")).rejects.toMatchObject({ status: 409, message: "That nickname is taken in this class" });
    await expect(api.join("ABC234", "Ann")).rejects.toBeInstanceOf(ApiError);
  });
  it("treats 204 as success", async () => {
    const api = createApi("http://api.test", (async () => new Response(null, { status: 204 })) as typeof fetch);
    await expect(api.submit("t", body(1))).resolves.toBeUndefined();
  });
});

describe("routes and sessions", () => {
  it("parses the class routes", () => {
    expect(parseRoute("#/new-class")).toEqual({ view: "new-class" });
    expect(parseRoute("#/join/abc234")).toEqual({ view: "join", code: "ABC234" });
    expect(parseRoute("#/teach/ABC234/abcdefghijklmnop_-")).toEqual({ view: "teach", code: "ABC234", key: "abcdefghijklmnop_-" });
    expect(parseRoute("#/01-select-columns")).toEqual({ view: "exercise" });
    expect(parseRoute("")).toEqual({ view: "exercise" });
  });
  it("builds links with the key in the fragment", () => {
    expect(joinLink("https://x.dev", "/pandas-drills/", "ABC234")).toBe("https://x.dev/pandas-drills/#/join/ABC234");
    expect(teachLink("https://x.dev", "/pandas-drills/", "ABC234", "K")).toBe("https://x.dev/pandas-drills/#/teach/ABC234/K");
  });
  it("remembers a class and forgets it on leave", () => {
    const store = memoryStorage();
    const s = createSessions(() => store);
    expect(s.active()).toBeNull();
    s.join("ABC234", { name: "Data 101", nickname: "Ann", token: "tok" });
    expect(s.active()?.session.nickname).toBe("Ann");
    s.leave("ABC234");
    expect(s.active()).toBeNull();
    expect(s.get("ABC234")).toBeNull();
    expect(store.getItem("pandas-drills:classes:v1")).not.toContain("tok");
  });
});

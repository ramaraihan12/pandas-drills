import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/app.ts";

const ORIGIN = "https://ramaraihan.is-a.dev";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// production-like settings: no DEV_ORIGINS, so the bot check is on
const production = (secret?: string): Env => ({ DB: env.DB, TURNSTILE_SECRET: secret });

function create(e: Env, body: Record<string, unknown>) {
  return worker.fetch(
    new Request("https://api.test/classes", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    e,
  );
}

const counts = async () => ({
  classes: (await env.DB.prepare("SELECT COUNT(*) AS n FROM classes").first<{ n: number }>())!.n,
  created: (await env.DB.prepare("SELECT COALESCE(SUM(classes_created), 0) AS n FROM daily_counters").first<{ n: number }>())!.n,
});

let verdict: (token: string) => Response;
let siteverify: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions"),
    env.DB.prepare("DELETE FROM student_exercise"),
    env.DB.prepare("DELETE FROM students"),
    env.DB.prepare("DELETE FROM classes"),
    env.DB.prepare("DELETE FROM daily_counters"),
  ]);
  verdict = (token) => Response.json({ success: token === "good-token" });
  siteverify = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { response: string };
    return verdict(sent.response);
  });
  vi.stubGlobal("fetch", siteverify);
});

afterEach(() => vi.unstubAllGlobals());

describe("Turnstile check on class creation", () => {
  it("creates the class when the token is valid, sending only the secret and the token", async () => {
    const res = await create(production("test-secret"), { name: "Data 101", turnstileToken: "good-token" });
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ classes: 1, created: 1 });
    expect(siteverify).toHaveBeenCalledTimes(1);
    const [url, init] = siteverify.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SITEVERIFY);
    expect(JSON.parse(String(init.body))).toEqual({ secret: "test-secret", response: "good-token" }); // no remoteip
    expect(init.signal).toBeTruthy(); // a timeout is set
  });

  it("refuses an invalid token with 403, writes no row and does not touch the daily counter", async () => {
    const res = await create(production("test-secret"), { name: "Data 101", turnstileToken: "bad-token" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("The bot check failed. Reload the page and try again.");
    expect(await counts()).toEqual({ classes: 0, created: 0 });
  });

  it("refuses a missing or empty token with 403 without asking Cloudflare", async () => {
    for (const body of [{ name: "x" }, { name: "x", turnstileToken: "" }, { name: "x", turnstileToken: 5 }]) {
      expect((await create(production("test-secret"), body)).status).toBe(403);
    }
    expect(siteverify).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ classes: 0, created: 0 });
  });

  it("refuses with 503 when the secret is missing, even for a token that looks fine", async () => {
    const res = await create(production(undefined), { name: "Data 101", turnstileToken: "good-token" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("Class creation is not configured");
    expect(siteverify).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ classes: 0, created: 0 });
  });

  it("is skipped in local dev, when DEV_ORIGINS is set", async () => {
    const res = await create({ DB: env.DB, DEV_ORIGINS: "https://ramaraihan.is-a.dev" }, { name: "Data 101" });
    expect(res.status).toBe(201);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("answers 503 and writes nothing when Cloudflare cannot be reached or answers with an error", async () => {
    siteverify.mockRejectedValueOnce(new Error("offline"));
    expect((await create(production("s"), { name: "x", turnstileToken: "good-token" })).status).toBe(503);
    siteverify.mockResolvedValueOnce(new Response("boom", { status: 502 }));
    expect((await create(production("s"), { name: "x", turnstileToken: "good-token" })).status).toBe(503);
    siteverify.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect((await create(production("s"), { name: "x", turnstileToken: "good-token" })).status).toBe(503);
    expect(await counts()).toEqual({ classes: 0, created: 0 });
  });

  it("does not run the check on a bad class name, and never echoes the token", async () => {
    const res = await create(production("s"), { name: "", turnstileToken: "good-token" });
    expect(res.status).toBe(400);
    expect(siteverify).not.toHaveBeenCalled();
    const denied = await create(production("s"), { name: "x", turnstileToken: "bad-token" });
    expect(await denied.text()).not.toContain("bad-token");
  });
});

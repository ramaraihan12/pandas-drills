import type { Api, Attempt, Report } from "./api.ts";
import { ApiError } from "./api.ts";

export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

function fail(err: unknown): { ok: false; message: string } {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  return { ok: false, message: "Could not reach the server. Check your connection and try again." };
}

/** Data loading for the teacher page. The page only renders what these return, so M3 can swap the rendering. */
export async function loadReport(api: Api, code: string, key: string): Promise<Loaded<Report>> {
  try {
    return { ok: true, value: await api.report(code, key) };
  } catch (err) {
    return fail(err);
  }
}

export async function loadAttempts(api: Api, code: string, key: string, student: string, exercise: string): Promise<Loaded<Attempt[]>> {
  try {
    return { ok: true, value: (await api.attempts(code, key, student, exercise)).attempts };
  } catch (err) {
    return fail(err);
  }
}

export async function removeClass(api: Api, code: string, key: string): Promise<Loaded<null>> {
  try {
    await api.deleteClass(code, key);
    return { ok: true, value: null };
  } catch (err) {
    return fail(err);
  }
}

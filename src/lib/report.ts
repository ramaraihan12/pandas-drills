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

export async function removeStudent(api: Api, code: string, key: string, studentId: string): Promise<Loaded<null>> {
  try {
    await api.removeStudent(code, key, studentId);
    return { ok: true, value: null };
  } catch (err) {
    return fail(err);
  }
}

export async function setJoining(api: Api, code: string, key: string, open: boolean): Promise<Loaded<null>> {
  try {
    await api.setJoining(code, key, open);
    return { ok: true, value: null };
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

/** The demo class is a static file, so it needs no API. */
export async function loadDemoReport(url: string, doFetch: typeof fetch = (...a) => fetch(...a)): Promise<Loaded<Report>> {
  try {
    const res = await doFetch(url);
    if (!res.ok) return { ok: false, message: "The demo class could not be loaded. Please try again later." };
    return { ok: true, value: (await res.json()) as Report };
  } catch {
    return { ok: false, message: "Could not load the demo class. Check your connection and try again." };
  }
}

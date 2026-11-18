// Client for the class API (api/ in this repo). When VITE_API_URL is empty the class
// features are off and none of this code is called.
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
export const classesEnabled = API_URL !== "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SubmissionBody {
  exerciseId: string;
  passed: boolean;
  kind: string;
  code: string;
}

export interface ReportCell {
  attempts: number;
  passed: boolean;
  firstPassAt: string | null;
  lastKind: string;
}

export interface Report {
  name: string;
  expiresAt: string;
  exercises: string[];
  students: { id: string; nickname: string; joinedAt: string; results: Record<string, ReportCell> }[];
  perExercise: Record<string, { attempted: number; passed: number }>;
}

export interface Attempt {
  passed: boolean;
  kind: string;
  code: string;
  at: string;
}

type Fetch = typeof fetch;

export function createApi(base: string, doFetch: Fetch = (...a) => fetch(...a)) {
  async function request<T>(method: string, path: string, opts: { body?: unknown; token?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    // a network failure rejects with a TypeError, which callers treat as "try again later"
    const res = await doFetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    if (res.status === 204) return undefined as T;
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // not JSON
    }
    if (!res.ok) {
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `The server answered ${res.status}.`;
      throw new ApiError(res.status, msg);
    }
    return data as T;
  }
  const enc = encodeURIComponent;
  return {
    createClass: (name: string) => request<{ code: string; teacherKey: string; expiresAt: string }>("POST", "/classes", { body: { name } }),
    getClass: (code: string) => request<{ name: string; expiresAt: string }>("GET", `/classes/${enc(code)}`),
    join: (code: string, nickname: string) => request<{ studentToken: string; nickname: string }>("POST", `/classes/${enc(code)}/join`, { body: { nickname } }),
    submit: (token: string, body: SubmissionBody) => request<void>("POST", "/submissions", { body, token }),
    report: (code: string, key: string) => request<Report>("GET", `/classes/${enc(code)}/report`, { token: key }),
    attempts: (code: string, key: string, student: string, exercise: string) =>
      request<{ attempts: Attempt[] }>("GET", `/classes/${enc(code)}/submissions?student=${enc(student)}&exercise=${enc(exercise)}`, { token: key }),
    deleteClass: (code: string, key: string) => request<void>("DELETE", `/classes/${enc(code)}`, { token: key }),
  };
}

export type Api = ReturnType<typeof createApi>;

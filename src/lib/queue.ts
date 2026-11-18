import type { SubmissionBody } from "./api.ts";

export interface QueuedSubmission {
  classCode: string;
  token: string;
  body: SubmissionBody;
}

/** ok: sent. drop: the server will never accept it. retry: try again later. */
export type SendResult = "ok" | "drop" | "retry";

const KEY = "pandas-drills:queue:v1";
const MAX_ITEMS = 100;

/**
 * Submissions wait here until the server has them. The grader never waits for this:
 * enqueue() returns at once and the sending happens in the background.
 */
export function createSubmissionQueue(
  send: (item: QueuedSubmission) => Promise<SendResult>,
  getStorage: () => Storage | undefined = () => globalThis.localStorage,
) {
  let memory: QueuedSubmission[] | null = null; // used if localStorage is blocked
  let flushing: Promise<void> | null = null;

  function load(): QueuedSubmission[] {
    try {
      const raw = getStorage()?.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) return parsed as QueuedSubmission[];
    } catch {
      // fall back to memory
    }
    return memory ?? [];
  }
  function save(items: QueuedSubmission[]) {
    memory = items;
    try {
      getStorage()?.setItem(KEY, JSON.stringify(items));
    } catch {
      // kept in memory for this visit only
    }
  }

  async function run() {
    for (;;) {
      const first = load()[0];
      if (!first) return;
      let result: SendResult;
      try {
        result = await send(first);
      } catch {
        result = "retry";
      }
      if (result === "retry") return;
      save(load().slice(1));
    }
  }

  function flush(): Promise<void> {
    flushing ??= run().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  function enqueue(item: QueuedSubmission): void {
    save([...load(), item].slice(-MAX_ITEMS));
    void flush();
  }

  /** Sends what it can, then forgets whatever is still waiting for this class (the student left it). */
  async function dropClass(classCode: string): Promise<void> {
    await flush(); // may be the run that is already going
    await flush(); // a second pass, in case that run had just given up
    save(load().filter((i) => i.classCode !== classCode));
  }

  /** Forgets submissions that belong to any other class. */
  function keepOnly(classCode: string): void {
    save(load().filter((i) => i.classCode === classCode));
  }

  return { enqueue, flush, dropClass, keepOnly, size: () => load().length };
}

import { PROGRESS_ESTIMATE_BYTES, TIME_LIMIT_MS } from "./config.ts";
import type { ClientFailure, GradeResult, RunRequest } from "./lib/types.ts";

export type EngineState =
  | { kind: "loading"; loaded: number; stage: string }
  | { kind: "ready"; info: string; transferred: number }
  | { kind: "restarting" }
  | { kind: "failed"; message: string };

export type RunOutcome = { ok: true; result: GradeResult } | { ok: false; failure: ClientFailure };

/** Owns the Pyodide worker. A run that exceeds the time limit kills the worker and starts a new one. */
export class Runner {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, (o: RunOutcome) => void>();
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  readonly estimate = PROGRESS_ESTIMATE_BYTES;

  constructor(
    private onState: (s: EngineState) => void,
    private onReadyUrls: (urls: string[]) => void = () => undefined,
  ) {
    this.start(false);
  }

  private start(restart: boolean) {
    this.ready = false;
    this.onState(restart ? { kind: "restarting" } : { kind: "loading", loaded: 0, stage: "Starting Python" });
    this.worker = new Worker(new URL("./worker/pyodide.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data as Record<string, unknown>;
      if (m.type === "progress") {
        this.onState({ kind: "loading", loaded: m.loaded as number, stage: String(m.stage) });
      } else if (m.type === "ready") {
        this.ready = true;
        this.onState({ kind: "ready", info: String(m.info), transferred: Number(m.transferred) });
        this.onReadyUrls(m.urls as string[]);
        this.readyWaiters.splice(0).forEach((f) => f());
      } else if (m.type === "result") {
        this.settle(m.id as number, { ok: true, result: m.result as GradeResult });
      } else if (m.type === "failure") {
        this.settle(m.id as number, { ok: false, failure: { kind: "worker_error", message: String(m.message) } });
      } else if (m.type === "fatal") {
        this.onState({ kind: "failed", message: String(m.message) });
      }
    };
    this.worker.onerror = (e) => this.onState({ kind: "failed", message: e.message || "worker error" });
  }

  private settle(id: number, outcome: RunOutcome) {
    const f = this.pending.get(id);
    this.pending.delete(id);
    f?.(outcome);
  }

  isReady(): boolean {
    return this.ready;
  }

  private whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r));
  }

  async run(req: RunRequest): Promise<RunOutcome> {
    await this.whenReady();
    const id = this.nextId++;
    return new Promise<RunOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.worker.terminate();
        this.start(true);
        resolve({ ok: false, failure: { kind: "timeout", message: "time limit" } });
      }, TIME_LIMIT_MS);
      this.pending.set(id, (o) => {
        clearTimeout(timer);
        resolve(o);
      });
      this.worker.postMessage({ type: "run", id, req });
    });
  }
}

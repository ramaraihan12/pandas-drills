// Runs Python (Pyodide + pandas) off the main thread.
import { PACKAGES, PYODIDE_BASE } from "../config.ts";
import drillsSource from "../../grader/drills.py?raw";
import variantsSource from "../../grader/variants.py?raw";
import type { RunRequest, VariantRequest } from "../lib/types.ts";

interface Ctx {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  fetch: typeof fetch;
}
interface Pyodide {
  loadPackage(names: string[], opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<void>;
  runPython(code: string): unknown;
  pyimport(name: string): { run: (...args: unknown[]) => string };
  toPy(obj: unknown): unknown;
  FS: { writeFile(path: string, data: string): void };
}

const ctx = self as unknown as Ctx;
let py: Pyodide | undefined;
let drills: { run: (...args: unknown[]) => string } | undefined;
let makeVariant: ((...args: unknown[]) => string) | undefined;

let loaded = 0;
const urls = new Set<string>();

function progress(stage: string) {
  ctx.postMessage({ type: "progress", loaded, stage });
}

// Count the bytes of everything fetched from the pinned CDN folder, so the page can show a real progress bar.
const realFetch = ctx.fetch.bind(ctx);
ctx.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(PYODIDE_BASE)) {
    urls.add(url);
    if (res.body) {
      const reader = res.clone().body!.getReader();
      void (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.length;
          progress("download");
        }
      })().catch(() => undefined);
    }
  }
  return res;
}) as typeof fetch;

async function init() {
  progress("Starting Python");
  // Pyodide 314 ships pyodide.mjs (pyodide.js no longer works with importScripts), so this is a module worker.
  const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_BASE + "pyodide.mjs")) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
  py = await loadPyodide({ indexURL: PYODIDE_BASE });
  progress("Loading pandas");
  await py.loadPackage(PACKAGES);
  py.FS.writeFile("/home/pyodide/drills.py", drillsSource);
  py.FS.writeFile("/home/pyodide/variants.py", variantsSource);
  const info = py.runPython(`
import sys
sys.path.insert(0, "/home/pyodide")
import drills, variants, pandas, numpy
f"Python {sys.version.split()[0]}, pandas {pandas.__version__}"
`) as string;
  // keep our own handle on run(), so later student code cannot swap it out
  drills = { run: py.pyimport("drills").run };
  makeVariant = (py.pyimport("variants") as unknown as { variant_json: (...args: unknown[]) => string }).variant_json;
  // scripts loaded with import() do not go through fetch, so read them from the resource timing list too
  let transferred = 0;
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (!e.name.startsWith(PYODIDE_BASE)) continue;
    urls.add(e.name);
    transferred += e.transferSize;
  }
  ctx.postMessage({ type: "ready", info, urls: [...urls], transferred, decoded: loaded });
}

/** The student's own copy of the data files (the originals when the seed is 0). */
function dataFor(data: Record<string, string>, exerciseId: string | undefined, seed: number | undefined): Record<string, string> {
  if (!seed || !exerciseId || !makeVariant) return data;
  return JSON.parse(makeVariant(JSON.stringify(data), exerciseId, seed)) as Record<string, string>;
}

ctx.onmessage = (event: MessageEvent) => {
  const msg = event.data as { type: string; id?: number; req?: RunRequest & VariantRequest };
  if (msg.type === "variant" && msg.id !== undefined && msg.req && py && makeVariant) {
    try {
      ctx.postMessage({ type: "variant", id: msg.id, data: dataFor(msg.req.data, msg.req.exerciseId, msg.req.seed) });
    } catch (e) {
      ctx.postMessage({ type: "failure", id: msg.id, message: String(e) });
    }
  } else if (msg.type === "run" && msg.id !== undefined && msg.req && py && drills) {
    try {
      const r = msg.req;
      const json = drills.run(r.code, py.toPy(dataFor(r.data, r.exerciseId, r.seed)), r.solution, r.check, r.mode);
      ctx.postMessage({ type: "result", id: msg.id, result: JSON.parse(json) });
    } catch (e) {
      ctx.postMessage({ type: "failure", id: msg.id, message: String(e) });
    }
  }
};

init().catch((e) => ctx.postMessage({ type: "fatal", message: String(e) }));

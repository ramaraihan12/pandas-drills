import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assembleBundle, buildExercise } from "../src/lib/bundle.ts";
import type { Bundle } from "../src/lib/types.ts";

/** Reads exercises/NN-slug/* and exercises/data/*.csv and returns the bundle. */
export function readBundle(root: string): Bundle {
  const dataDir = join(root, "data");
  const dataFiles: Record<string, string> = {};
  if (existsSync(dataDir)) {
    for (const f of readdirSync(dataDir)) {
      if (f.endsWith(".csv")) dataFiles[f] = readFileSync(join(dataDir, f), "utf8");
    }
  }
  const exercises = readdirSync(root)
    .filter((n) => n !== "data" && statSync(join(root, n)).isDirectory())
    .map((folder) => {
      const read = (name: string) => {
        const p = join(root, folder, name);
        if (!existsSync(p)) throw new Error(`${folder}: missing ${name}`);
        return readFileSync(p, "utf8");
      };
      return buildExercise(folder, {
        prompt: read("prompt.md"),
        starter: read("starter.py"),
        solution: read("solution.py"),
        check: read("check.py"),
      });
    });
  return assembleBundle(exercises, dataFiles);
}

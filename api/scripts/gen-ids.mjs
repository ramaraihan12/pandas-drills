// Writes src/generated/exercise-ids.json from the folders in ../exercises, so the
// list of exercise ids lives in one place only (the exercises folder).
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "exercises");
const ids = readdirSync(root)
  .filter((n) => n !== "data" && statSync(join(root, n)).isDirectory())
  .sort();
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "generated", "exercise-ids.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(ids));
console.log(`exercise ids: ${ids.length}`);

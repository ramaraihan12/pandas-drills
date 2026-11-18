// Turns exercises/ into src/generated/bundle.json. Run with: npm run bundle
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBundle } from "./read-exercises.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = readBundle(join(root, "exercises"));
const out = join(root, "src", "generated", "bundle.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(bundle));
console.log(`bundle: ${bundle.exercises.length} exercises, ${Object.keys(bundle.data).length} data files -> src/generated/bundle.json`);

import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { PYODIDE_VERSION } from "./src/config.ts";

const BUILD_ID = (process.env.GITHUB_SHA ?? "").slice(0, 7) || Date.now().toString(36);

/** Emits sw.js from the template, with the app shell file list, build id and Pyodide pin filled in. */
function serviceWorker(): Plugin {
  return {
    name: "drills-service-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const shell = ["./", ...files, "favicon.svg"];
      const tpl = readFileSync(new URL("./src/sw.template.js", import.meta.url), "utf8");
      const source = tpl
        .replaceAll("__BUILD_ID__", BUILD_ID)
        .replaceAll("__PYODIDE_VERSION__", PYODIDE_VERSION)
        .replace("__SHELL_FILES__", JSON.stringify(shell));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "/pandas-drills/",
  plugins: [serviceWorker()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 700 },
});

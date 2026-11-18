import { defineConfig } from "vitest/config";

// The api/ folder has its own tests that run inside the Workers runtime (npm test in api/).
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });

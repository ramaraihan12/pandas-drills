declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: never;
    DEV_ORIGINS?: string;
    TURNSTILE_SECRET?: string;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index.ts");
  }
}

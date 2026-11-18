declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: never;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index.ts");
  }
}

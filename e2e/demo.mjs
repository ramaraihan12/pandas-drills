// Checks that the demo class renders. No API needed: the demo is a static file.
// Local:  npm run build, then node e2e/demo.mjs            (starts vite preview on 4173)
// Live:   node e2e/demo.mjs https://ramaraihan.is-a.dev/pandas-drills/
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = process.argv[2];
const WEB = arg ?? "http://localhost:4173/pandas-drills/";
mkdirSync("e2e/out", { recursive: true });
let server = null;
if (!arg) {
  server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { shell: true, stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(WEB)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
}

let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failed = true;
};

const browser = await chromium.launch();
try {
  for (const [label, width] of [["1280", 1280], ["360", 360]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(WEB);
    ok(await page.locator("#demo-link").isVisible(), `${label}px: header has the demo link`);
    ok(await page.locator("#demo-link-foot").isVisible(), `${label}px: footer has the demo link`);
    await page.goto(WEB + "#/demo-class");
    await page.reload();
    await page.waitForSelector("table.heatmap");
    ok((await page.textContent("#demo-banner")) === "Made-up class with generated data, to show what a teacher sees.", `${label}px: demo banner`);
    ok((await page.locator("table.heatmap tbody tr").count()) === 18, `${label}px: 18 students in the heatmap`);
    for (const state of ["first", "several", "open", "none"]) {
      ok((await page.locator(`button.cell.${state}`).count()) > 0, `${label}px: heatmap has "${state}" cells`);
    }
    const labelled = await page.locator("button.cell").evaluateAll((bs) => bs.every((b) => b.getAttribute("aria-label") && b.textContent.trim()));
    ok(labelled, `${label}px: every cell has a symbol and an accessible label`);
    for (const id of ["dash-exercises", "dash-stuck", "dash-same", "dash-export"]) ok(await page.locator(`#${id}`).isVisible(), `${label}px: section ${id}`);
    ok((await page.locator("#dash-same li").count()) === 1, `${label}px: one same-code group`);
    ok((await page.locator("#dash-stuck li").count()) >= 2, `${label}px: stuck students listed`);
    ok((await page.locator("button.cell.open").first().getAttribute("aria-label")).includes("not passed yet"), `${label}px: open cell label`);
    ok((await page.locator("table.by-exercise tbody tr").count()) === 15, `${label}px: 15 exercises in the table`);
    // read-only: no delete, no refresh
    ok((await page.getByText("Delete class").count()) === 0, `${label}px: no delete button`);
    await page.locator("button.cell").nth(20).click();
    ok((await page.textContent(".detail")).includes("demo has no code"), `${label}px: cell click explains there is no code`);
    // keyboard: arrow keys move inside the grid
    await page.locator("button.cell").first().focus();
    await page.keyboard.press("ArrowRight");
    ok(await page.evaluate(() => document.activeElement?.matches("table.heatmap button.cell") && document.activeElement.closest("td").previousElementSibling?.tagName === "TD"), `${label}px: arrow key moves to the next cell`);
    // the CSV download
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export-csv")]);
    ok(dl.suggestedFilename() === "demo-class-results.csv", `${label}px: CSV downloads`);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    ok(noScroll, `${label}px: no page-level horizontal scroll`);
    const wrapScrolls = await page.locator(".heatmap-wrap").evaluate((w) => w.scrollWidth > w.clientWidth);
    ok(wrapScrolls === (width < 600), `${label}px: heatmap scrolls inside its own box only when it is wider than the screen`);
    ok(errors.length === 0, `${label}px: no page errors ${errors.join("; ")}`);
    await page.screenshot({ path: `e2e/out/demo-${label}.png`, fullPage: true });
    if (label === "360") {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({ path: "e2e/out/demo-360-dark.png", fullPage: false });
    }
    await ctx.close();
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await browser.close();
  if (server) {
    server.kill();
    spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { shell: true, stdio: "ignore" });
  }
}
process.exit(failed ? 1 : 0);

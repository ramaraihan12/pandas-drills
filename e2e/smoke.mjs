// Local smoke test (not run in CI). Needs a Playwright browser: npx playwright install chromium
// Usage: node e2e/smoke.mjs [url] [--live]
//   no url: serves the built site with `vite preview` first (run `npm run build` before)
//   --live: only checks that exercise 1 can be solved at the given url
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const live = args.includes("--live");
let url = args.find((a) => a.startsWith("http"));
let server;
if (!url) {
  const port = 4173;
  server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { shell: true, stdio: "ignore" });
  url = `http://localhost:${port}/pandas-drills/`;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
}
mkdirSync("e2e/out", { recursive: true });

const GOOD = 'result = orders[["order_id", "product", "quantity"]]';
const TYPO = 'result = orders[["order_id", "produkt", "quantity"]]';
const report = {};
let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failed = true;
};

async function setCode(page, code) {
  const ed = page.locator(".cm-content");
  await ed.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}
async function waitReady(page, ms = 240_000) {
  await page.waitForFunction(() => document.getElementById("engine").hidden, null, { timeout: ms });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
let bytes = 0;
const pending = [];
page.on("requestfinished", (r) => pending.push(r.sizes().then((s) => (bytes += s.responseBodySize + s.responseHeadersSize)).catch(() => undefined)));
page.on("pageerror", (e) => console.log("pageerror:", e.message));

// ---- first load ----
let t0 = Date.now();
await page.goto(url);
await waitReady(page);
await Promise.all(pending);
report.first_load_seconds = ((Date.now() - t0) / 1000).toFixed(1);
// Playwright does not report requests made inside the worker, so the Pyodide files (the page lists
// them in data-urls) are measured by downloading each one again with compression, as a browser does.
const pyUrls = JSON.parse(await page.locator("#engine-info").getAttribute("data-urls"));
let pyBytes = 0;
for (const u of pyUrls) {
  const r = spawnSync("curl", ["-s", "--compressed", "-o", process.platform === "win32" ? "NUL" : "/dev/null", "-w", "%{size_download}", u]);
  pyBytes += Number(String(r.stdout));
}
report.pyodide_files = pyUrls.length;
report.first_load_mb = ((bytes + pyBytes) / 1e6).toFixed(1);
report.app_kb = (bytes / 1e3).toFixed(0);
console.log(`first load: ${report.first_load_mb} MB, ${report.first_load_seconds} s`);
console.log("footer:", await page.locator("#engine-info").innerText());

// ---- solve exercise 1 ----
await setCode(page, GOOD);
await page.getByRole("button", { name: "Check" }).click();
await page.locator(".fb.pass").waitFor({ timeout: 30_000 });
ok(true, "exercise 1 solved and graded as correct");
ok(await page.locator("#exercise-list a.done").first().isVisible(), "exercise 1 marked done in the list");

if (!live) {
  // ---- wrong answer: KeyError hint ----
  await setCode(page, TYPO);
  await page.getByRole("button", { name: "Check" }).click();
  await page.locator(".fb.error").waitFor({ timeout: 30_000 });
  const text = await page.locator("#output").innerText();
  ok(text.includes("Did you mean 'product'"), "typo shows the closest column");
  ok(text.includes("Columns in orders"), "typo lists the real column names");

  // ---- print output + syntax error ----
  await setCode(page, 'print("hello from me")\n' + GOOD);
  await page.getByRole("button", { name: "Run" }).click();
  await page.locator(".stdout").waitFor();
  ok((await page.locator(".stdout").innerText()).includes("hello from me"), "student print output is shown");
  await setCode(page, "result = orders[[");
  await page.getByRole("button", { name: "Check" }).click();
  await page.locator(".fb.error").waitFor();
  ok((await page.locator("#output").innerText()).includes("Syntax error on line"), "syntax error shows a line number");

  // ---- time limit ----
  await setCode(page, "while True:\n    pass");
  t0 = Date.now();
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByText("That took too long").waitFor({ timeout: 30_000 });
  ok(true, `endless loop stopped after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await waitReady(page, 120_000);
  await setCode(page, GOOD);
  await page.getByRole("button", { name: "Check" }).click();
  await page.locator(".fb.pass").waitFor({ timeout: 30_000 });
  ok(true, "worker restarted and graded again");

  // ---- reload keeps progress ----
  await page.reload();
  await waitReady(page);
  ok(await page.locator("#exercise-list a.done").first().isVisible(), "progress survives a reload");

  // ---- service worker, second load, offline ----
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForTimeout(3000); // let the worker finish caching
  const page2 = await context.newPage();
  t0 = Date.now();
  await page2.goto(url);
  await waitReady(page2);
  report.second_load_seconds = ((Date.now() - t0) / 1000).toFixed(1);
  report.second_load_network_mb = (Number(await page2.locator("#engine-info").getAttribute("data-transferred-bytes")) / 1e6).toFixed(2);
  console.log(`second load: ${report.second_load_seconds} s`);
  await page2.close();

  await context.setOffline(true);
  const page3 = await context.newPage();
  t0 = Date.now();
  await page3.goto(url);
  await waitReady(page3, 120_000);
  report.offline_load_seconds = ((Date.now() - t0) / 1000).toFixed(1);
  await setCode(page3, GOOD);
  await page3.getByRole("button", { name: "Check" }).click();
  await page3.locator(".fb.pass").waitFor({ timeout: 30_000 });
  ok(true, `offline: page and Python loaded in ${report.offline_load_seconds} s and exercise 1 graded`);
  await page3.close();
  await context.setOffline(false);

  // ---- phone width ----
  const phone = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const p = await phone.newPage();
  await p.goto(url);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, `no horizontal scroll at 360px (overflow ${overflow}px)`);
  await p.screenshot({ path: "e2e/out/phone.png", fullPage: true });
  await phone.close();
  await page.screenshot({ path: "e2e/out/desktop.png", fullPage: true });
}

console.log(JSON.stringify(report));
await browser.close();
server?.kill();
process.exit(failed ? 1 : 0);

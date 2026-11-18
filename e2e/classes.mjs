// Local end-to-end test for the class features (not run in CI).
// Needs: a Playwright browser (npx playwright install chromium), `npm run build` done with
// VITE_API_URL=http://localhost:8787, and the API running: in api/, `npm run migrate:local`
// then `npm run dev`. Usage: node e2e/classes.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const WEB = "http://localhost:4173/pandas-drills/";
mkdirSync("e2e/out", { recursive: true });
const server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { shell: true, stdio: "ignore" });
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(WEB)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failed = true;
};
async function setCode(page, code) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}
async function check(page, code) {
  await page.waitForFunction(() => !document.getElementById("check").disabled, null, { timeout: 180_000 });
  await setCode(page, code);
  await page.click("#check");
  await page.locator(".fb").first().waitFor({ timeout: 60_000 });
  return (await page.locator(".fb").first().getAttribute("class")) ?? "";
}

const browser = await chromium.launch();
try {
  // teacher creates the class
  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await teacher.goto(WEB + "#/new-class");
  await teacher.fill("#class-name", "E2E class");
  await teacher.click("button[type=submit]");
  const studentLink = await teacher.locator('input[aria-label="Student link"]').inputValue();
  const teacherLink = await teacher.locator('input[aria-label="Teacher link (private)"]').inputValue();
  ok(/#\/join\/[A-Z2-9]{6}$/.test(studentLink), `student link ${studentLink.replace(/^.*#/, "#")}`);
  ok(/#\/teach\/[A-Z2-9]{6}\/[A-Za-z0-9_-]{43}$/.test(teacherLink), "teacher link has the key in the fragment");
  ok((await teacher.textContent("#class-view")).includes("can't be recovered"), "warning about the private link");

  // two students, two browser contexts
  const results = {};
  for (const [nick, code, expectPass] of [
    ["Ann", 'result = orders[["order_id", "product", "quantity"]]', true],
    ["Bo", 'result = orders[["order_id", "produkt", "quantity"]]', false],
  ]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(studentLink);
    await page.fill("#nickname", nick);
    ok((await page.textContent("#class-view")).includes("Use a nickname, not your full name"), `${nick}: nickname hint`);
    await page.click("button[type=submit]");
    await page.waitForSelector("#class-badge:not([hidden])");
    ok((await page.textContent("#class-badge")).includes(nick), `${nick}: header shows class and nickname`);
    const cls = await check(page, code);
    ok(cls.includes(expectPass ? "pass" : "fail") || (!expectPass && cls.includes("error")), `${nick}: check ${expectPass ? "passed" : "failed"}`);
    await page.waitForTimeout(800); // let the background submission go out
    results[nick] = ctx;
  }

  // teacher opens the results
  await teacher.goto(teacherLink);
  await teacher.reload();
  await teacher.waitForSelector("table.results");
  const rows = await teacher.locator("table.results tbody tr").allTextContents();
  ok(rows.length === 2, "teacher sees two students");
  ok(rows.some((r) => r.startsWith("Ann") && r.includes("\u2713 1")), "Ann passed in 1 attempt");
  ok(rows.some((r) => r.startsWith("Bo") && r.includes("\u2717 1")), "Bo has 1 failed attempt");
  await teacher.locator("button.cell.ok").first().click();
  await teacher.waitForSelector("pre.attempt");
  ok((await teacher.textContent("pre.attempt")).includes("order_id"), "clicking a cell shows the code");
  await teacher.screenshot({ path: "e2e/out/teacher.png", fullPage: true });

  // delete the class
  await teacher.click("text=Delete class");
  await teacher.click("text=Yes, delete the class");
  await teacher.waitForSelector("text=Class deleted", { timeout: 15_000 });
  ok(true, "class deleted");
  const gone = await results.Ann.newPage();
  await gone.goto(studentLink);
  await gone.reload();
  await gone.waitForSelector("text=Class not found", { timeout: 15_000 });
  ok(true, "join link no longer works");
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await browser.close();
  server.kill();
  spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { shell: true, stdio: "ignore" });
}
process.exit(failed ? 1 : 0);

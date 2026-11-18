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
  ok((await teacher.textContent("#class-view")).includes("open the teacher link in a private window"), "warning mentions a private window");
  const keyField = teacher.locator('input[aria-label="Teacher link (private)"]');
  ok((await keyField.getAttribute("type")) === "password", "teacher link is masked by default");
  ok((await teacher.locator('input[aria-label="Student link"]').getAttribute("type")) === "text", "student link is not masked");
  await teacher.click('button[aria-label="Show the teacher link (private)"]');
  ok((await keyField.getAttribute("type")) === "text", "Show reveals the teacher link");
  await teacher.click('button[aria-label="Show the teacher link (private)"]');
  ok((await keyField.getAttribute("type")) === "password", "Hide masks it again");
  ok((await teacher.locator('button[aria-label="Copy the teacher link (private)"]').count()) === 1, "teacher link has a Copy button");

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
  await teacher.waitForSelector("table.heatmap");
  const code = teacherLink.match(/#\/teach\/([A-Z2-9]{6})\//)[1];
  const hashNow = await teacher.evaluate(() => location.hash);
  ok(hashNow === `#/teach/${code}`, `the key left the address bar (${hashNow})`);
  ok(!(await teacher.evaluate(() => history.length > 0 && document.referrer + location.href)).includes(teacherLink.split("/").pop()), "the URL no longer holds the key");
  const stored = await teacher.evaluate((c) => sessionStorage.getItem(`pandas-drills:teacher:${c}`), code);
  ok(!!stored && teacherLink.endsWith(stored), "the key is in sessionStorage for this tab");
  const other = await teacherCtx.newPage();
  await other.goto(WEB + `#/teach/${code}`);
  await other.waitForSelector("text=Open your teacher link again", { timeout: 15_000 });
  ok(true, "a new tab without the key asks for the saved link");
  await other.close();
  ok((await teacher.textContent("#dash-caveat")).includes("practice data, not exam marks"), "dashboard says it is practice data");
  const rows = await teacher.locator("table.heatmap tbody tr").allTextContents();
  ok(rows.length === 2, "teacher sees two students");
  ok(rows.some((r) => r.startsWith("Ann") && r.includes("\u2713")), "Ann passed in 1 attempt");
  ok(rows.some((r) => r.startsWith("Bo") && r.includes("\u2717 1")), "Bo has 1 failed attempt");
  await teacher.locator("button.cell.first").first().click();
  await teacher.waitForSelector("pre.attempt");
  ok((await teacher.textContent("pre.attempt")).includes("order_id"), "clicking a cell shows the code");
  for (const id of ["dash-heatmap", "dash-exercises", "dash-stuck", "dash-same", "dash-export"]) ok(await teacher.locator(`#${id}`).isVisible(), `dashboard section ${id}`);
  const row1 = (await teacher.locator("table.by-exercise tbody tr").first().textContent()) ?? "";
  ok(row1.includes("1 / 2") && row1.includes("50%"), "exercise 1: 1 of 2 passed, 50%");
  ok(row1.includes("wrong columns") || row1.includes("error while running"), "exercise 1 lists the failure kind in words");
  ok((await teacher.locator("button.cell.open").count()) === 1, "Bo's cell is tried and not passed");
  ok((await teacher.locator("table.heatmap tbody tr").first().locator("button.cell.none").count()) > 0, "untried exercises show as not tried");
  const [dl] = await Promise.all([teacher.waitForEvent("download"), teacher.click("#export-csv")]);
  const csv = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
  ok(csv.includes("nickname,exercise,attempts,passed,first_pass_time") && csv.includes("Ann,01-select-columns,1,yes,"), "CSV export has the rows");
  await teacher.screenshot({ path: "e2e/out/teacher.png", fullPage: true });

  // lock joining
  await teacher.click("#toggle-joining");
  await teacher.waitForSelector("text=This class is closed to new students.", { timeout: 15_000 });
  const lateCtx = await browser.newContext();
  const late = await lateCtx.newPage();
  await late.goto(studentLink);
  await late.fill("#nickname", "Cy");
  await late.click("button[type=submit]");
  await late.waitForSelector("text=This class is closed to new students", { timeout: 15_000 });
  ok(true, "a closed class refuses a new student");
  await teacher.click("#toggle-joining");
  await teacher.waitForSelector("text=New students can join", { timeout: 15_000 });
  ok(true, "joining reopened");

  // "Not <nickname>?" on a shared computer
  const annPage = await results.Ann.newPage();
  await annPage.goto(studentLink);
  await annPage.reload();
  await annPage.waitForSelector("#not-you", { timeout: 15_000 });
  ok((await annPage.textContent("#not-you")).includes("Not Ann? Leave and join as yourself"), "join page offers Not Ann?");
  await annPage.click("#not-you");
  ok(await annPage.locator("#leave-clear").isChecked(), "clearing drafts and done marks is on by default");
  await annPage.click("#leave-confirm");
  await annPage.waitForSelector("#nickname", { timeout: 15_000 });
  ok(true, "after leaving, the join form is back");
  const left = await annPage.evaluate(() => [localStorage.getItem("pandas-drills:classes:v1"), localStorage.getItem("pandas-drills:v1")]);
  ok(!left[0].includes("Ann") && !left[1].includes('"done":{"'), "this device forgot the session and the done marks");
  await annPage.close();

  // remove a student
  teacher.on("dialog", (d) => d.accept());
  await teacher.click('button[aria-label="Remove Bo and their results"]');
  await teacher.waitForFunction(() => document.querySelectorAll("table.heatmap tbody tr").length === 1, null, { timeout: 15_000 });
  ok((await teacher.locator("table.heatmap tbody tr").first().textContent()).startsWith("Ann"), "Bo was removed, Ann is still there");

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

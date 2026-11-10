/* global location, setTimeout */
// Browser walkthrough of the pipeline UI against a running studio.
// Usage: node e2e/pipeline-walkthrough.mjs <studio url> <screenshot dir> <game asset id>
// Set CHROME to a Chrome/Edge executable. Read-only: it opens pages, previews
// results and dialogs, but starts no jobs and exports nothing.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

const [base, screens, assetId] = process.argv.slice(2);
if (!base || !screens || !assetId) {
  console.error("usage: node e2e/pipeline-walkthrough.mjs <studio url> <screenshot dir> <game asset id>");
  process.exit(2);
}
mkdirSync(screens, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "google-chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const problems = [];
const results = [];
const check = (ok, text) => results.push(`${ok ? "PASS" : "FAIL"} ${text}`);

async function session(colorScheme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme });
  page.on("console", (message) => message.type() === "error" && problems.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
  page.on("response", (response) => response.status() >= 400 && problems.push(`HTTP ${response.status()} ${response.url()}`));
  return page;
}

const shot = (page, name, full = false) => page.screenshot({ path: join(screens, `${name}.png`), fullPage: full });

const page = await session("light");
await page.goto(base + "/");
await page.waitForSelector(".card, .empty");
await page.waitForTimeout(2500);
await shot(page, "01-home");
check((await page.locator(".card").count()) > 0, "home lists game assets");

await page.click("text=+ New asset");
await page.waitForSelector(".modal");
await shot(page, "02-new-asset");
await page.keyboard.press("Escape");
check((await page.locator(".modal").count()) === 0, "Escape closes the dialog");

await page.goto(`${base}/#/a/${assetId}`);
await page.waitForSelector(".step");
// 3D thumbnails load lazily, when scrolled into view, like a person would.
let thumbsOk = true;
for (const viewer of await page.locator(".result model-viewer").all()) {
  await viewer.scrollIntoViewIfNeeded();
  thumbsOk &&= await viewer.evaluate((element) => new Promise((resolve) => {
    if (element.loaded) return resolve(true);
    element.addEventListener("load", () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 60000);
  }));
}
check(thumbsOk, "3D thumbnails load when shown");
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await shot(page, "03-asset-page");
await shot(page, "04-asset-page-full", true);

const hash = await page.evaluate(() => location.hash);
// Preview a different result: the page must stay where it is.
const thumbs = page.locator(".result");
check((await thumbs.count()) >= 5, `results shown (${await thumbs.count()})`);
await page.locator("#step-cutout .result").first().click();
await page.waitForTimeout(800);
check((await page.evaluate(() => location.hash)) === hash, "clicking a result does not navigate");
await shot(page, "05-preview-cutout");

await page.locator("#step-gamemesh button", { hasText: "Settings" }).click();
await page.waitForSelector("#step-gamemesh .settings");
check((await page.evaluate(() => location.hash)) === hash, "opening settings does not navigate");
await page.locator("#step-gamemesh").screenshot({ path: join(screens, "06-settings.png") });
await page.locator("#step-gamemesh button", { hasText: "Hide settings" }).click();

await page.locator(".stepper-item", { hasText: "Godot" }).click();
await page.waitForTimeout(1200);
check((await page.evaluate(() => location.hash)) === hash, "stepper scrolls without navigating");
await page.locator("#step-godot").screenshot({ path: join(screens, "07-godot.png") });
const options = await page.locator("#step-godot select option").allTextContents();
check(options.length >= 3, `Godot projects listed (${options.length})`);

await page.locator("#step-detail button", { hasText: "Skip" }).waitFor();
await page.locator("#step-paint button", { hasText: "Use my own" }).count().then((n) => check(n === 0, "paint step offers no upload"));

await page.goto(`${base}/#/queue`);
await page.waitForTimeout(1500);
await shot(page, "08-queue");
await page.goto(`${base}/#/models`);
await page.waitForTimeout(1500);
await shot(page, "09-models");

const dark = await session("dark");
await dark.goto(`${base}/#/a/${assetId}`);
await dark.waitForSelector(".step");
await dark.waitForTimeout(4000);
await shot(dark, "10-asset-dark");

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${base}/#/a/${assetId}`);
await phone.waitForSelector(".step");
await phone.waitForTimeout(2500);
await shot(phone, "11-phone");
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `no sideways scrolling on a phone (${overflow}px)`);

await browser.close();
console.log(results.join("\n"));
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no console errors");
process.exit(results.some((line) => line.startsWith("FAIL")) || problems.length ? 1 : 0);

/* global setTimeout */
// Rewrites an asset's description from a new short idea and runs its Concept step, as the owner would (prompt 2b,
// B9 truck): types the idea, presses "Write a detailed description", "Use this description", then Run on the
// Concept step, waits for a new result and screenshots the step. Starts the local writer and one concept job
// (heavy: ask the owner first). Deletes nothing.
// Usage: CHROME=<chrome.exe> node e2e/describe-and-concept.mjs <studio url> <screenshot dir> <game asset id> "<idea>"
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

const [base, screens, assetId, idea] = process.argv.slice(2);
if (!base || !screens || !assetId || !idea) {
  console.error('usage: node e2e/describe-and-concept.mjs <studio url> <screenshot dir> <game asset id> "<idea>"');
  process.exit(2);
}
mkdirSync(screens, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "google-chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
await page.goto(`${base}/#/a/${assetId}`, { waitUntil: "networkidle" });
const step = page.locator("#step-concept");
await step.waitFor({ timeout: 30000 });

const field = step.locator(".writer input");
await field.fill(idea);
await field.blur();
await page.waitForTimeout(1000);
await step.getByRole("button", { name: /Write a detailed description/ }).click();
console.log("writing the description…");
const use = step.getByRole("button", { name: "Use this description" });
await use.waitFor({ timeout: 300000 });
const text = (await step.locator(".note.suggestion p").textContent())?.trim() ?? "";
await use.click();
await page.waitForTimeout(1500);
console.log(`description (${text.split(/\s+/).length} words): ${text}`);
writeFileSync(join(screens, `${assetId}-description.txt`), text + "\n");

const before = await step.locator(".result").count();
await step.getByRole("button", { name: /^Run/ }).first().click();
console.log(`concept results before: ${before}; Run pressed`);
const started = Date.now();
while (Date.now() - started < 900000) {
  await page.waitForTimeout(5000);
  if ((await step.locator(".result").count()) > before) break;
  process.stdout.write(`\rconcept: ${Math.round((Date.now() - started) / 1000)} s`);
}
console.log();
await page.waitForTimeout(3000);
await step.scrollIntoViewIfNeeded();
await step.screenshot({ path: join(screens, `${assetId}-concept.png`) });
console.log(`concept results now: ${await step.locator(".result").count()} after ${Math.round((Date.now() - started) / 1000)} s`);
console.log(problems.length ? problems.join("\n") : "no page errors");
await browser.close();

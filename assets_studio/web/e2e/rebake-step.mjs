/* global setTimeout */
// Runs the "Clean UVs (rebake)" step from the asset page (prompt 2a): includes it when it is off, presses Run,
// waits for a new result and screenshots the step. Starts one light Blender job; deletes nothing.
// Usage: node e2e/rebake-step.mjs <studio url> <screenshot dir> <game asset id> [timeout seconds] [step id]
// Any other step id (e.g. paint) runs that step the same way (paint is heavy: ask the owner first).
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

const [base, screens, assetId, limit = "600", stepId = "rebake"] = process.argv.slice(2);
if (!base || !screens || !assetId) {
  console.error("usage: node e2e/rebake-step.mjs <studio url> <screenshot dir> <game asset id> [timeout seconds]");
  process.exit(2);
}
mkdirSync(screens, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "google-chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
await page.goto(`${base}/#/a/${assetId}`);
const step = page.locator(`#step-${stepId}`);
await step.waitFor({ timeout: 30000 });
const include = step.locator("button", { hasText: "Include this step" });
if (await include.count()) {
  await include.click();
  console.log("included the step");
}
await step.locator(".step-actions button").first().waitFor();
const before = await step.locator(".result").count();
await step.scrollIntoViewIfNeeded();
await step.screenshot({ path: join(screens, `${assetId}-${stepId}-before.png`) });
const run = step.locator(".step-actions button").first();
console.log(`results before: ${before}; pressing "${(await run.textContent())?.trim()}"`);
await run.click();
const started = Date.now();
let state = "";
while (Date.now() - started < Number(limit) * 1000) {
  await page.waitForTimeout(5000);
  const count = await step.locator(".result").count();
  state = (await step.getAttribute("class")) ?? "";
  process.stdout.write(`\r${Math.round((Date.now() - started) / 1000)} s  results ${count}  ${state}      `);
  if (count > before && !/running/.test(state)) break;
  if (/failed/.test(state)) break;
}
console.log("");
await step.scrollIntoViewIfNeeded();
await step.screenshot({ path: join(screens, `${assetId}-${stepId}-after.png`) });
const after = await step.locator(".result").count();
const message = (await step.locator(".note").allTextContents()).join(" | ");
console.log(`results after: ${after}; step class "${state}"; notes: ${message || "none"}`);
for (const line of problems) console.log(line);
await browser.close();
process.exit(after > before && !/failed/.test(state) ? 0 : 1);

/* global setTimeout */
// Paints an asset with a chosen paint server from its Paint step, as the owner would (prompt 2b, UltraTex): picks the
// server in the step's model list, presses Run, waits for a new result, opens it and screenshots the Texture check
// tab, then sets the step back to the server it had. Starts one heavy paint job (ask the owner first); deletes nothing.
// Usage: CHROME=<chrome.exe> node e2e/paint-with-server.mjs <studio url> <screenshot dir> <game asset id> <server id>
//        [timeout seconds]
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

const [base, screens, assetId, serverId, limit = "1200"] = process.argv.slice(2);
if (!base || !screens || !assetId || !serverId) {
  console.error("usage: node e2e/paint-with-server.mjs <studio url> <screenshot dir> <game asset id> <server id>");
  process.exit(2);
}
mkdirSync(screens, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "google-chrome" });
const page = await browser.newPage({ viewport: { width: 1840, height: 1150 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
await page.goto(`${base}/#/a/${assetId}`, { waitUntil: "networkidle" });
const step = page.locator("#step-paint");
await step.waitFor({ timeout: 30000 });
const select = step.locator(`select:has(option[value="${serverId}"])`);
const previous = await select.inputValue();
const offered = await select.locator("option").allTextContents();
console.log(`paint servers offered: ${offered.join(" | ")}; current: ${previous}`);
await select.selectOption(serverId);
await page.waitForTimeout(1500);
await step.scrollIntoViewIfNeeded();
await step.screenshot({ path: join(screens, `${assetId}-paint-${serverId}-chosen.png`) });

const before = await step.locator(".result").count();
const run = step.locator(".step-actions button").first();
console.log(`results before: ${before}; pressing "${(await run.textContent())?.trim()}"`);
await run.click();
const started = Date.now();
while (Date.now() - started < Number(limit) * 1000) {
  await page.waitForTimeout(5000);
  if ((await step.locator(".result").count()) > before) break;
  process.stdout.write(`\rpaint (${serverId}): ${Math.round((Date.now() - started) / 1000)} s`);
}
console.log(`\nresults now: ${await step.locator(".result").count()} after ${Math.round((Date.now() - started) / 1000)} s`);
await page.waitForTimeout(3000);

// open the newest result: the Texture check tab shows for a painted result
await step.locator(".result").first().click();
await page.waitForTimeout(3000);
const pane = page.locator(".check-pane");
if (await pane.count()) {
  const tab = pane.getByRole("tab", { name: "Texture check" });
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(800);
  console.log("check pane:", (await pane.innerText()).replace(/\s+/g, " ").slice(0, 600));
  await pane.screenshot({ path: join(screens, `${assetId}-paint-${serverId}-texture-check.png`) });
} else {
  console.log("no check pane shown");
}
await page.screenshot({ path: join(screens, `${assetId}-paint-${serverId}-page.png`) });

await step.locator(`select:has(option[value="${serverId}"])`).selectOption(previous);
await page.waitForTimeout(1500);
console.log(`paint server set back to ${previous}`);
console.log(problems.length ? problems.join("\n") : "no page errors");
await browser.close();

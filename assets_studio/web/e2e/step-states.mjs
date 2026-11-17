// Read-only: prints each step's state (the step card's class) and any "Needs update" note on an asset page.
// Usage: node e2e/step-states.mjs <studio url> <game asset id> [screenshot.png]
import { chromium } from "playwright-core";

const [base, assetId, shot] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "google-chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto(`${base}/#/a/${assetId}`);
await page.locator("section.step").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
for (const step of await page.locator("section.step").all()) {
  const id = (await step.getAttribute("id")) ?? "";
  const state = ((await step.getAttribute("class")) ?? "").replace("step ", "");
  const notes = (await step.locator(".note").allTextContents()).map((t) => t.trim()).join(" | ");
  console.log(`${id.padEnd(20)} ${state.padEnd(16)} ${notes}`);
}
if (shot) await page.locator("#step-paint").screenshot({ path: shot });
await browser.close();

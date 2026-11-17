// Send to Godot from the asset page: picks the step whose result is sent and the project, presses Send to Godot
// (and Replace it, if asked), then prints the card. Writes one file into that project.
// Usage: node e2e/godot-send.mjs <studio url> <screenshot.png> <game asset id> <step id> <project path>
import { chromium } from "playwright-core";

const [base, shot, assetId, stepId, project] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "google-chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
await page.goto(`${base}/#/a/${assetId}`);
const card = page.locator("#step-godot");
await card.waitFor({ timeout: 30000 });
await card.scrollIntoViewIfNeeded();
const sendSelect = card.locator("label.field", { hasText: "Send" }).locator("select");
if (await sendSelect.count()) await sendSelect.selectOption(stepId);
await card.locator("label.field", { hasText: "Godot project" }).locator("select").selectOption(project);
await page.waitForTimeout(1500);
console.log("sending:", (await card.locator(".grow").first().innerText()).replace(/\n/g, " | "));
await card.locator("button", { hasText: /^(Send to Godot|Send again)$/ }).click();
const replace = card.locator("button", { hasText: "Replace it" });
await page.waitForTimeout(3000);
if (await replace.count()) await replace.click();
await page.waitForTimeout(8000);
await card.screenshot({ path: shot });
console.log((await card.innerText()).replace(/\n+/g, " | ").slice(0, 900));
for (const line of problems) console.log(line);
await browser.close();

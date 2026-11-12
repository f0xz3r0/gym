// The motion step with its result: the looping model, then the review film (animation pipeline v1.0).
import { chromium } from "playwright-core";
const [, , out, assetId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`http://127.0.0.1:9000/#/a/${assetId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const card = page.locator("section, article, .card, .step").filter({ hasText: "Animation pipeline v1.0: MiniMax-H3" }).last();
await card.scrollIntoViewIfNeeded();
const thumb = card.locator(".thumb, button:has(model-viewer), model-viewer").first();
if (await thumb.count()) await thumb.click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/5-motion-result-model.png` });
const film = page.locator("button", { hasText: "Review film" }).first();
console.log("review button:", await film.count());
if (await film.count()) { await film.click(); await page.waitForTimeout(4000); }
await page.screenshot({ path: `${out}/6-motion-result-review.png` });
console.log((await card.innerText()).slice(0, 600));
await browser.close();

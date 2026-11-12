// Animation pipeline v2.0 in the pipeline page: the Animation rig step's result, its tabs, the concept toggle.
import { chromium } from "playwright-core";
const [, , out, docId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
await page.goto(`http://127.0.0.1:9000/#/a/${docId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/15-concept-rigready.png`, clip: { x: 0, y: 120, width: 760, height: 620 } });
const card = page.locator("#step-animrig");
await card.scrollIntoViewIfNeeded();
await card.locator(".result").first().click();
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/16-animrig-model.png` });
for (const [name, file] of [["Rig test poses", "17-animrig-poses"], ["Skeleton sheet", "18-animrig-skeleton"]]) {
  const b = page.getByRole("button", { name });
  if (await b.count()) { await b.click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${file}.png` }); }
  else console.log("missing tab", name);
}
console.log("motion card:", (await page.locator("#step-motion").innerText()).slice(0, 300));
await browser.close();

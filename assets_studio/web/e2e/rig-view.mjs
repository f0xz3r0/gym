// Pipeline page: pick the Skeleton step's result and screenshot the viewer with the skeleton on.
import { chromium } from "playwright-core";
const [, , out, docId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
await page.goto(`http://127.0.0.1:9000/#/a/${docId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const card = page.locator("#step-rig");
await card.scrollIntoViewIfNeeded();
await card.locator(".result").first().click();
await page.waitForTimeout(9000);
const bar = page.locator(".inspect-bar");
console.log("inspect bar:", await bar.count(), (await bar.count()) ? await bar.innerText() : "");
await page.screenshot({ path: `${out}/13-rig-skeleton.png` });
const clay = page.getByRole("button", { name: "Clay" });
if (await clay.count()) { await clay.click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/14-rig-clay.png` }); }
await browser.close();

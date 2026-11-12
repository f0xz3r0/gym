// Counts steps on an asset page that still show the "older version of an earlier step" warning.
import { chromium } from "playwright-core";
const [, , out, assetId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
await page.goto(`http://127.0.0.1:9000/#/a/${assetId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
console.log("stale warnings:", await page.getByText("made from an older version").count());
await page.screenshot({ path: `${out}/7-no-stale.png`, fullPage: true });
await browser.close();

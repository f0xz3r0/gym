// Concept step with a reference picture: screenshot, press Run, report the job created.
import { chromium } from "playwright-core";
const [, , out, docId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jobs = [];
page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/jobs")) jobs.push(r.postData()); });
await page.goto(`http://127.0.0.1:9000/#/a/${docId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/8-reference-card.png`, clip: { x: 0, y: 0, width: 760, height: 700 } });
const card = page.locator("#step-concept");
await card.getByRole("button", { name: /^Run/ }).first().click();
await page.waitForTimeout(3000);
console.log(jobs.join("\n"));
await browser.close();

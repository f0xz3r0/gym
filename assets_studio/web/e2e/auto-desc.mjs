// Concept Run with only a short idea: the description is written first, then the image job uses it.
import { chromium } from "playwright-core";
const [, , docId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const posts = [];
page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/jobs")) posts.push(JSON.parse(r.postData())); });
await page.goto(`http://127.0.0.1:9000/#/a/${docId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.locator("#step-concept").getByRole("button", { name: /^Run/ }).first().click();
for (let i = 0; i < 90 && posts.length < 2; i++) await page.waitForTimeout(2000);
for (const p of posts) console.log(p.server, p.task, "|", (p.prompt || "").slice(0, 160), "...", (p.prompt || "").split(/\s+/).length, "words");
console.log("description box:", (await page.locator("#step-concept textarea").inputValue()).slice(0, 120));
await browser.close();

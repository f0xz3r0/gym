import { chromium } from "playwright-core";
const [, , out] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
for (const [h, n] of [["#/", "25-home"], ["#/library", "26-library"], ["#/queue", "27-queue"], ["#/models", "28-models"], ["#/builder", "29-builder"], ["#/frames", "30-frames"], ["#/a/e5736e63b980", "31-asset"]]) {
  await page.goto("http://127.0.0.1:9000/" + h, { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${n}.png` });
  console.log(h, (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 90));
}
await page.goto("http://127.0.0.1:9000/classic", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
console.log("classic lands on", page.url());
console.log("errors", errors);
await browser.close();

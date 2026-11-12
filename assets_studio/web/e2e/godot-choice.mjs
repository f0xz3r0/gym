import { chromium } from "playwright-core";
const [, , out, docId] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:9000/#/a/${docId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
for (const id of ["#step-godot", "#step-mocap"]) {
  const el = page.locator(id);
  if (await el.count()) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); console.log(id, (await el.innerText()).replace(/\n/g, " | ").slice(0, 300)); }
  else console.log(id, "not shown");
}
await page.locator("#step-godot").screenshot({ path: `${out}/24-godot-choice.png` });
console.log("errors", errors);
await browser.close();

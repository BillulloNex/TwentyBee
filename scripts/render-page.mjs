// Prints a page's visible text after JavaScript runs, for agents that only have a terminal (Wix, Squarespace, booking apps).
// Usage: node scripts/render-page.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const response = await page.goto(process.argv[2], { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  // Sites with chat widgets or trackers never go network-idle, so wait for the load event briefly, then settle.
  await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log(`URL: ${page.url()} (HTTP ${response?.status() ?? "?"})\n`);
  console.log((await page.evaluate(() => document.body?.innerText ?? "")).slice(0, 30000));
} finally {
  await browser.close();
}

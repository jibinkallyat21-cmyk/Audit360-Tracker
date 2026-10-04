import { chromium } from "playwright-core";
const out = process.argv[2];
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const errors = [];
for (const [name, theme, w, h] of [
  ["dark", "dark", 1366, 900],
  ["light", "light", 1366, 900],
  ["phone-dark", "dark", 390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto("http://localhost:3120/styleguide", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/${name}-top.png` });
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  if (name === "dark") {
    const fonts = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    );
    console.log("fonts loaded:", fonts);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log("theme attr:", theme);
  }
  await ctx.close();
}
console.log("console errors:", errors);
await browser.close();

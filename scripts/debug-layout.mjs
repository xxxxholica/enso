import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForTimeout(300);

const info = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: r.width, h: r.height, display: cs.display, height: cs.height, minHeight: cs.minHeight, flex: cs.flex };
  };
  return {
    html: rect(document.documentElement),
    body: rect(document.body),
    app: rect(sel("#app")),
    viewNav: rect(sel(".view-nav")),
    main: rect(sel(".app-main")),
    viewPanel: rect(sel(".view-panel")),
    canvasPanel: rect(sel("#canvas-panel")),
    footer: rect(sel(".app-footer")),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();

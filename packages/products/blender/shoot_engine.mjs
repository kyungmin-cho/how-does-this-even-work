// Screenshots of the engine dev page with the Blender GLB (not part of the e2e suite).
//
//   BASE=http://localhost:3291 node packages/products/blender/shoot_engine.mjs
//
// Writes apps/web/e2e/__screens__/pc_glb/*.png and prints the GLB load state.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "..", "apps", "web");
const { chromium } = createRequire(join(web, "package.json"))("@playwright/test");
const OUT = join(web, "e2e", "__screens__", "pc_glb");
const BASE = process.env.BASE ?? "http://localhost:3291";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "warning" && m.text().includes("[engine]") && errors.push(m.text()));

const state = () => page.evaluate(() => window.__engine.getState());
const settle = async (ms = 1500) => {
  for (let i = 0; i < 60; i++) {
    if (!(await state()).animating) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(ms);
};
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });

await page.goto(`${BASE}/dev/engine?product=pc_atx`);
await page.waitForFunction(() => window.__engine?.getState().productId === "pc_atx", null, { timeout: 120_000 });
for (let i = 0; i < 80; i++) {
  const s = await state();
  if (s.assets && s.assets.status !== "loading") break;
  await page.waitForTimeout(250);
}
const s0 = await state();
console.log("assets:", JSON.stringify(s0.assets));
await settle();
await shot("01-assembled");

await page.evaluate(() => window.__engine.explode(0.7));
await settle();
await shot("02-exploded");
await page.evaluate(() => window.__engine.explode(0));
await settle(500);

await page.evaluate(() => window.__engine.highlight(["gpu"], "error"));
await settle();
await shot("03-gpu-error");
await page.evaluate(() => window.__engine.highlight(["ram"], "ok"));
await page.evaluate(() => window.__engine.setView("ram_area"));
await settle();
await shot("04-ram-ok");

// one guide, middle item
const product = await page.evaluate(() => window.__engine.getProduct());
const guide = product.guides.find((g) => g.id === "guide_add_ssd") ?? product.guides[0];
const n = await page.evaluate(async (gid) => {
  const e = window.__engine;
  const p = e.getProduct();
  const g = p.guides.find((x) => x.id === gid);
  const mod = window.__planService;
  return { has: !!mod, steps: p.assembly.length };
}, guide.id);
// The dev page has guide buttons; click the one for this guide, then step forward to the middle.
const btn = page.getByRole("button", { name: guide.title });
if (await btn.count()) {
  await btn.first().click();
  await settle(800);
  const len = (await state()).procedure?.length ?? 0;
  const mid = Math.floor(len / 2);
  await page.evaluate((i) => window.__engine.goTo(i), mid);
  await settle();
  const s = await state();
  console.log("guide:", guide.id, "item", mid, "/", len, s.procedure?.item?.stepId);
  await shot(`05-guide-${guide.id}-${mid}`);
} else {
  console.log("guide button not found", n);
}

await page.evaluate(() => window.__engine.showStep("s_m2"));
await settle();
await shot("06-step-m2");
await page.evaluate(() => window.__engine.showStep("s_cooler"));
await settle();
await shot("07-step-cooler");

for (const [step, mistake] of [["s_ram", "ram_notch_reversed"], ["s_cooler", "cooler_straight_pull"]]) {
  await page.evaluate(([st, m]) => window.__engine.showMistake(st, m), [step, mistake]);
  await settle(2200);
  await shot(`08-mistake-${mistake}`);
  await page.evaluate(() => window.__engine.clearMistake());
}

console.log("errors:", errors.length ? errors : "none");
await browser.close();

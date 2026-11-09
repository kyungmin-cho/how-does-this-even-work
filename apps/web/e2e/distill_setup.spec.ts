import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { EngineState } from "@assembly/engine";

// Visual check of the distill_setup product on the engine dev page (`/dev/engine?product=distill_setup`).
// Screenshots go to e2e/__screens__/distill_setup/ and are meant to be looked at by a person.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const DIR = "e2e/__screens__/distill_setup";
const state = (page: Page) => page.evaluate(() => window.__engine!.getState()) as Promise<EngineState>;
const settled = async (page: Page) => {
  await expect.poll(async () => (await state(page)).animating, { timeout: 45_000 }).toBe(false);
  await page.waitForTimeout(900); // camera glide
};
const ready = (page: Page) =>
  page.waitForFunction(() => window.__engine?.getState().productId === "distill_setup", null, { timeout: 60_000 });
/**
 * Other sessions edit the shared dev server's sources, and a hot reload drops `window.__engine`
 * mid-phase. Each phase starts from a known state, so it can simply run again after a reload.
 */
const phase = async (page: Page, fn: () => Promise<void>) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await ready(page);
      return await fn();
    } catch (e) {
      const reloaded = await page.evaluate(() => !window.__engine).catch(() => true);
      if (attempt >= 3 || !(reloaded || String(e).includes("__engine") || String(e).includes("undefined"))) throw e;
      await page.waitForTimeout(1500);
    }
  }
};
const shot = (page: Page, name: string) => page.locator("[data-testid=engine-host]").screenshot({ path: `${DIR}/${name}.png` });

const GUIDES: { id: string; keys: string[]; at: string[] }[] = [
  {
    id: "guide_temp_wrong",
    keys: ["extra:x_t_goggles", "extra:x_t_heat_off", "extra:x_t_cool", "remove:s_thermo", "extra:x_t_height", "extra:x_t_set", "install:s_thermo"],
    at: ["extra:x_t_heat_off", "remove:s_thermo", "extra:x_t_height", "install:s_thermo"],
  },
  {
    id: "guide_bumping",
    keys: [
      "extra:x_b_goggles", "extra:x_b_heat_off", "extra:x_b_cool", "remove:s_thermo", "remove:s_stopper", "remove:s_chips",
      "extra:x_b_fill", "extra:x_b_new_chips", "install:s_chips", "install:s_stopper", "install:s_thermo",
    ], // prettier-ignore
    at: ["remove:s_stopper", "extra:x_b_fill", "install:s_chips"],
  },
];

test("distill_setup: assembled, guide steps and mistakes", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop dev page");
  test.setTimeout(600_000); // the shared dev machine can be very loaded
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/engine?product=distill_setup");
  await ready(page);
  const all = await page.evaluate(() => window.__engine!.getProduct()!.assembly.map((s) => s.id));
  expect(all).toHaveLength(16);
  expect((await state(page)).installedStepIds).toEqual(all);
  await expect.poll(async () => (await state(page)).assets?.status, { timeout: 30_000 }).toBe("ready");
  expect((await state(page)).assets!.glbParts).toHaveLength(16);
  await settled(page);
  await shot(page, "00-assembled");

  // Close-ups of the two places students get wrong.
  for (const view of ["thermo_area", "condenser_area", "flask_area"]) {
    await phase(page, async () => {
      await page.evaluate((v) => window.__engine!.setView(v), view);
      await settled(page);
      await shot(page, `01-${view}`);
    });
  }

  // Build order, from the bottom up: halfway (flask in, nothing on it yet).
  await phase(page, async () => {
    // Jump without the 12 removal animations (slow under SwiftShader), then let showStep frame it.
    await page.evaluate((ids) => window.__engine!.applyState(ids.slice(0, ids.indexOf("s_flask") + 1), { animate: false }), all);
    await page.evaluate(() => window.__engine!.showStep("s_flask"));
    await settled(page);
    await shot(page, "02-step-s_flask");
  });

  for (const g of GUIDES) await phase(page, async () => {
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
    await settled(page);
    await page.locator(`[data-guide="${g.id}"]`).click();
    const proc = await page.evaluate(() => window.__engine!.getState().procedure!);
    expect(proc.guideId).toBe(g.id);
    const keys = await page.evaluate(() => {
      const e = window.__engine!;
      const n = e.getState().procedure!.length;
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        e.goTo(i);
        const it = e.getState().procedure!.item!;
        out.push(`${it.kind}:${it.stepId}`);
      }
      e.goTo(0);
      return out;
    });
    expect(keys).toEqual(g.keys);
    for (const key of g.at) {
      const index = keys.indexOf(key);
      await page.evaluate((i) => window.__engine!.goTo(i), index);
      await settled(page);
      await shot(page, `${g.id}-${String(index).padStart(2, "0")}-${key.replace(":", "-")}`);
    }
  });

  // Mistakes: wrong way (red) next to the right way (green).
  await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
  await settled(page);
  const mistakes = await page.evaluate(() =>
    window.__engine!.getProduct()!.assembly.flatMap((s) => s.mistakes.map((m) => [s.id, m.id] as const)),
  );
  expect(mistakes.map(([, m]) => m)).toEqual(["thermo_too_high", "thermo_too_low", "hose_swapped"]);
  for (const [stepId, mistakeId] of mistakes) await phase(page, async () => {
    await page.evaluate(([s, m]) => window.__engine!.showMistake(s, m), [stepId, mistakeId] as const);
    expect((await state(page)).mistake).toEqual({ stepId, mistakeId });
    await page.waitForTimeout(2400); // camera glide + one pass of the wrong motion
    await shot(page, `mistake-${mistakeId}`);
    await page.evaluate(() => window.__engine!.clearMistake());
  });

  // Hot-reload noise from the shared dev server is not ours; anything else is.
  expect(errors.filter((m) => !/__engine|Fast Refresh|hot/i.test(m))).toEqual([]);
});

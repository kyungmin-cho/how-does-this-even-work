import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { EngineState } from "@assembly/engine";

// Visual check of the car_tire product on the engine dev page (`/dev/engine?product=car_tire`).
// Screenshots go to e2e/__screens__/car_tire/ and are meant to be looked at by a person.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const DIR = "e2e/__screens__/car_tire";
const state = (page: Page) => page.evaluate(() => window.__engine!.getState()) as Promise<EngineState>;
const settled = async (page: Page) => {
  await expect.poll(async () => (await state(page)).animating, { timeout: 120_000 }).toBe(false);
  await page.waitForTimeout(900); // camera glide
};
const shot = (page: Page, name: string) => page.locator("[data-testid=engine-host]").screenshot({ path: `${DIR}/${name}.png` });

const GUIDES: { id: string; keys: string[]; at: string[] }[] = [
  {
    id: "guide_flat_tire",
    keys: [
      "extra:x_ft_park",
      "extra:x_ft_triangle",
      "extra:x_ft_chock",
      "extra:x_ft_cover_off",
      "extra:x_ft_loosen",
      "extra:x_ft_jack",
      "remove:s_nuts",
      "extra:x_ft_flat_off",
      "extra:x_ft_spare",
      "install:s_nuts",
    ],
    at: [
      "extra:x_ft_triangle",
      "extra:x_ft_chock",
      "extra:x_ft_loosen",
      "extra:x_ft_jack",
      "remove:s_nuts",
      "extra:x_ft_flat_off",
      "extra:x_ft_spare",
      "install:s_nuts",
    ],
  },
  {
    id: "guide_recheck_nuts",
    keys: ["extra:x_rc_park", "remove:s_cover", "extra:x_rc_tighten", "install:s_cover"],
    at: ["extra:x_rc_tighten"],
  },
];

test("car_tire: assembled, guide steps and mistakes", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop dev page");
  test.setTimeout(600_000); // SwiftShader draws this large scene slowly (seconds per frame)
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto("/dev/engine?product=car_tire");
  await page.waitForFunction(() => window.__engine?.getState().productId === "car_tire", null, { timeout: 60_000 });
  const all = await page.evaluate(() => window.__engine!.getProduct()!.assembly.map((s) => s.id));
  expect(all).toEqual(["s_ground", "s_body", "s_hub", "s_wheel", "s_nuts", "s_cover"]);
  expect((await state(page)).installedStepIds).toEqual(all);
  await expect.poll(async () => (await state(page)).assets?.status, { timeout: 30_000 }).toBe("ready");
  expect((await state(page)).assets?.glbParts.length).toBe(11);
  await settled(page);
  await shot(page, "00-assembled");
  await page.evaluate(() => window.__engine!.setView("wheel"));
  await settled(page);
  await shot(page, "01-assembled-wheel");

  for (const g of GUIDES) {
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
    await settled(page);
    await page.locator(`[data-guide="${g.id}"]`).click();
    expect((await state(page)).procedure?.guideId).toBe(g.id);
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
  }

  // Mistakes: wrong way (red) next to the right way (green), from the assembled state.
  await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
  await settled(page);
  const mistakes = await page.evaluate(() =>
    window.__engine!.getProduct()!.assembly.flatMap((s) => s.mistakes.map((m) => [s.id, m.id] as const)),
  );
  expect(mistakes).toEqual([
    ["s_body", "jack_wrong_point"],
    ["s_nuts", "nut_reversed"],
  ]);
  for (const [stepId, mistakeId] of mistakes) {
    await page.evaluate(([s, m]) => window.__engine!.showMistake(s, m), [stepId, mistakeId] as const);
    expect((await state(page)).mistake).toEqual({ stepId, mistakeId });
    await page.waitForTimeout(2600); // camera glide + one pass of the wrong motion
    await shot(page, `mistake-${mistakeId}`);
    await page.evaluate(() => window.__engine!.clearMistake());
  }

  expect(errors).toEqual([]);
});

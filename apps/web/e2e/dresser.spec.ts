import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { EngineState } from "@assembly/engine";

// Visual check of the dresser product on the engine dev page (`/dev/engine?product=dresser`).
// Screenshots go to e2e/__screens__/dresser/ and are meant to be looked at by a person.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const DIR = "e2e/__screens__/dresser";
const state = (page: Page) => page.evaluate(() => window.__engine!.getState()) as Promise<EngineState>;
const settled = async (page: Page) => {
  await expect.poll(async () => (await state(page)).animating, { timeout: 180_000 }).toBe(false);
  await page.waitForTimeout(900); // camera glide
};
// Clip a page screenshot to the 3D host (an element screenshot can wait forever for "stable" while the
// side panel reflows during a procedure).
const shot = async (page: Page, name: string) => {
  const box = (await page.locator("[data-testid=engine-host]").boundingBox())!;
  await page.screenshot({ path: `${DIR}/${name}.png`, clip: box });
};

const GUIDES: { id: string; keys: string[]; at: string[] }[] = [
  {
    id: "guide_drawer_wont_close",
    keys: [
      "extra:x_dr_anchor",
      "remove:s_drawer_1",
      "remove:s_drawer_2",
      "remove:s_drawer_3",
      "remove:s_rail_right",
      "extra:x_dr_compare",
      "extra:x_dr_push",
      "install:s_rail_right",
      "install:s_drawer_3",
      "install:s_drawer_2",
      "install:s_drawer_1",
    ],
    at: ["remove:s_drawer_3", "remove:s_rail_right", "extra:x_dr_compare"],
  },
  {
    id: "guide_tip_over",
    keys: [
      "extra:x_tip_drawers",
      "remove:s_tip_strap",
      "remove:s_wall_bracket",
      "extra:x_tip_wall",
      "extra:x_tip_line",
      "install:s_wall_bracket",
      "install:s_tip_strap",
    ],
    at: ["remove:s_tip_strap", "extra:x_tip_wall", "install:s_tip_strap"],
  },
];

test("dresser: assembled, guide steps and mistakes", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop dev page");
  test.setTimeout(1_500_000); // SwiftShader on a shared, busy machine
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1200, height: 780 });
  await page.goto("/dev/engine?product=dresser");
  await page.waitForFunction(() => window.__engine?.getState().productId === "dresser", null, { timeout: 60_000 });
  const all = await page.evaluate(() => window.__engine!.getProduct()!.assembly.map((s) => s.id));
  expect(all).toHaveLength(15);
  expect((await state(page)).installedStepIds).toEqual(all);
  // The GLB loads and replaces every part.
  await expect.poll(async () => (await state(page)).assets?.status, { timeout: 30_000 }).toBe("ready");
  expect((await state(page)).assets!.glbParts).toHaveLength(15);
  await settled(page);
  await shot(page, "00-assembled");

  // Carcass with the runners, drawers out: the rollers sit at the front on both sides.
  await page.evaluate((ids) => {
    const e = window.__engine!;
    e.applyState(ids.slice(0, ids.indexOf("s_rail_right") + 1), { animate: false });
    e.setView("rails");
    e.mark("rail_left_roller");
    e.mark("rail_right_roller");
  }, all);
  await settled(page);
  await shot(page, "01-runners");

  for (const g of GUIDES) {
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
    await settled(page);
    await page.locator(`[data-guide="${g.id}"]`).click();
    expect((await state(page)).procedure!.guideId).toBe(g.id);
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

  // Mistakes: wrong way (red) next to the right way (green).
  await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
  await settled(page);
  const mistakes = await page.evaluate(() =>
    window.__engine!.getProduct()!.assembly.flatMap((s) => s.mistakes.map((m) => [s.id, m.id] as const)),
  );
  expect(mistakes).toHaveLength(3);
  for (const [stepId, mistakeId] of mistakes) {
    await page.evaluate(([s, m]) => window.__engine!.showMistake(s, m), [stepId, mistakeId] as const);
    expect((await state(page)).mistake).toEqual({ stepId, mistakeId });
    await page.waitForTimeout(stepId === "s_tip_strap" ? 2600 : 2200); // camera glide + one pass of the wrong motion
    await shot(page, `mistake-${mistakeId}`);
    await page.evaluate(() => window.__engine!.clearMistake());
  }

  expect(errors).toEqual([]);
});

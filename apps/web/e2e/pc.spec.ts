import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { EngineState } from "@assembly/engine";

// Visual check of the pc_atx product on the engine dev page (`/dev/engine?product=pc_atx`).
// Screenshots go to e2e/__screens__/pc/ and are meant to be looked at by a person.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const DIR = "e2e/__screens__/pc";
const state = (page: Page) => page.evaluate(() => window.__engine!.getState()) as Promise<EngineState>;
const settled = async (page: Page) => {
  await expect.poll(async () => (await state(page)).animating, { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(900); // camera glide
};
const shot = (page: Page, name: string) => page.locator("[data-testid=engine-host]").screenshot({ path: `${DIR}/${name}.png` });

const GUIDES: { id: string; at: string[] }[] = [
  { id: "guide_overheat", at: ["remove:s_cooler", "extra:x_oh_triangle", "extra:x_oh_paste"] },
  { id: "guide_ram_not_detected", at: ["remove:s_ram", "extra:x_ram_slots"] },
  { id: "guide_add_ssd", at: ["remove:s_gpu", "remove:s_m2", "extra:x_ssd_angle"] },
  { id: "guide_replace_gpu", at: ["remove:s_gpu_power", "extra:x_gpu_latch"] },
];

test("pc_atx: assembled, guide steps and mistakes", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop dev page");
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/engine?product=pc_atx");
  await page.waitForFunction(() => window.__engine?.getState().productId === "pc_atx", null, { timeout: 60_000 });
  const all = await page.evaluate(() => window.__engine!.getProduct()!.assembly.map((s) => s.id));
  expect(all).toHaveLength(15);
  expect((await state(page)).installedStepIds).toEqual(all);
  await settled(page);
  await shot(page, "00-assembled");

  // Panel off, for a clear look inside.
  await page.evaluate((ids) => window.__engine!.applyState(ids.filter((id) => id !== "s_side_panel"), { animate: false }), all);
  await settled(page);
  await shot(page, "01-assembled-open");

  // M.2 going in at 30 degrees (paused mid-path) to confirm the tilt direction.
  await page.evaluate(() => window.__engine!.showStep("s_cpu"));
  await settled(page);
  await page.evaluate(() => window.__engine!.showStep("s_m2"));
  await page.waitForTimeout(450);
  await page.evaluate(() => window.__engine!.pause());
  await page.waitForTimeout(900);
  await shot(page, "02-m2-insert-30deg");
  await page.evaluate(() => window.__engine!.play());
  await settled(page);

  for (const g of GUIDES) {
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), all);
    await settled(page);
    await page.locator(`[data-guide="${g.id}"]`).click();
    const proc = await page.evaluate(() => window.__engine!.getState().procedure!);
    expect(proc.guideId).toBe(g.id);
    const items = await page.evaluate(
      (id) => {
        const e = window.__engine!;
        // The dev page builds the same procedure; read item keys from state by walking goTo.
        const n = e.getState().procedure!.length;
        const keys: string[] = [];
        for (let i = 0; i < n; i++) {
          e.goTo(i);
          const it = e.getState().procedure!.item!;
          keys.push(`${it.kind}:${it.stepId}`);
        }
        e.goTo(0);
        return { id, keys };
      },
      g.id,
    );
    // Three safety steps (beforeRemoval) come first, then the side panel.
    expect(items.keys.slice(0, 3).map((k) => k.split("_").at(-1))).toEqual(["off", "drain", "esd"]);
    expect(items.keys[3]).toBe("remove:s_side_panel");
    for (const key of g.at) {
      const index = items.keys.indexOf(key);
      expect(index, key).toBeGreaterThanOrEqual(0);
      await page.evaluate((i) => window.__engine!.goTo(i), index);
      await settled(page);
      await shot(page, `${g.id}-${String(index).padStart(2, "0")}-${key.replace(":", "-")}`);
    }
  }

  // Mistakes: wrong way (red) next to the right way (green).
  await page.evaluate((ids) => window.__engine!.applyState(ids.filter((id) => id !== "s_side_panel"), { animate: false }), all);
  await settled(page);
  const mistakes = await page.evaluate(() =>
    window.__engine!.getProduct()!.assembly.flatMap((s) => s.mistakes.map((m) => [s.id, m.id] as const)),
  );
  expect(mistakes).toHaveLength(7);
  for (const [stepId, mistakeId] of mistakes) {
    await page.evaluate(([s, m]) => window.__engine!.showMistake(s, m), [stepId, mistakeId] as const);
    expect((await state(page)).mistake).toEqual({ stepId, mistakeId });
    await page.waitForTimeout(2400); // camera glide + one pass of the wrong motion
    await shot(page, `mistake-${mistakeId}`);
    await page.evaluate(() => window.__engine!.clearMistake());
  }

  expect(errors).toEqual([]);
});

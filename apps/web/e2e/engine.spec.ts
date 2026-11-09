import { expect, test, type Page } from "@playwright/test";
import type { EngineState } from "@assembly/engine";

// Headless Chromium needs SwiftShader for WebGL.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const state = (page: Page) => page.evaluate(() => window.__engine!.getState()) as Promise<EngineState>;
const settled = (page: Page) =>
  expect.poll(async () => (await state(page)).animating, { timeout: 15_000 }).toBe(false);

test("engine dev page drives steps, highlight, procedure and camera", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/dev/engine");
  await page.waitForFunction(() => window.__engine?.getState().productId === "sample-pc", null, { timeout: 60_000 });

  // StrictMode double mount must not leave two scenes behind.
  await expect(page.locator("[data-testid=engine-host] canvas")).toHaveCount(1);

  let s = await state(page);
  expect(s.installedStepIds).toEqual(["s_case", "s_board", "s_m2", "s_heatsink", "s_gpu", "s_panel"]);
  expect(s.view).toBe("default");
  expect(s.cameraOwner).toBe("agent");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/engine-initial.png" });

  // Step button (UI) and engine API agree.
  await page.locator('[data-step="s_m2"]').click();
  s = await state(page);
  expect(s.installedStepIds).toEqual(["s_case", "s_board", "s_m2"]);
  expect(s.currentStepId).toBe("s_m2");
  expect(s.highlight).toEqual({ mode: "focus", partIds: ["m2_ssd"] });
  expect(s.marks.map((m) => m.featureId)).toEqual(["m2_slot", "m2_notch"]);
  expect(s.view).toBe("m2_area");

  // Rapid commands: the last one wins, state is exact right away.
  await page.evaluate(() => {
    const e = window.__engine!;
    e.showStep("s_case");
    e.showStep("s_panel");
    e.showStep("s_gpu");
  });
  s = await state(page);
  expect(s.installedStepIds).toEqual(["s_case", "s_board", "s_m2", "s_heatsink", "s_gpu"]);
  await settled(page);

  await page.evaluate(() => window.__engine!.highlight(["gpu"], "error"));
  s = await state(page);
  expect(s.highlight).toEqual({ mode: "error", partIds: ["gpu"] });
  await expect(page.evaluate(() => window.__engine!.highlight(["nope"], "ok"))).rejects.toThrow(/unknown part/);

  // Full assembly, then the SSD guide procedure.
  await page.evaluate(() => window.__engine!.applyState(window.__engine!.getProduct()!.assembly.map((x) => x.id), { animate: false }));
  await page.locator('[data-guide="ssd_not_detected"]').click();
  s = await state(page);
  expect(s.procedure).toMatchObject({ targetPartId: "m2_ssd", guideId: "ssd_not_detected", index: 0, length: 10 });
  expect(s.procedure!.item).toMatchObject({ kind: "remove", stepId: "s_panel" });
  expect(s.installedStepIds).not.toContain("s_panel");
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__engine!.next());
  s = await state(page);
  expect(s.procedure!.item).toMatchObject({ kind: "extra", stepId: "x_check_slot" });
  expect(s.installedStepIds).toEqual(["s_case", "s_board"]);
  expect(s.marks.map((m) => m.featureId)).toEqual(["m2_slot"]);
  await settled(page);
  await expect(page.locator("[data-feature-id=m2_slot]")).toBeVisible();

  // People first: a drag takes the camera, resumeGuide gives it back.
  const box = (await page.locator("[data-testid=engine-host] canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  s = await state(page);
  expect(s.cameraOwner).toBe("user");
  await page.evaluate(() => window.__engine!.next());
  expect((await state(page)).cameraOwner).toBe("user");
  await page.evaluate(() => window.__engine!.resumeGuide());
  expect((await state(page)).cameraOwner).toBe("agent");

  await page.evaluate(() => window.__engine!.prev());
  await settled(page);
  await page.waitForTimeout(800); // let the camera glide finish
  await page.screenshot({ path: "test-results/engine-procedure.png" });

  // Exploded view with the GPU in error, for a visual check.
  await page.evaluate(() => {
    const e = window.__engine!;
    e.goTo(e.getState().procedure!.length - 1);
  });
  await settled(page);
  await page.evaluate(() => {
    const e = window.__engine!;
    e.highlight(["gpu"], "error");
    e.explode(0.6);
    e.setView("default");
  });
  await page.waitForTimeout(1200);
  expect((await state(page)).explode).toBe(0.6);
  await page.screenshot({ path: "test-results/engine-explode.png" });

  // The canvas actually draws something (not a blank background).
  const drawn = await page.evaluate(() => {
    const src = document.querySelector<HTMLCanvasElement>("[data-testid=engine-host] canvas")!;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const colors = new Set<number>();
    for (let i = 0; i < d.length; i += 4) colors.add((d[i]! >> 4) * 256 + (d[i + 1]! >> 4) * 16 + (d[i + 2]! >> 4));
    return colors.size;
  });
  expect(drawn).toBeGreaterThan(5);

  expect(errors).toEqual([]);
});

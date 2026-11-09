import { chromium, expect, test, type Page } from "@playwright/test";
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
  // GLB parts arrive asynchronously and replace their boxes.
  await expect.poll(async () => (await state(page)).assets!.status, { timeout: 15_000 }).toBe("ready");
  expect((await state(page)).assets!.glbParts.sort()).toEqual(["gpu", "m2_heatsink"]);
  s = await state(page);
  const ALL = ["s_case", "s_board", "s_m2", "s_heatsink", "s_gpu", "s_gpu_cable", "s_panel"];
  expect(s.installedStepIds).toEqual(ALL);
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
  expect(s.procedure).toBeNull();
  await settled(page);

  await page.evaluate(() => window.__engine!.highlight(["gpu"], "error"));
  s = await state(page);
  expect(s.highlight).toEqual({ mode: "error", partIds: ["gpu"] });
  await expect(page.evaluate(() => window.__engine!.highlight(["nope"], "ok"))).rejects.toThrow(/unknown part/);

  // Full assembly, then the SSD guide procedure.
  await page.evaluate(() => window.__engine!.applyState(window.__engine!.getProduct()!.assembly.map((x) => x.id), { animate: false }));
  await page.locator('[data-guide="ssd_not_detected"]').click();
  s = await state(page);
  expect(s.procedure).toMatchObject({ targetPartId: "m2_ssd", guideId: "ssd_not_detected", index: 0, length: 13 });
  expect(s.procedure!.item).toMatchObject({ kind: "remove", stepId: "s_panel" });
  expect(s.installedStepIds).not.toContain("s_panel");
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__engine!.next());
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

  // Peek: a side question changes highlight and camera but not the procedure position.
  await page.evaluate(() => window.__engine!.goTo(5));
  await settled(page);
  const before = await state(page);
  expect(before.procedure!.item!.stepId).toBe("x_check_slot");
  await page.evaluate(() => window.__engine!.peek("gpu_power"));
  s = await state(page);
  expect(s.peek).toEqual({ partIds: ["gpu"], featureId: "gpu_power" });
  expect(s.highlight).toEqual({ mode: "focus", partIds: ["gpu"] });
  expect(s.marks.map((m) => m.featureId)).toEqual(["gpu_power"]);
  expect(s.procedure!.index).toBe(5);
  expect(s.installedStepIds).toEqual(before.installedStepIds);
  await page.evaluate(() => window.__engine!.resumeProcedure());
  s = await state(page);
  expect(s.peek).toBeNull();
  expect(s.highlight).toEqual(before.highlight);
  expect(s.marks).toEqual(before.marks);
  expect(s.view).toBe(before.view);

  // Consumable extra step: thermal pad appears and stays until the procedure ends.
  await page.evaluate(() => window.__engine!.goTo(7));
  s = await state(page);
  expect(s.procedure!.item).toMatchObject({ stepId: "x_thermal_pad", partId: "thermal_pad" });
  expect(s.appliedExtraStepIds).toEqual(["x_check_slot", "x_reseat", "x_thermal_pad"]);
  await settled(page);
  expect(await page.evaluate(() => window.__engine!.getState().appliedExtraStepIds.length)).toBe(3);

  // Mistake next to the right way, without moving the procedure.
  await page.evaluate(() => window.__engine!.goTo(8));
  await settled(page);
  await page.evaluate(() => window.__engine!.showMistake("s_m2", "m2_flat"));
  s = await state(page);
  expect(s.mistake).toEqual({ stepId: "s_m2", mistakeId: "m2_flat" });
  expect(s.marks).toEqual([{ featureId: "m2_slot", label: "✕ M.2 슬롯" }]);
  expect(s.procedure!.index).toBe(8);
  await expect(page.evaluate(() => window.__engine!.showMistake("s_m2", "nope"))).rejects.toThrow(/unknown mistake/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/engine-mistake.png" });
  await page.evaluate(() => window.__engine!.resumeProcedure());
  s = await state(page);
  expect(s.mistake).toBeNull();
  expect(s.highlight).toEqual({ mode: "focus", partIds: ["m2_ssd"] });

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

  // GLB parts close up (side panel off, no highlight).
  await page.evaluate(() => {
    const e = window.__engine!;
    e.explode(0);
    e.showStep("s_gpu_cable");
    e.highlight([], "none");
    e.clearMarks();
    e.setView("gpu_area");
  });
  await settled(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/engine-glb.png" });

  // A broken GLB must not break the demo: parts fall back to boxes.
  await page.evaluate(() => {
    const e = window.__engine!;
    e.loadProduct({ ...e.getProduct()!, assets: { glb: "/dev-engine/missing.glb", scale: 1 } });
  });
  await expect.poll(async () => (await state(page)).assets!.status, { timeout: 15_000 }).toBe("error");
  s = await state(page);
  expect(s.assets!.glbParts).toEqual(["m2_heatsink"]); // its own gltf url still loads
  expect(s.assets!.errors[0]).toContain("missing.glb");
  expect(s.installedStepIds).toEqual(ALL);
  await page.evaluate(() => window.__engine!.highlight(["gpu"], "focus"));
  expect((await state(page)).highlight.partIds).toEqual(["gpu"]);

  expect(errors).toEqual([]);
});

async function measureProcedure(page: Page) {
  await page.goto("/dev/engine");
  await page.waitForFunction(() => window.__engine?.getState().assets?.status === "ready", null, { timeout: 60_000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__frames = [];
    w.__rec = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__rec) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator('[data-guide="ssd_not_detected"]').click();
  const length = (await state(page)).procedure!.length;
  for (let i = 1; i < length; i++) {
    await settled(page);
    await page.waitForTimeout(300);
    await page.evaluate((n) => window.__engine!.goTo(n), i);
  }
  await settled(page);
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__rec = false;
    return w.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  return { gpu, frames: frames.length, avgMs: +avg.toFixed(2), p95Ms: +p95.toFixed(2), maxMs: +sorted.at(-1)!.toFixed(2), fps: +(1000 / avg).toFixed(1) };
}

test("frame time while playing a procedure (SwiftShader, CPU)", async ({ page }, info) => {
  test.setTimeout(120_000);
  const r = await measureProcedure(page);
  console.log("[perf swiftshader]", JSON.stringify(r));
  await info.attach("perf-swiftshader", { body: JSON.stringify(r), contentType: "application/json" });
  expect(r.frames).toBeGreaterThan(30);
});

// A separate browser with the hardware GPU (Metal via ANGLE), still headless.
test("frame time while playing a procedure (GPU)", async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
    const r = await measureProcedure(page);
    console.log("[perf gpu]", JSON.stringify(r));
    await info.attach("perf-gpu", { body: JSON.stringify(r), contentType: "application/json" });
    expect(r.frames).toBeGreaterThan(30);
  } finally {
    await browser.close();
  }
});

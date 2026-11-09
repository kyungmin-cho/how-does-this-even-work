import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import type { EngineState } from "@assembly/engine";
import { parseProduct, type Product } from "@assembly/engine/schema";
import { planService, type Procedure } from "@assembly/engine/planner";
import raw from "@assembly/products/data/pc_atx.json";

// Midpoint QA for pc_atx (data order, playback, rapid next, peek, mistakes, user camera, frame time, screens).
// Results go to e2e/qa/out/*.json and screenshots to e2e/qa/__screens__/.
const OUT = path.join(__dirname, "out");
const SCREENS = path.join(__dirname, "__screens__");
mkdirSync(OUT, { recursive: true });
mkdirSync(SCREENS, { recursive: true });
const URL = "/dev/engine?product=pc_atx";

const product: Product = parseProduct(raw);
const ALL = product.assembly.map((s) => s.id);
const plans: Record<string, Procedure> = Object.fromEntries(
  product.guides.map((g) => [g.id, planService(product, ALL, g.targetPartId, g)]),
);

const state = (page: Page) => page.evaluate(() => window.__engine!.getState()) as Promise<EngineState>;
const settled = async (page: Page, glide = 900) => {
  await expect.poll(async () => (await state(page)).animating, { timeout: 20_000 }).toBe(false);
  if (glide) await page.waitForTimeout(glide);
};
const shot = (page: Page, name: string) =>
  page.locator("[data-testid=engine-host]").screenshot({ path: path.join(SCREENS, `${name}.png`) });

/** Collect console errors and page errors, tagged with what was happening. */
function watchErrors(page: Page) {
  const ctx = { label: "load" };
  const errors: { at: string; msg: string }[] = [];
  page.on("pageerror", (e) => errors.push({ at: ctx.label, msg: `pageerror: ${e.message}` }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ at: ctx.label, msg: m.text() });
  });
  return { ctx, errors };
}

async function open(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__engine?.getState().productId === "pc_atx", null, { timeout: 120_000 });
  await settled(page, 300);
}

/** Every pin in state has a DOM element inside the canvas rect. */
async function pinReport(page: Page) {
  return page.evaluate(() => {
    const e = window.__engine!;
    const host = document.querySelector("[data-testid=engine-host]")!.getBoundingClientRect();
    return e.getState().marks.map((m) => {
      const el = document.querySelector<HTMLElement>(`[data-feature-id="${m.featureId}"]`);
      if (!el) return { id: m.featureId, ok: false, why: "no element" };
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const inside = cx >= host.left && cx <= host.right && cy >= host.top && cy <= host.bottom;
      const shown = getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
      return { id: m.featureId, ok: inside && shown, why: inside ? (shown ? "" : "hidden") : `off canvas (${cx | 0},${cy | 0})` };
    });
  });
}

/** 32x32 grey thumbnail of the canvas, to compare views. */
const thumb = (page: Page) =>
  page.evaluate(() => {
    const src = document.querySelector<HTMLCanvasElement>("[data-testid=engine-host] canvas")!;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push((d[i]! + d[i + 1]! + d[i + 2]!) / 3);
    return out;
  });
const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;
const colorCount = (t: number[]) => new Set(t.map((v) => v >> 3)).size;

test("data: parse, plans, feature positions", () => {
  const partById = new Map(product.parts.map((p) => [p.id, p]));
  // Feature points that sit outside their part's boxes (pin would float away from the part).
  const featureOutside: { id: string; partId: string; pos: number[]; slack: number[] }[] = [];
  for (const f of product.features) {
    const p = partById.get(f.partId)!;
    const boxes = p.geometry.kind === "boxes" ? p.geometry.boxes : (p.geometry.boxes ?? []);
    if (!boxes.length) continue;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, (b.position?.[k] ?? 0) - b.size[k]! / 2);
        hi[k] = Math.max(hi[k]!, (b.position?.[k] ?? 0) + b.size[k]! / 2);
      }
    }
    const slack = [0, 1, 2].map((k) => Math.max(lo[k]! - f.position[k]!, f.position[k]! - hi[k]!, 0));
    if (slack.some((s) => s > 5)) featureOutside.push({ id: f.id, partId: f.partId, pos: f.position, slack });
  }
  const table = Object.fromEntries(
    Object.entries(plans).map(([id, p]) => [
      id,
      p.items.map((it) => ({ kind: it.kind, stepId: it.stepId, partId: it.partId, label: it.label, camera: it.camera, checks: it.checks })),
    ]),
  );
  writeFileSync(path.join(OUT, "plans.json"), JSON.stringify({ assembly: ALL, plans: table, featureOutside }, null, 1));
  expect(product.parts).toHaveLength(15);
  expect(product.guides).toHaveLength(4);
});

async function qa(
  page: Page,
  name: string,
  body: (ctx: { label: string }, note: (s: string) => void, errors: { at: string; msg: string }[]) => Promise<Record<string, unknown>>,
) {
  const { ctx, errors } = watchErrors(page);
  let navs = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs++;
  });
  const problems: string[] = [];
  await open(page);
  const navs0 = navs;
  let data: Record<string, unknown> = {};
  let failure: unknown = null;
  try {
    data = await body(ctx, (s) => problems.push(s), errors);
  } catch (e) {
    failure = e;
  }
  const reloaded = navs > navs0;
  const assets = await page.evaluate(() => window.__engine?.getState().assets).catch(() => null);
  writeFileSync(
    path.join(OUT, `playback-${name}.json`),
    JSON.stringify({ reloaded, assets, problems, errors, failure: failure ? String(failure) : null, ...data }, null, 1),
  );
  console.log(`[qa ${name}] reloaded=${reloaded} problems=${problems.length} errors=${errors.length}`);
  if (reloaded) throw new Error(`page reloaded during ${name} (shared dev server HMR), retry`);
  if (failure) throw failure;
  expect(errors).toEqual([]);
}

test("playback assembly", async ({ page }) =>
  qa(page, "assembly", async (ctx, note, errors) => {
  // 1) assembly steps start to end
  await shot(page, "00-assembled");
  ctx.label = "assembly";
  await page.evaluate(() => window.__engine!.applyState([], { animate: false }));
  const assemblyLog: unknown[] = [];
  for (const step of product.assembly) {
    ctx.label = `showStep ${step.id}`;
    await page.evaluate((id) => window.__engine!.showStep(id), step.id);
    const s = await state(page);
    const want = ALL.slice(0, ALL.indexOf(step.id) + 1);
    if (JSON.stringify(s.installedStepIds) !== JSON.stringify(want)) note(`${step.id}: installed ${s.installedStepIds}`);
    if (s.currentStepId !== step.id) note(`${step.id}: currentStepId ${s.currentStepId}`);
    if (!(s.highlight.mode === "focus" && s.highlight.partIds.includes(step.partId)))
      note(`${step.id}: highlight ${JSON.stringify(s.highlight)}`);
    const wantMarks = [...step.checks, ...(step.screwOrder ?? []).filter((c) => !step.checks.includes(c))];
    if (JSON.stringify(s.marks.map((m) => m.featureId)) !== JSON.stringify(wantMarks))
      note(`${step.id}: marks ${s.marks.map((m) => m.featureId)} want ${wantMarks}`);
    if ((step.camera ?? null) !== null && s.view !== step.camera) note(`${step.id}: view ${s.view} want ${step.camera}`);
    await settled(page);
    const pins = await pinReport(page);
    for (const p of pins.filter((x) => !x.ok)) note(`${step.id}: pin ${p.id} ${p.why}`);
    assemblyLog.push({ step: step.id, view: s.view, highlight: s.highlight, pins });
  }

  // Open-panel look inside.
  await page.evaluate((ids) => window.__engine!.applyState(ids.filter((id) => id !== "s_side_panel"), { animate: false }), ALL);
  await page.evaluate(() => {
    const e = window.__engine!;
    e.highlight([], "none");
    e.clearMarks();
    e.setView("default");
  });
  await settled(page);
  await shot(page, "01-open-panel");

    void errors;
    return { assemblyLog };
  }));

test("playback guides", async ({ page }) =>
  qa(page, "guides", async (ctx, note, errors) => {
  // 2) each guide: playProcedure (dev page button plans from current state) then next() to the end
  const KEY: Record<string, string[]> = {
    guide_overheat: ["remove:s_cooler", "extra:x_oh_paste"],
    guide_ram_not_detected: ["remove:s_ram", "extra:x_ram_slots"],
    guide_add_ssd: ["remove:s_m2", "extra:x_ssd_angle"],
    guide_replace_gpu: ["remove:s_gpu_power", "remove:s_gpu"],
  };
  const guideLog: Record<string, unknown[]> = {};
  for (const g of product.guides) {
    const plan = plans[g.id]!;
    ctx.label = `guide ${g.id} start`;
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), ALL);
    await settled(page, 200);
    await page.locator(`[data-guide="${g.id}"]`).click();
    guideLog[g.id] = [];
    for (let i = 0; i < plan.items.length; i++) {
      const it = plan.items[i]!;
      ctx.label = `guide ${g.id} #${i} ${it.kind}:${it.stepId}`;
      if (i > 0) {
        const moved = await page.evaluate(() => window.__engine!.next());
        if (!moved) note(`${g.id} #${i}: next() returned false early`);
      }
      const s = await state(page);
      const item = s.procedure?.item;
      if (s.procedure?.index !== i || item?.stepId !== it.stepId) note(`${g.id} #${i}: at ${s.procedure?.index} ${item?.stepId}, want ${it.stepId}`);
      if (JSON.stringify(s.installedStepIds) !== JSON.stringify(it.installed)) note(`${g.id} #${i}: installed differs`);
      if (!s.highlight.partIds.includes(it.partId)) note(`${g.id} #${i}: highlight ${JSON.stringify(s.highlight)} lacks ${it.partId}`);
      if (JSON.stringify(s.marks.map((m) => m.featureId)) !== JSON.stringify(it.checks))
        note(`${g.id} #${i}: marks ${s.marks.map((m) => m.featureId)} want ${it.checks}`);
      await settled(page);
      const pins = await pinReport(page);
      for (const p of pins.filter((x) => !x.ok)) note(`${g.id} #${i} ${it.stepId}: pin ${p.id} ${p.why}`);
      guideLog[g.id]!.push({ i, kind: it.kind, stepId: it.stepId, view: s.view, highlight: s.highlight, marks: s.marks.map((m) => m.featureId), pins });
      if (KEY[g.id]!.includes(`${it.kind}:${it.stepId}`)) await shot(page, `10-${g.id}-${i}-${it.kind}-${it.stepId}`);
    }
    ctx.label = `guide ${g.id} end`;
    if (await page.evaluate(() => window.__engine!.next())) note(`${g.id}: next() true after last item`);
    const end = await state(page);
    if (JSON.stringify(end.installedStepIds) !== JSON.stringify(ALL)) note(`${g.id}: not fully reassembled at end`);
  }

    void errors;
    return { guideLog };
  }));

test("playback rapid", async ({ page }) =>
  qa(page, "rapid", async (ctx, note, errors) => {
  // 3) rapid next(): 10 calls during animation
  const rapid: Record<string, unknown> = {};
  for (const gid of ["guide_add_ssd", "guide_overheat"]) {
    const plan = plans[gid]!;
    ctx.label = `rapid ${gid}`;
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), ALL);
    await settled(page, 200);
    await page.locator(`[data-guide="${gid}"]`).click();
    await page.waitForTimeout(150); // mid animation
    const results = await page.evaluate(async () => {
      const e = window.__engine!;
      const r: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        r.push(e.next());
        await new Promise((res) => setTimeout(res, 40));
      }
      return r;
    });
    const want = Math.min(10, plan.items.length - 1);
    const s = await state(page);
    await settled(page);
    const after = await state(page);
    const t = await thumb(page);
    const ok =
      s.procedure?.index === want &&
      JSON.stringify(after.installedStepIds) === JSON.stringify(plan.items[want]!.installed) &&
      after.procedure?.item?.stepId === plan.items[want]!.stepId;
    if (!ok) note(`rapid ${gid}: index ${s.procedure?.index} want ${want}; item ${after.procedure?.item?.stepId}`);
    if (colorCount(t) < 4) note(`rapid ${gid}: canvas looks blank`);
    rapid[gid] = { results, index: after.procedure?.index, want, stepId: after.procedure?.item?.stepId, wantStep: plan.items[want]!.stepId, colors: colorCount(t) };
    await shot(page, `20-rapid-${gid}`);
  }

    void errors;
    return { rapid };
  }));

test("playback peek", async ({ page }) =>
  qa(page, "peek", async (ctx, note, errors) => {
  // 4) peek mid procedure, then resumeProcedure
  const peekLog: unknown[] = [];
  for (const [gid, target] of [
    ["guide_add_ssd", ["psu"]],
    ["guide_add_ssd", "gpu_power"],
    ["guide_overheat", ["ram"]],
  ] as const) {
    ctx.label = `peek ${gid} ${String(target)}`;
    await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), ALL);
    await settled(page, 200);
    await page.locator(`[data-guide="${gid}"]`).click();
    const mid = Math.floor(plans[gid]!.items.length / 2);
    await page.evaluate((n) => window.__engine!.goTo(n), mid);
    await settled(page, 1200);
    const before = await state(page);
    const tBefore = await thumb(page);
    await page.evaluate((t) => window.__engine!.peek(t as string[] | string), target as string[] | string);
    await settled(page, 1200);
    const during = await state(page);
    const tDuring = await thumb(page);
    await page.evaluate(() => window.__engine!.resumeProcedure());
    await settled(page, 1500);
    const after = await state(page);
    const tAfter = await thumb(page);
    const same = (k: keyof EngineState) => JSON.stringify(after[k]) === JSON.stringify(before[k]);
    const r = {
      gid,
      target,
      index: [before.procedure?.index, during.procedure?.index, after.procedure?.index],
      sameInstalled: same("installedStepIds"),
      sameHighlight: same("highlight"),
      sameMarks: same("marks"),
      sameView: same("view"),
      peekCleared: after.peek === null,
      duringHighlight: during.highlight,
      pixelDiffDuring: +diff(tBefore, tDuring).toFixed(2),
      pixelDiffAfter: +diff(tBefore, tAfter).toFixed(2),
    };
    peekLog.push(r);
    if (!(r.sameInstalled && r.sameHighlight && r.sameMarks && r.sameView && r.peekCleared && after.procedure?.index === before.procedure?.index))
      note(`peek ${gid} ${String(target)}: state not restored ${JSON.stringify(r)}`);
    if (r.pixelDiffAfter > 3) note(`peek ${gid} ${String(target)}: camera/picture not back (diff ${r.pixelDiffAfter})`);
  }

    void errors;
    return { peekLog };
  }));

test("playback mistakes", async ({ page }) =>
  qa(page, "mistakes", async (ctx, note, errors) => {
  // 5) every mistake
  const mistakeLog: unknown[] = [];
  await page.evaluate((ids) => window.__engine!.applyState(ids.filter((id) => id !== "s_side_panel"), { animate: false }), ALL);
  await settled(page, 200);
  let shotMistakes = 0;
  for (const step of product.assembly) {
    for (const m of step.mistakes) {
      ctx.label = `mistake ${step.id}/${m.id}`;
      const n0 = errors.length;
      await page.evaluate(([s, mm]) => window.__engine!.showMistake(s!, mm!), [step.id, m.id]);
      await page.waitForTimeout(1600);
      const s = await state(page);
      const pins = await pinReport(page);
      if (s.mistake?.mistakeId !== m.id) note(`mistake ${m.id}: state ${JSON.stringify(s.mistake)}`);
      for (const p of pins.filter((x) => !x.ok)) note(`mistake ${m.id}: pin ${p.id} ${p.why}`);
      mistakeLog.push({ step: step.id, mistake: m.id, marks: s.marks, errors: errors.length - n0, pins });
      if (shotMistakes < 2 || ["gpu_pull_no_latch", "ram_notch_reversed"].includes(m.id)) {
        await shot(page, `30-mistake-${step.id}-${m.id}`);
        shotMistakes++;
      }
      await page.evaluate(() => window.__engine!.clearMistake());
    }
  }

    void errors;
    return { mistakeLog };
  }));

test("playback usercam", async ({ page }) =>
  qa(page, "usercam", async (ctx, note, errors) => {
  // 6) user drag takes the camera; auto camera stops
  ctx.label = "user drag";
  await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), ALL);
  await settled(page, 200);
  await page.locator('[data-guide="guide_replace_gpu"]').click();
  await settled(page);
  const box = (await page.locator("[data-testid=engine-host] canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const afterDrag = await state(page);
  // Next item asks for another view; with the user holding the camera it must not glide.
  // Compare only the top band of the canvas, which shows mostly background/case far from the moving part.
  const t0 = await thumb(page);
  await page.evaluate(() => window.__engine!.next());
  const afterNext = await state(page);
  await settled(page, 1200);
  const t1 = await thumb(page);
  await page.evaluate(() => window.__engine!.resumeGuide());
  await settled(page, 1200);
  const t2 = await thumb(page);
  const userCam = {
    ownerAfterDrag: afterDrag.cameraOwner,
    ownerAfterNext: afterNext.cameraOwner,
    viewAfterNext: afterNext.view,
    diffDuringUser: +diff(t0, t1).toFixed(2),
    diffAfterResume: +diff(t1, t2).toFixed(2),
    ownerAfterResume: (await state(page)).cameraOwner,
  };
  if (userCam.ownerAfterDrag !== "user" || userCam.ownerAfterNext !== "user") note(`user camera: ${JSON.stringify(userCam)}`);

    void errors;
    return { userCam };
  }));

/* ---------- frame time ---------- */

async function measure(page: Page) {
  await open(page);
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
  await page.locator('[data-guide="guide_add_ssd"]').click();
  const length = (await state(page)).procedure!.length;
  for (let i = 1; i < length; i++) {
    await settled(page, 300);
    await page.evaluate(() => window.__engine!.next());
  }
  await settled(page, 300);
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__rec = false;
    return w.__frames.slice(3);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  return {
    gpu,
    frames: frames.length,
    avgMs: +avg.toFixed(2),
    p95Ms: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(2),
    maxMs: +sorted.at(-1)!.toFixed(2),
    over50: frames.filter((f) => f > 50).length,
  };
}

const CONDITIONS = [
  { name: "desktop-1440x900-swiftshader", viewport: { width: 1440, height: 900 }, cpu: 1, gpu: false, mobile: false },
  { name: "desktop-1440x900-gpu", viewport: { width: 1440, height: 900 }, cpu: 1, gpu: true, mobile: false },
  { name: "mobile-390x844-cpu4x-swiftshader", viewport: { width: 390, height: 844 }, cpu: 4, gpu: false, mobile: true },
  { name: "mobile-390x844-cpu4x-gpu", viewport: { width: 390, height: 844 }, cpu: 4, gpu: true, mobile: true },
];

test("frame time", async ({ baseURL }) => {
  test.setTimeout(600_000);
  const results: Record<string, unknown> = {};
  for (const c of CONDITIONS) {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: c.gpu
        ? ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    try {
      const context = await browser.newContext({
        baseURL,
        viewport: c.viewport,
        deviceScaleFactor: c.mobile ? 3 : 1,
        isMobile: c.mobile,
        hasTouch: c.mobile,
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: c.cpu });
      const r = await measure(page);
      results[c.name] = r;
      console.log("[perf]", c.name, JSON.stringify(r));
      if (c.mobile) await page.locator("[data-testid=engine-host]").screenshot({ path: path.join(SCREENS, `40-${c.name}-end.png`) });
    } catch (e) {
      results[c.name] = { error: String(e) };
    } finally {
      await browser.close();
    }
  }
  writeFileSync(path.join(OUT, "perf.json"), JSON.stringify(results, null, 1));
});

/* ---------- GLB (product data has no assets yet, so it is injected here) ---------- */
test("glb: pc_atx.glb parts, guide playback", async ({ page }) => {
  const { ctx, errors } = watchErrors(page);
  await open(page);
  ctx.label = "glb load";
  await page.evaluate(() => {
    const e = window.__engine!;
    e.loadProduct({ ...e.getProduct()!, assets: { glb: "/models/pc_atx.glb", scale: 1 } });
  });
  await expect.poll(async () => (await state(page)).assets!.status, { timeout: 60_000 }).not.toBe("loading");
  const assets = (await state(page)).assets!;
  const missing = product.parts.map((p) => p.id).filter((id) => !assets.glbParts.includes(id));
  await settled(page);
  await shot(page, "50-glb-assembled");
  await page.evaluate((ids) => window.__engine!.applyState(ids.filter((id) => id !== "s_side_panel"), { animate: false }), ALL);
  await page.evaluate(() => window.__engine!.highlight([], "none"));
  await settled(page);
  await shot(page, "51-glb-open-panel");
  const problems: string[] = [];
  const plan = planService(product, ALL, "m2_ssd", product.guides.find((g) => g.id === "guide_add_ssd")!);
  await page.evaluate((ids) => window.__engine!.applyState(ids, { animate: false }), ALL);
  await page.locator('[data-guide="guide_add_ssd"]').click();
  for (let i = 1; i < plan.items.length; i++) {
    ctx.label = `glb ssd #${i}`;
    await page.evaluate(() => window.__engine!.next());
    const s = await state(page);
    if (s.procedure?.item?.stepId !== plan.items[i]!.stepId) problems.push(`#${i} ${s.procedure?.item?.stepId}`);
    await settled(page, 600);
    if (plan.items[i]!.stepId === "s_gpu" && plan.items[i]!.kind === "remove") await shot(page, "52-glb-ssd-remove-gpu");
    if (plan.items[i]!.stepId === "x_ssd_angle") await shot(page, "53-glb-ssd-angle");
  }
  await page.evaluate(() => window.__engine!.showMistake("s_gpu", "gpu_pull_no_latch"));
  await page.waitForTimeout(1500);
  await shot(page, "54-glb-mistake-gpu");
  writeFileSync(path.join(OUT, "glb.json"), JSON.stringify({ assets, missing, problems, errors }, null, 1));
  console.log("[glb]", JSON.stringify({ status: assets.status, glbParts: assets.glbParts.length, missing, problems, errors: errors.length }));
});

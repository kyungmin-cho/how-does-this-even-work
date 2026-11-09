import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";

// Agent end to end with the REAL model (no mock): question → agent tools → 3D moves.
// Run: QA_PORT=3300 pnpm --filter @assembly/web exec playwright test -c e2e/qa/playwright.qa.config.ts -g "agent"
// Each scenario makes 1–3 chat turns. Results: e2e/qa/out/agent-*.json, screens: e2e/qa/__screens__/agent/.
const OUT = path.join(__dirname, "out");
const SCREENS = path.join(__dirname, "__screens__", "agent");
mkdirSync(OUT, { recursive: true });
mkdirSync(SCREENS, { recursive: true });

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] },
});

interface ToolCall {
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
}
interface Turn {
  question: string;
  firstResponseMs: number | null;
  totalMs: number;
  requests: number;
  tools: ToolCall[];
  answer: string;
  askUser: { question: string; options: string[]; picked: string }[];
  before: unknown;
  after: unknown;
  screens: string[];
  streamErrors: string[];
}

/** Compact engine state from the app store (window.__assembly, dev only). */
const sceneOf = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __assembly?: { store: { getState(): Record<string, unknown> } } };
    const st = w.__assembly?.store.getState() as
      | { scene: Record<string, any>; procedureItems?: { kind: string; stepId: string }[] | null }
      | undefined;
    if (!st) return null;
    const s = st.scene;
    return {
      productId: s.productId,
      procedure: s.procedure
        ? { guideId: s.procedure.guideId, index: s.procedure.index, length: s.procedure.length, item: s.procedure.item && `${s.procedure.item.kind}:${s.procedure.item.stepId}` }
        : null,
      procedureItems: st.procedureItems?.map((i) => `${i.kind}:${i.stepId}`) ?? null,
      currentStepId: s.currentStepId,
      installed: s.installedStepIds?.length,
      installedIds: s.installedStepIds,
      highlight: s.highlight,
      marks: (s.marks ?? []).map((m: { featureId: string }) => m.featureId),
      view: s.view,
      peek: s.peek,
      mistake: s.mistake,
      cameraOwner: s.cameraOwner,
      animating: s.animating,
    };
  });

/** Parse one /api/chat SSE body into tool calls, text and errors. */
function parseStream(body: string) {
  const tools = new Map<string, ToolCall>();
  let text = "";
  const errors: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") continue;
    let ev: any;
    try {
      ev = JSON.parse(raw);
    } catch {
      continue;
    }
    if (ev.type === "tool-input-available") tools.set(ev.toolCallId, { name: ev.toolName, input: ev.input });
    else if (ev.type === "tool-output-available" && tools.has(ev.toolCallId)) tools.get(ev.toolCallId)!.output = ev.output;
    else if (ev.type === "tool-output-error" && tools.has(ev.toolCallId)) tools.get(ev.toolCallId)!.error = ev.errorText;
    else if (ev.type === "text-delta") text += ev.delta;
    else if (ev.type === "error") errors.push(ev.errorText);
  }
  return { tools: [...tools.entries()], text, errors };
}

function watch(page: Page) {
  const consoleErrors: { at: string; msg: string }[] = [];
  const ctx = { label: "load" };
  page.on("pageerror", (e) => consoleErrors.push({ at: ctx.label, msg: `pageerror: ${e.message}` }));
  const hmr: { at: string; msg: string }[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push({ at: ctx.label, msg: m.text().slice(0, 400) });
    if (/Fast Refresh|full reload|HMR/i.test(m.text())) hmr.push({ at: ctx.label, msg: m.text().slice(0, 200) });
  });
  let navs = 0;
  const navLog: { at: string; url: string }[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) {
      navs++;
      navLog.push({ at: ctx.label, url: f.url() });
    }
  });
  // Streams of the current turn.
  const inflight = new Set<Request>();
  const bodies: { t: number; body: Promise<string> }[] = [];
  let firstChunkAt: number | null = null;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/chat") && r.method() === "POST") inflight.add(r);
  });
  page.on("response", (r) => {
    if (!r.url().endsWith("/api/chat")) return;
    if (firstChunkAt === null) firstChunkAt = Date.now();
    bodies.push({ t: Date.now(), body: r.body().then((b) => b.toString("utf8")).catch((e) => `ERROR ${e}`) });
  });
  page.on("requestfinished", (r) => inflight.delete(r));
  page.on("requestfailed", (r) => inflight.delete(r));
  return {
    ctx,
    consoleErrors,
    hmr,
    navLog,
    navCount: () => navs,
    inflight,
    takeBodies: () => bodies.splice(0),
    resetFirst: () => (firstChunkAt = null),
    firstChunkAt: () => firstChunkAt,
  };
}

async function openStudio(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__qa_cleared")) {
      localStorage.clear();
      sessionStorage.setItem("__qa_cleared", "1");
    }
  });
  await page.goto("/studio/pc");
  await expect(page.getByRole("region", { name: "3D 보기" })).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => {
    const w = window as unknown as { __assembly?: { store: { getState(): { scene: { productId: string | null } } } } };
    return w.__assembly?.store.getState().scene.productId === "pc_atx";
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
}

const chatPanel = (page: Page) => page.getByRole("complementary", { name: "대화" });

async function shot(page: Page, name: string) {
  const file = path.join(SCREENS, `${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(path.join(__dirname, ".."), file);
}

/** Send one question and wait until the agent is idle (all tool round trips done). */
async function ask(page: Page, w: ReturnType<typeof watch>, question: string, name: string, pick?: (opts: string[]) => string) {
  const before = await sceneOf(page);
  const panel = chatPanel(page);
  w.takeBodies();
  w.resetFirst();
  w.ctx.label = question;
  const t0 = Date.now();
  // The input can be reset while the page hydrates: type until the send button is enabled.
  const box = panel.getByRole("textbox", { name: "질문" });
  const send = panel.getByRole("button", { name: "보내기" });
  await expect(async () => {
    await box.fill(question);
    await expect(send).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await send.click();
  const askUser: Turn["askUser"] = [];
  const deadline = Date.now() + 150_000;
  let idleSince = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    // ask_user buttons waiting for an answer
    const group = panel.getByRole("group", { name: "에이전트 질문" });
    if ((await group.count()) > 0 && (await group.last().isVisible())) {
      const opts = (await group.last().getByRole("button").allTextContents()).map((s) => s.trim());
      const q = (await group.last().locator("xpath=..").locator("p").first().textContent().catch(() => "")) ?? "";
      const choice = pick ? pick(opts) : opts[0]!;
      askUser.push({ question: q.trim(), options: opts, picked: choice });
      await shot(page, `${name}-ask_user`);
      await group.last().getByRole("button", { name: choice, exact: true }).click();
      idleSince = 0;
      continue;
    }
    const busy = (await panel.getByRole("button", { name: "멈추기" }).count()) > 0 || w.inflight.size > 0;
    if (busy) idleSince = 0;
    else if (!idleSince) idleSince = Date.now();
    else if (Date.now() - idleSince > 3000) break;
  }
  const totalMs = Date.now() - t0;
  // Let camera glides finish before the screenshot.
  await expect.poll(async () => (await sceneOf(page))?.animating, { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(1200);
  const after = await sceneOf(page);
  const bodies = await Promise.all(w.takeBodies().map((b) => b.body));
  const tools: ToolCall[] = [];
  const streamErrors: string[] = [];
  let streamText = "";
  for (const b of bodies) {
    const p = parseStream(b);
    tools.push(...p.tools.map(([, t]) => t));
    streamErrors.push(...p.errors);
    streamText += p.text;
  }
  // Browser tool outputs are only in the page: read them from the rendered messages' tool rows.
  const answer = (await panel.getByRole("article", { name: "에이전트" }).last().innerText().catch(() => "")).trim();
  const screens = [await shot(page, name)];
  const turn: Turn = {
    question,
    firstResponseMs: w.firstChunkAt() ? w.firstChunkAt()! - t0 : null,
    totalMs,
    requests: bodies.length,
    tools: tools.map((t) => ({ ...t, output: summarizeOutput(t.output) })),
    answer: answer || streamText,
    askUser,
    before,
    after,
    screens,
    streamErrors,
  };
  console.log(`[agent] ${name}: ${tools.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(" → ")} | ${totalMs} ms | ${JSON.stringify((after as any)?.procedure)}`);
  return turn;
}

/** Keep server tool outputs short in the log. */
function summarizeOutput(o: unknown) {
  const s = JSON.stringify(o ?? null);
  return s.length > 600 ? `${s.slice(0, 600)}…` : o;
}

async function stepButton(page: Page, name: string, label: string) {
  const before = await sceneOf(page);
  await page.getByRole("region", { name: "절차" }).getByRole("button", { name: "다음 단계" }).click();
  await expect.poll(async () => (await sceneOf(page))?.animating, { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(1200);
  const after = await sceneOf(page);
  return { label, before: (before as any)?.procedure, after: (after as any)?.procedure, highlight: (after as any)?.highlight, marks: (after as any)?.marks, screen: await shot(page, name) };
}

function save(name: string, data: unknown) {
  writeFileSync(path.join(OUT, `agent-${name}.json`), JSON.stringify(data, null, 1));
}

test("agent A+B: overheat guide, next, side question, continue", async ({ page }) => {
  test.setTimeout(900_000);
  const w = watch(page);
  await openStudio(page);
  await shot(page, "A0-start");
  const turns: Turn[] = [];
  const pickOverheat = (opts: string[]) => opts.find((o) => /CPU|쿨러|과열|팬|뜨거|온도/.test(o)) ?? opts[0]!;
  turns.push(await ask(page, w, "컴퓨터가 자꾸 꺼지고 팬 소리가 커요", "A1-overheat", pickOverheat));
  turns.push(await ask(page, w, "다음", "A2-next-chat"));
  const buttons = [await stepButton(page, "A3-next-button", "다음 단계 버튼 1")];
  buttons.push(await stepButton(page, "A4-next-button", "다음 단계 버튼 2"));
  const beforeB = await sceneOf(page);
  turns.push(await ask(page, w, "CPU_FAN 단자가 뭐예요?", "B1-side-question"));
  turns.push(await ask(page, w, "계속", "B2-continue"));
  const afterB = await sceneOf(page);
  save("A_B", { turns, buttons, beforeB, afterB, consoleErrors: w.consoleErrors, hmr: w.hmr, navLog: w.navLog });
});

test("agent C: RAM half capacity (new conversation)", async ({ page }) => {
  test.setTimeout(600_000);
  const w = watch(page);
  await openStudio(page);
  const pick = (opts: string[]) => opts.find((o) => /RAM|램|메모리|슬롯/.test(o)) ?? opts[0]!;
  const turns = [await ask(page, w, "램을 하나 더 꽂았는데 용량이 반만 보여요", "C1-ram", pick)];
  // Walk with the step button (no model call) to the RAM removal and the slot check.
  const buttons = [];
  for (let i = 0; i < 8; i++) {
    const item = (await sceneOf(page))?.procedure?.item ?? "";
    if (/x_ram_slots/.test(String(item))) break;
    buttons.push(await stepButton(page, `C2-step-${i + 1}`, `다음 단계 버튼 ${i + 1}`));
  }
  save("C", { turns, buttons, consoleErrors: w.consoleErrors, hmr: w.hmr, navLog: w.navLog });
});

test("agent D: add SSD (new conversation)", async ({ page }) => {
  test.setTimeout(600_000);
  const w = watch(page);
  await openStudio(page);
  const pick = (opts: string[]) => opts.find((o) => /SSD|M\.2|달|추가/.test(o)) ?? opts[0]!;
  const turns = [await ask(page, w, "SSD를 달고 싶어요", "D1-ssd", pick)];
  save("D", { turns, consoleErrors: w.consoleErrors, hmr: w.hmr, navLog: w.navLog });
});

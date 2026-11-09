import { expect, test, type Page } from "@playwright/test";

import { chat, openStudio, procedure } from "./support/studio";

// Live model (Opus 5.5, medium), the demo story end to end. Wording varies: check tool calls
// (activity rows) and what the 3D view and step bar show. Run:
//   LIVE_AGENT=1 PORT=3300 pnpm exec playwright test agent-live --project=desktop
test.describe.configure({ timeout: 600_000 });

const TURN = 180_000;

async function ask(page: Page, text: string) {
  const panel = chat(page);
  const before = await panel.getByRole("article", { name: "에이전트" }).count();
  await panel.getByRole("textbox", { name: "질문" }).fill(text);
  await panel.getByRole("button", { name: "보내기" }).click();
  await expect(panel.getByRole("article", { name: "에이전트" })).toHaveCount(before + 1, { timeout: TURN });
}

/** Wait until the agent is done (no stop button) and answer an ask_user question if it asks one. */
async function settle(page: Page) {
  const panel = chat(page);
  for (let i = 0; i < 4; i++) {
    await expect(panel.getByRole("button", { name: "멈추기" })).toHaveCount(0, { timeout: TURN });
    const question = panel.getByRole("group", { name: "에이전트 질문" }).last();
    if (!(await question.isVisible())) return;
    await question.getByRole("button").first().click();
    await page.waitForTimeout(500);
  }
}

const activity = (page: Page) => chat(page).getByRole("button", { name: /^(완료|실패|진행 중): / });

test("demo story: overheat guide, side questions, product switch", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one live run is enough");
  test.skip(process.env.LIVE_AGENT !== "1", "set LIVE_AGENT=1 to call the real model");
  await openStudio(page);
  const steps = procedure(page);
  const log = async (label: string) =>
    console.log(`\n== ${label}\n`, (await activity(page).allTextContents()).join("\n "));

  // 1. Symptom → (ask_user) → guide → 3D at the first step.
  await ask(page, "My PC keeps shutting down");
  await settle(page);
  await expect(steps.getByRole("heading", { level: 2 })).not.toHaveText("조립 순서", { timeout: TURN });
  await expect(steps).toContainText(/1\/\d+/);
  await expect(chat(page).getByRole("button", { name: /^완료: 절차 계산:/ })).toBeVisible();
  await log("1 overheat");

  // 2. Move on, then a side question: peek and come back.
  await steps.getByRole("button", { name: "다음 단계" }).click();
  await steps.getByRole("button", { name: "다음 단계" }).click();
  const where = (await steps.textContent()) ?? "";
  await ask(page, "What's this connector on the cooler fan cable?");
  await settle(page);
  await log("2 side question");
  const rows = (await activity(page).allTextContents()).join("\n");
  expect(rows).toMatch(/잠깐 보기|부품 정보|단계 정보/);

  await ask(page, "Why do I have to twist the cooler instead of pulling it straight?");
  await settle(page);
  await log("3 why twist");
  // Back on the same procedure step after the side questions.
  await expect(steps.getByRole("status").filter({ hasText: "잠깐 보는 중" })).toHaveCount(0, { timeout: TURN });
  expect((await steps.textContent()) ?? "").toContain(where.match(/\d+\/\d+/)?.[0] ?? "");

  // 4. Another product: the dresser.
  await ask(page, "Now my dresser wobbles and could tip over. How do I fix that?");
  await settle(page);
  await log("4 dresser");
  await expect(chat(page).getByRole("button", { name: /^완료: 제품 열기: dresser/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "제품" })).not.toContainText("ATX");
  await expect(steps.getByRole("heading", { level: 2 })).not.toHaveText("조립 순서", { timeout: TURN });
  console.log("\n== last answer\n", await chat(page).getByRole("article", { name: "에이전트" }).last().textContent());
});

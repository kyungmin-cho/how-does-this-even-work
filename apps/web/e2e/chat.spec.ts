import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "@playwright/test";

import { chat, openStudio } from "./support/studio";

// These talk to the live model, so answers vary: check shape, not wording.
test.describe.configure({ timeout: 180_000 });

/** Wait until the agent has finished answering (the send button is back). */
async function answered(page: Page): Promise<Locator> {
  const panel = chat(page);
  const answer = panel.getByRole("article", { name: "에이전트" }).last();
  await expect(answer).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByRole("button", { name: "멈추기" })).toHaveCount(0, { timeout: 150_000 });
  await expect(answer).not.toHaveText("", { timeout: 10_000 });
  return answer;
}

test("asks a question and streams an answer", async ({ page }) => {
  await openStudio(page);
  const panel = chat(page);
  const input = panel.getByRole("textbox", { name: "질문" });
  await input.fill("그래픽카드는 어떻게 빼요?");
  await panel.getByRole("button", { name: "보내기" }).click();

  await expect(panel.getByRole("article", { name: "나" })).toContainText("그래픽카드는 어떻게 빼요?");
  await expect(input).toHaveValue("");
  const answer = await answered(page);
  expect(((await answer.textContent()) ?? "").trim().length).toBeGreaterThan(5);
});

test("example question chips send right away", async ({ page }) => {
  await openStudio(page);
  const panel = chat(page);
  const chip = panel.getByRole("group", { name: "예시 질문" }).getByRole("button").first();
  const text = (await chip.textContent())!.trim();
  await chip.click();
  await expect(panel.getByRole("article", { name: "나" })).toContainText(text);
  await answered(page);
});

test("conversation and draft survive a reload and a layout switch", async ({ page }) => {
  await openStudio(page);
  const panel = chat(page);
  await panel.getByRole("textbox", { name: "질문" }).fill("램은 어디에 꽂아요?");
  await panel.getByRole("button", { name: "보내기" }).click();
  await answered(page);
  await panel.getByRole("textbox", { name: "질문" }).fill("아직 안 보낸 질문");

  await page.goto("/studio/pc");
  await expect(chat(page).getByRole("article", { name: "나" }).first()).toContainText("램은 어디에 꽂아요?");
  await expect(chat(page).getByRole("textbox", { name: "질문" })).toHaveValue("아직 안 보낸 질문");

  // Crossing the phone/desktop breakpoint swaps layouts but keeps the same chat.
  const size = page.viewportSize()!;
  await page.setViewportSize(size.width < 768 ? { width: 1280, height: 800 } : { width: 390, height: 844 });
  await expect(chat(page).getByRole("article", { name: "에이전트" }).first()).toBeVisible();
});

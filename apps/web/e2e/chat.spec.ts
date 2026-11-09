import { expect, test } from "@playwright/test";

import { chat, openStudio } from "./support/studio";

test.skip(process.env.LIVE_AGENT === "1", "mock reply only");

test("asks a question and streams an answer (mock agent)", async ({ page }) => {
  await openStudio(page);
  const panel = chat(page);
  const input = panel.getByRole("textbox", { name: "질문" });
  await input.fill("그래픽카드는 어떻게 빼요?");
  await panel.getByRole("button", { name: "보내기" }).click();

  await expect(panel.getByRole("article", { name: "나" })).toContainText("그래픽카드는 어떻게 빼요?");
  await expect(panel.getByRole("article", { name: "에이전트" })).toContainText("테스트 응답이에요");
  await expect(input).toHaveValue("");
});

test("example question chips send right away", async ({ page }) => {
  await openStudio(page);
  const panel = chat(page);
  const chip = panel.getByRole("group", { name: "예시 질문" }).getByRole("button").first();
  const text = (await chip.textContent())!.trim();
  await chip.click();
  await expect(panel.getByRole("article", { name: "나" })).toContainText(text);
  await expect(panel.getByRole("article", { name: "에이전트" })).toContainText("테스트 응답이에요");
});

test("conversation and draft survive a reload and a layout switch", async ({ page }) => {
  await openStudio(page);
  const panel = chat(page);
  await panel.getByRole("textbox", { name: "질문" }).fill("램은 어디에 꽂아요?");
  await panel.getByRole("button", { name: "보내기" }).click();
  await expect(panel.getByRole("article", { name: "에이전트" })).toContainText("테스트 응답이에요");
  await panel.getByRole("textbox", { name: "질문" }).fill("아직 안 보낸 질문");

  await page.goto("/studio/pc");
  await expect(chat(page).getByRole("article", { name: "나" })).toContainText("램은 어디에 꽂아요?");
  await expect(chat(page).getByRole("textbox", { name: "질문" })).toHaveValue("아직 안 보낸 질문");

  // Crossing the phone/desktop breakpoint swaps layouts but keeps the same chat.
  const size = page.viewportSize()!;
  await page.setViewportSize(size.width < 768 ? { width: 1280, height: 800 } : { width: 390, height: 844 });
  await expect(chat(page).getByRole("article", { name: "에이전트" })).toContainText("테스트 응답이에요");
});

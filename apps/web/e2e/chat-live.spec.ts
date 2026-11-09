import { expect, test } from "@playwright/test";

import { chat, openStudio } from "./support/studio";

// Real model call. Run with: LIVE_AGENT=1 PORT=3200 pnpm exec playwright test chat-live --project=desktop
test.skip(process.env.LIVE_AGENT !== "1", "set LIVE_AGENT=1 to call the real model");

test("real agent answers from the product data", async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const panel = chat(page);
  await panel.getByRole("textbox", { name: "질문" }).fill("SSD가 안 보여요. 뭘 먼저 확인해야 해요?");
  await panel.getByRole("button", { name: "보내기" }).click();

  const answer = panel.getByRole("article", { name: "에이전트" });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("button", { name: "보내기" })).toBeVisible({ timeout: 90_000 });
  const text = (await answer.textContent()) ?? "";
  expect(text.length).toBeGreaterThan(10);
  console.log("agent answer:", text);
});

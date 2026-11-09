import { expect, test } from "@playwright/test";

import { pc } from "./support/product";
import { chat, openStudio, procedure } from "./support/studio";

// Live model (Opus 5.5, medium): the agent should narrow the symptom (ask_user) and start a
// guide (start_guide) that the browser runs on the 3D view. Wording varies; check behavior.
test.describe.configure({ timeout: 300_000 });

test("symptom → agent asks or starts a guide → 3D runs the procedure", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one live run is enough");
  test.skip(process.env.LIVE_AGENT !== "1", "set LIVE_AGENT=1 to call the real model");
  const titles = pc.guides.map((g) => g.title);
  await openStudio(page);
  const panel = chat(page);
  await panel.getByRole("textbox", { name: "질문" }).fill("컴퓨터가 자꾸 꺼져요. 팬 소리도 커졌어요.");
  await panel.getByRole("button", { name: "보내기" }).click();

  const steps = procedure(page);
  const guideHeading = steps.getByRole("heading", { level: 2 }).filter({ hasText: new RegExp(titles.map((t) => t.replace(/[()]/g, "\\$&")).join("|")) });
  const question = panel.getByRole("group", { name: "에이전트 질문" });

  // Either the agent asks first (answer with the first option) or it starts the guide directly.
  await expect(question.or(guideHeading)).toBeVisible({ timeout: 150_000 });
  if (await question.isVisible()) {
    await question.getByRole("button").first().click();
  }
  await expect(guideHeading).toBeVisible({ timeout: 150_000 });
  await expect(steps).toContainText(/\d+\/\d+/);

  // The call shows as an activity line and a procedure card.
  await expect(panel.getByRole("button", { name: /^완료: 절차 계산:/ })).toBeVisible();
  await expect(panel.getByRole("list", { name: "절차" }).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "멈추기" })).toHaveCount(0, { timeout: 150_000 });
  console.log("agent:", (await panel.getByRole("article", { name: "에이전트" }).last().textContent())?.slice(0, 400));
});

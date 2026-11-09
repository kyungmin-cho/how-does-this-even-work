import { expect, test } from "@playwright/test";

import { partLabel, pc } from "./support/product";
import { chat, openStudio, partsTree, procedure } from "./support/studio";

// Something to press at every moment. Only the chips that act on the view are clicked here;
// question chips go to the live model (see agent-live.spec.ts).

test("empty chat shows start cards", async ({ page }) => {
  await openStudio(page);
  const cards = chat(page).getByRole("group", { name: "예시 질문" }).getByRole("button");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText(pc.guides[0].symptoms[0]);
  await expect(cards.nth(1)).toContainText("처음부터 조립해 보기");
});

test("during a procedure the next-step chips follow the view", async ({ page }, info) => {
  await openStudio(page, `/studio/pc?guide=${pc.guides[0].id}&step=2`);
  const panel = chat(page);
  const next = panel.getByRole("group", { name: "다음에 해 볼 것" });
  await expect(next.getByRole("button").first()).toHaveText("다음 단계");
  await expect(next.getByRole("button", { name: "왜 이렇게 해요?" })).toBeVisible();

  // Peek at a part: the first chip becomes the way back, and it works without the model.
  const tree = await partsTree(page, info);
  await tree.getByRole("treeitem", { name: partLabel("gpu"), exact: true }).click();
  await expect(next.getByRole("button").first()).toContainText("원래 단계로");
  await next.getByRole("button", { name: "원래 단계로" }).click();
  await expect(procedure(page).getByRole("status").filter({ hasText: "잠깐 보는 중" })).toHaveCount(0);
  await expect(next.getByRole("button").first()).toHaveText("다음 단계");
});

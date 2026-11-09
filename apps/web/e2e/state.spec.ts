import { expect, test } from "@playwright/test";

import { isPhone, openStudio, partsTree, procedure, viewport } from "./support/studio";

test("keyboard alone walks the assembly steps", async ({ page }) => {
  await openStudio(page);
  const steps = procedure(page);
  const next = steps.getByRole("button", { name: "다음 단계" });

  await next.focus();
  await page.keyboard.press("Enter");
  await expect(steps).toContainText("1/7");
  await expect(steps).toContainText("케이스 놓기");
  await page.keyboard.press("Enter");
  await expect(steps).toContainText("2/7");
  await expect(viewport(page)).toHaveAccessibleName(/메인보드 강조/);

  await steps.getByRole("button", { name: "이전 단계" }).press("Enter");
  await expect(steps).toContainText("1/7");
});

test("peeking at a part keeps the step, and 원래 단계로 returns", async ({ page }, info) => {
  await openStudio(page, "/studio/pc?step=s_heatsink");
  const steps = procedure(page);
  await expect(steps).toContainText("4/7");

  const tree = await partsTree(page, info);
  await tree.getByRole("treeitem", { name: "그래픽카드", exact: true }).click();
  const peek = steps.getByRole("status").filter({ hasText: "잠깐 보는 중: 그래픽카드" });
  await expect(peek).toBeVisible();
  await expect(viewport(page)).toHaveAccessibleName(/그래픽카드 강조/);
  await expect(steps).toContainText("4/7");

  await steps.getByRole("button", { name: "원래 단계로" }).click();
  await expect(peek).toHaveCount(0);
  await expect(viewport(page)).toHaveAccessibleName(/M\.2 방열판 강조/);
  await expect(steps).toContainText("4/7");
});

test("parts tree supports arrow keys and shows check points", async ({ page }, info) => {
  await openStudio(page);
  const tree = await partsTree(page, info);
  const board = tree.getByRole("treeitem", { name: "메인보드" });

  await tree.getByRole("treeitem", { name: "케이스" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(board).toBeFocused();
  await expect(board).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(board).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  const slot = tree.getByRole("treeitem", { name: "PCIe x16 슬롯" });
  await expect(slot).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(slot).toHaveAttribute("aria-selected", "true");
  await expect(viewport(page)).toHaveAccessibleName(/확인할 곳 PCIe x16 슬롯/);
});

test("progress survives a reload on this device", async ({ page }) => {
  await openStudio(page, "/studio/pc?step=s_gpu");
  await expect(procedure(page)).toContainText("5/7");
  await procedure(page).getByRole("button", { name: "다음 단계" }).click();
  await expect(procedure(page)).toContainText("6/7");

  await page.goto("/studio/pc");
  await expect(procedure(page)).toContainText("6/7");
  await expect(procedure(page)).toContainText("보조 전원 꽂기");
});

test("a guide deep link opens the service procedure", async ({ page }) => {
  await openStudio(page, "/studio/pc?guide=ssd_not_detected&step=2");
  const steps = procedure(page);
  await expect(steps.getByRole("heading", { level: 2, name: "SSD가 인식되지 않음" })).toBeVisible();
  await expect(steps).toContainText(/^.*2\/\d+/);
  await steps.getByRole("button", { name: "조립 순서로 돌아가기" }).click();
  await expect(steps.getByRole("heading", { level: 2, name: "조립 순서" })).toBeVisible();
});

test("a common mistake shows as an alert and can be cleared", async ({ page }) => {
  await openStudio(page, "/studio/pc?step=s_m2");
  const steps = procedure(page);
  await steps.getByRole("button", { name: /^흔한 실수 보기:/ }).click();
  const alert = steps.getByRole("alert");
  await expect(alert).toContainText("흔한 실수:");
  await expect(viewport(page)).toHaveAccessibleName(/흔한 실수를 겹쳐 보는 중/);
  await alert.getByRole("button", { name: "맞는 방법만 보기" }).click();
  await expect(steps.getByRole("alert")).toHaveCount(0);
});

test("view menu, explode and camera owner", async ({ page }) => {
  await openStudio(page);
  const toolbar = page.getByRole("toolbar", { name: "보기 조작" });
  await toolbar.getByRole("button", { name: /^시점:/ }).click();
  await page.getByRole("menuitemradio", { name: "정면" }).click();
  await expect(viewport(page)).toHaveAccessibleName(/정면/);

  await viewport(page).dispatchEvent("pointerdown");
  await expect(page.getByRole("status").filter({ hasText: "직접 돌려 보는 중" })).toBeVisible();
  await toolbar.getByRole("button", { name: "안내 시점으로" }).click();
  await expect(page.getByRole("status").filter({ hasText: "안내 시점으로 보는 중" })).toBeVisible();
});

test("start over clears this device", async ({ page }) => {
  await openStudio(page, "/studio/pc?step=s_gpu");
  await expect(procedure(page)).toContainText("5/7");
  await page.getByRole("button", { name: "메뉴" }).click();
  await page.getByRole("menuitem", { name: "처음부터 다시 시작" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "지우고 다시 시작" }).click();
  await page.waitForLoadState("load");
  await page.goto("/studio/pc");
  await expect(procedure(page)).toContainText("시작 전");
});

test("phone: chat sheet and full-screen 3D", async ({ page }, info) => {
  test.skip(!isPhone(info), "phone layout only");
  await openStudio(page);
  await page.getByRole("button", { name: "대화 펼치기" }).click();
  await expect(page.getByRole("button", { name: "대화 접기" })).toBeVisible();

  await page.getByRole("button", { name: "3D 크게 보기" }).click();
  await expect(page.getByRole("complementary", { name: "대화" })).toBeHidden();
  await page.getByRole("button", { name: "원래 크기로" }).click();
  await expect(page.getByRole("complementary", { name: "대화" })).toBeVisible();
});

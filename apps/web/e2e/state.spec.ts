import { expect, test } from "@playwright/test";

import { esc, partLabel, pc, pos } from "./support/product";
import { isPhone, openStudio, partsTree, procedure, viewport } from "./support/studio";

const steps0 = pc.assembly;
const indexOf = (stepId: string) => steps0.findIndex((s) => s.id === stepId);

test("keyboard alone walks the assembly steps", async ({ page }) => {
  await openStudio(page);
  const steps = procedure(page);
  const next = steps.getByRole("button", { name: "다음 단계" });

  await next.focus();
  await page.keyboard.press("Enter");
  await expect(steps).toContainText(pos(0));
  await expect(steps).toContainText(steps0[0].label);
  await page.keyboard.press("Enter");
  await expect(steps).toContainText(pos(1));
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`${esc(partLabel(steps0[1].partId))} 강조`));

  await steps.getByRole("button", { name: "이전 단계" }).press("Enter");
  await expect(steps).toContainText(pos(0));
});

test("peeking at a part keeps the step, and 원래 단계로 returns", async ({ page }, info) => {
  const step = steps0.find((s) => s.partId !== "gpu" && indexOf(s.id) > 1)!;
  const gpu = partLabel("gpu");
  await openStudio(page, `/studio/pc?step=${step.id}`);
  const steps = procedure(page);
  await expect(steps).toContainText(pos(indexOf(step.id)));

  const tree = await partsTree(page, info);
  await tree.getByRole("treeitem", { name: gpu, exact: true }).click();
  const peek = steps.getByRole("status").filter({ hasText: `잠깐 보는 중: ${gpu}` });
  await expect(peek).toBeVisible();
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`${esc(gpu)} 강조`));
  await expect(steps).toContainText(pos(indexOf(step.id)));

  await steps.getByRole("button", { name: "원래 단계로" }).click();
  await expect(peek).toHaveCount(0);
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`${esc(partLabel(step.partId))} 강조`));
  await expect(steps).toContainText(pos(indexOf(step.id)));
});

test("parts tree supports arrow keys and shows check points", async ({ page }, info) => {
  const i = pc.parts.findIndex((p, k) => k > 0 && pc.features.some((f) => f.partId === p.id));
  const part = pc.parts[i];
  const feature = pc.features.find((f) => f.partId === part.id)!;
  await openStudio(page);
  const tree = await partsTree(page, info);
  const row = tree.getByRole("treeitem", { name: part.label, exact: true });

  await tree.getByRole("treeitem", { name: pc.parts[i - 1].label, exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  const point = tree.getByRole("treeitem", { name: feature.label, exact: true });
  await expect(point).toBeFocused();
  await page.keyboard.press("Enter");
  // On phones choosing a part closes the drawer, so the row is gone.
  if (!isPhone(info)) await expect(point).toHaveAttribute("aria-selected", "true");
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`확인할 곳 ${esc(feature.label)}`));
});

test("progress survives a reload on this device", async ({ page }) => {
  const i = indexOf("s_gpu");
  await openStudio(page, "/studio/pc?step=s_gpu");
  await expect(procedure(page)).toContainText(pos(i));
  await procedure(page).getByRole("button", { name: "다음 단계" }).click();
  await expect(procedure(page)).toContainText(pos(i + 1));

  await page.goto("/studio/pc");
  await expect(procedure(page)).toContainText(pos(i + 1));
  await expect(procedure(page)).toContainText(steps0[i + 1].label);
});

test("a guide deep link opens the service procedure", async ({ page }) => {
  const guide = pc.guides[0];
  await openStudio(page, `/studio/pc?guide=${guide.id}&step=2`);
  const steps = procedure(page);
  await expect(steps.getByRole("heading", { level: 2, name: guide.title })).toBeVisible();
  await expect(steps).toContainText(/2\/\d+/);
  await steps.getByRole("button", { name: "조립 순서로 돌아가기" }).click();
  await expect(steps.getByRole("heading", { level: 2, name: "조립 순서" })).toBeVisible();
});

test("a common mistake shows as an alert and can be cleared", async ({ page }) => {
  const step = steps0.find((s) => s.mistakes?.length)!;
  await openStudio(page, `/studio/pc?step=${step.id}`);
  const steps = procedure(page);
  await steps.getByRole("button", { name: /^흔한 실수 보기:/ }).click();
  const alert = steps.getByRole("alert");
  await expect(alert).toContainText(`흔한 실수: ${step.mistakes![0].label}`);
  await expect(viewport(page)).toHaveAccessibleName(/흔한 실수를 겹쳐 보는 중/);
  await alert.getByRole("button", { name: "맞는 방법만 보기" }).click();
  await expect(steps.getByRole("alert")).toHaveCount(0);
});

test("view menu, explode and camera owner", async ({ page }) => {
  const [, view] = Object.entries(pc.views).find(([name]) => name !== "default")!;
  await openStudio(page);
  const toolbar = page.getByRole("toolbar", { name: "보기 조작" });
  await toolbar.getByRole("button", { name: /^시점:/ }).click();
  await page.getByRole("menuitemradio", { name: view.label!, exact: true }).click();
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(esc(view.label!)));

  await page.locator("[data-testid=engine-host] canvas").dispatchEvent("wheel");
  await expect(page.getByRole("status").filter({ hasText: "직접 돌려 보는 중" })).toBeVisible();
  await toolbar.getByRole("button", { name: "안내 시점으로" }).click();
  await expect(page.getByRole("status").filter({ hasText: "안내 시점으로 보는 중" })).toBeVisible();
});

test("start over clears this device", async ({ page }) => {
  await openStudio(page, "/studio/pc?step=s_gpu");
  await expect(procedure(page)).toContainText(pos(indexOf("s_gpu")));
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

test("switching between phone and desktop layout moves the same 3D canvas", async ({ page }) => {
  await openStudio(page);
  const canvas = page.locator("[data-testid=engine-host] canvas");
  await expect(canvas).toHaveCount(1);
  await canvas.evaluate((el) => el.setAttribute("data-e2e-mark", "first"));
  const size = page.viewportSize()!;
  await page.setViewportSize(size.width < 768 ? { width: 1280, height: 800 } : { width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "3D 보기" })).toBeVisible();
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute("data-e2e-mark", "first");
});

import { expect, test } from "@playwright/test";

import { isPhone, openStudio, partsTree, procedure, viewport } from "./support/studio";
import { pc, pos } from "./support/product";

const last = pc.assembly.at(-1)!;
const total = pc.assembly.length + 1;

test("after the last step comes 완성: whole product, nothing highlighted, back returns", async ({ page }) => {
  await openStudio(page, `/studio/pc?step=${last.id}`);
  const steps = procedure(page);
  await expect(steps).toContainText(pos(pc.assembly.length - 1));
  const next = steps.getByRole("button", { name: "다음 단계" });
  await expect(next).toBeEnabled();

  await next.click();
  await expect(steps).toContainText(`${total}/${total}`);
  await expect(steps).toContainText("완성");
  await expect(next).toBeDisabled();
  await expect(viewport(page)).not.toHaveAccessibleName(/강조/);

  // Reload keeps 완성.
  await page.goto("/studio/pc");
  await expect(procedure(page)).toContainText(`${total}/${total}`);

  await procedure(page).getByRole("button", { name: "이전 단계" }).click();
  await expect(procedure(page)).toContainText(pos(pc.assembly.length - 1));
  await expect(procedure(page)).toContainText(last.label);
});

test("a picked part can be cleared: click it again or press Escape", async ({ page }, info) => {
  await openStudio(page, `/studio/pc?step=${last.id}`);
  await procedure(page).getByRole("button", { name: "다음 단계" }).click();
  await expect(procedure(page)).toContainText("완성");

  const tree = await partsTree(page, info);
  const part = pc.parts.find((p) => !p.consumable && p.id !== last.partId)!;
  const row = tree.getByRole("treeitem", { name: part.label, exact: true });
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`${part.label.replace(/[()]/g, "\\$&")} 강조`));

  if (isPhone(info)) {
    // The drawer closes on pick; reopen it to click the row again.
    const again = await partsTree(page, info);
    await again.getByRole("treeitem", { name: part.label, exact: true }).click();
    // Clearing also closes the drawer so the 3D is in view.
    await expect(page.getByRole("dialog", { name: "부품" })).toHaveCount(0);
    const reopened = await partsTree(page, info);
    await expect(reopened.getByRole("treeitem", { name: part.label, exact: true })).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Escape");
  } else {
    await row.click();
    await expect(row).toHaveAttribute("aria-selected", "false");
    await row.click();
    await expect(row).toHaveAttribute("aria-selected", "true");
    await row.press("Escape");
    await expect(row).toHaveAttribute("aria-selected", "false");
  }
  await expect(viewport(page)).not.toHaveAccessibleName(/강조/);
  await expect(procedure(page)).toContainText("완성");
});

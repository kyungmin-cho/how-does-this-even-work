import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { esc, partLabel, pc } from "./support/product";
import { isPhone, openStudio, partsTree, viewport } from "./support/studio";

// A part other than the first, so the click has to move focus and selection.
const part = pc.parts.find((p, i) => i > 0 && !p.consumable) ?? pc.parts[1];

/** The phone drawer closes after a pick; open it again to read the row's state. */
async function rowAfterPick(page: Page, info: TestInfo, tree: Locator) {
  const again = isPhone(info) ? await partsTree(page, info) : tree;
  return again.getByRole("treeitem", { name: part.label, exact: true });
}

test("a mouse click on a parts tree row selects it and peeks at it in 3D", async ({ page }, info) => {
  await openStudio(page);
  const tree = await partsTree(page, info);
  await tree.getByRole("treeitem", { name: part.label, exact: true }).click();

  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`${esc(partLabel(part.id))} 강조`));
  await expect(await rowAfterPick(page, info, tree)).toHaveAttribute("aria-selected", "true");
});

// Screen readers and browser automation send the click to the element that has the treeitem role,
// not to the row drawn inside it. That click must do what Enter does.
test("a click sent to the treeitem itself also selects and peeks", async ({ page }, info) => {
  await openStudio(page);
  const tree = await partsTree(page, info);
  await tree.getByRole("treeitem", { name: part.label, exact: true }).dispatchEvent("click");

  await expect(viewport(page)).toHaveAccessibleName(new RegExp(`${esc(partLabel(part.id))} 강조`));
  await expect(await rowAfterPick(page, info, tree)).toHaveAttribute("aria-selected", "true");
});

import { expect, type Page, type TestInfo } from "@playwright/test";

export const isPhone = (info: TestInfo) => info.project.name === "phone";

/** Open the studio on a clean device (no saved state) and wait until it is ready. */
export async function openStudio(page: Page, path = "/studio/pc", { keepStorage = false } = {}) {
  await page.addInitScript((live) => {
    localStorage.setItem("hdtew:e2e", "1");
    if (!live) localStorage.setItem("hdtew:mock-agent", "1");
  }, process.env.LIVE_AGENT === "1");
  if (!keepStorage) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("__e2e_cleared")) {
        const keep = ["hdtew:mock-agent", "hdtew:e2e"].map((k) => [k, localStorage.getItem(k)] as const);
        localStorage.clear();
        for (const [k, v] of keep) if (v) localStorage.setItem(k, v);
        sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
  }
  await page.goto(path);
  await expect(page.getByRole("region", { name: "3D 보기" })).toBeVisible({ timeout: 60_000 });
}

/** The parts tree: left panel on desktop, drawer on phones. */
export async function partsTree(page: Page, info: TestInfo) {
  if (isPhone(info)) {
    await page.getByRole("button", { name: "부품 목록" }).click();
    const dialog = page.getByRole("dialog", { name: "부품" });
    await expect(dialog).toBeVisible();
    return dialog.getByRole("tree", { name: "부품" });
  }
  return page.getByRole("navigation", { name: "부품" }).getByRole("tree", { name: "부품" });
}

export const viewport = (page: Page) => page.getByRole("img", { name: /^3D 화면:/ });
export const procedure = (page: Page) => page.getByRole("region", { name: "절차" });
export const chat = (page: Page) => page.getByRole("complementary", { name: "대화" });

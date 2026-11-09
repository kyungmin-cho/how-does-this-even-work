import { expect, test } from "@playwright/test";

import { esc, partLabel, pc } from "./support/product";
import { chat, isPhone, openStudio, partsTree, procedure, viewport } from "./support/studio";

test.describe("sitemap", () => {
  test("home opens the default product", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/studio\/pc$/);
  });

  test("unknown product is a 404", async ({ page }) => {
    const res = await page.goto("/studio/nope");
    expect(res?.status()).toBe(404);
  });

  test("sitemap.xml and robots.txt list the studio", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/studio/pc");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("sitemap.xml");
  });
});

test("accessibility tree has the landmarks and controls the design names", async ({ page }, info) => {
  await openStudio(page);

  const banner = page.getByRole("banner");
  await expect(banner.getByRole("combobox", { name: "제품" })).toBeVisible();
  await expect(banner.getByRole("heading", { level: 1, name: "How Does This Even Work?" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "처음부터 다시" })).toBeVisible();

  const main = page.getByRole("main");
  await expect(main.getByRole("region", { name: "3D 보기" })).toBeVisible();
  await expect(viewport(page)).toHaveAccessibleName(new RegExp(esc(pc.name)));
  await expect(page.getByRole("toolbar", { name: "보기 조작" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "안내 시점으로 보는 중" })).toBeVisible();

  const steps = procedure(page);
  await expect(steps.getByRole("heading", { level: 2, name: "조립 순서" })).toBeVisible();
  const nav = steps.getByRole("group", { name: "단계 이동" });
  await expect(nav.getByRole("button", { name: "이전 단계" })).toBeDisabled();
  await expect(nav.getByRole("button", { name: "다음 단계" })).toBeEnabled();

  const panel = chat(page);
  await expect(panel.getByRole("log", { name: "대화 내용" })).toBeVisible();
  await expect(panel.getByRole("group", { name: "예시 질문" })).toBeVisible();
  const form = panel.getByRole("form", { name: "질문하기" });
  await expect(form.getByRole("textbox", { name: "질문" })).toBeVisible();
  await expect(form.getByRole("button", { name: "보내기" })).toBeDisabled();

  const tree = await partsTree(page, info);
  await expect(tree.getByRole("treeitem", { name: partLabel("gpu"), exact: true })).toBeVisible();

  if (isPhone(info)) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "부품" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "대화 펼치기" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "부품" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "부품 패널 접기" })).toBeVisible();
  }
});

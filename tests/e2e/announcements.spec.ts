import { test, expect } from "@playwright/test";
import type { AnnouncementResult } from "../../src/lib/announcement-types";

/** 三交易所公开免费源使用真实证券索引，分页无重复且完整过滤数量一致。 */
test("公告接口覆盖沪深北，返回安全原文、完整区间真实分页与分类", async ({ request }) => {
  const query = "start=2026-01-01&end=2026-10-09";
  for (const symbol of ["sh600519", "sz000001", "bj920344"]) {
    const first = await request.get(`/api/announcements?symbol=${symbol}&${query}`);
    expect(first.status()).toBe(200);
    const result: AnnouncementResult = (await first.json()).data;
    expect(result.total).toBeGreaterThan(20);
    expect(result.items).toHaveLength(20);
    expect(
      result.items.every(
        (item) =>
          item.symbol === symbol &&
          /^https:\/\/static\.cninfo\.com\.cn\/finalpage\//.test(item.url),
      ),
    ).toBe(true);
    expect(result.items.map((item) => item.publishedAt)).toEqual(
      result.items
        .map((item) => item.publishedAt)
        .sort()
        .reverse(),
    );
    const second: AnnouncementResult = (
      await (await request.get(`/api/announcements?symbol=${symbol}&${query}&page=2`)).json()
    ).data;
    expect(second.total).toBe(result.total);
    expect(
      second.items.some((item) => result.items.some((previous) => previous.id === item.id)),
    ).toBe(false);
  }
  const reports = await request.get(
    `/api/announcements?symbol=sh600519&${query}&category=financial&keyword=报告`,
  );
  expect(reports.status()).toBe(200);
  const result = (await reports.json()).data as AnnouncementResult;
  expect(result.total).toBeGreaterThan(0);
  expect(
    result.items.every((item) => item.category === "financial" && item.title.includes("报告")),
  ).toBe(true);
  for (const suffix of [
    "symbol=sh000001",
    "symbol=sh600519&page=31",
    "symbol=sh600519&start=2026-02-30",
    "symbol=sh600519&start=2025-01-01&end=2026-10-09",
    "symbol=sh600519&category=__proto__",
  ]) {
    expect((await request.get(`/api/announcements?${suffix}`)).status()).toBe(400);
  }
});

/** 浏览器操作真实日期表单、关键词查询、翻页和空状态；所有主题尺寸无横向溢出。 */
test("公告页面可查询翻页，桌面手机明暗主题布局正常", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/stock/sh600519?view=announcements");
  await expect(page.getByRole("heading", { name: "公告与事件" })).toBeVisible();
  await page.getByLabel("公告开始日期", { exact: true }).fill("2026-01-01");
  await page.getByLabel("公告结束日期", { exact: true }).fill("2026-10-09");
  await page.getByRole("button", { name: "查询公告" }).click();
  await expect(page.locator(".announcement-row")).toHaveCount(20);
  const initialTitle = await page.locator(".announcement-content strong").first().textContent();
  await page.locator(".announcements-pagination").getByTitle("2", { exact: true }).click();
  await expect(page.locator(".announcement-content strong").first()).not.toHaveText(initialTitle!);
  await page.getByLabel("公告标题关键词", { exact: true }).fill("权益分派");
  await page.getByRole("button", { name: "查询公告" }).click();
  await expect(page.locator(".announcement-row")).toHaveCount(1);
  await expect(page.locator(".announcement-content strong")).toContainText("权益分派");
  await page.getByLabel("公告标题关键词", { exact: true }).fill("绝不会有这个测试标题");
  await page.getByRole("button", { name: "查询公告" }).click();
  await expect(page.getByText("该日期及筛选条件下暂无公开公告")).toBeVisible();
  await page.getByLabel("公告标题关键词", { exact: true }).fill("");
  await page.getByRole("button", { name: "查询公告" }).click();
  await expect(page.locator(".announcement-row")).toHaveCount(20);
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", { name: theme === "dark" ? "切换暗色主题" : "切换亮色主题" })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const [name, width] of [
      ["desktop", 1440],
      ["mobile", 390],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page
        .locator(".announcements-panel")
        .evaluate((element) =>
          window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 130),
        );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);
      await page.screenshot({ path: `artifacts/phase2-qa/announcements-${name}-${theme}.png` });
    }
  }
  await page.goto("/stock/sh000001");
  await expect(page.getByRole("tab", { name: "公告与事件" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** 显式模拟上游暂不可用，确认局部失败不会显示旧列表为新结果且允许真实重试。 */
test("公告失败有局部提示且重新加载恢复真实数据", async ({ page }) => {
  await page.route("**/api/announcements?**", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "公告公开查询暂不可用，请稍后重试" }),
    }),
  );
  await page.goto("/stock/sh600519?view=announcements");
  await expect(
    page.locator(".announcements-panel").getByText("公告公开查询暂不可用，请稍后重试"),
  ).toBeVisible();
  await expect(page.locator(".announcement-row")).toHaveCount(0);
  await page.unroute("**/api/announcements?**");
  await page.locator(".announcements-panel").getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".announcement-row")).toHaveCount(20);
});

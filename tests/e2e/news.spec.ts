import { test, expect } from "@playwright/test";

/** 资讯条目保留官方标题和时间，原文链接只允许新浪 HTTPS 域名且同页去重。 */
test("股票、财经、环球资讯使用真实标题时间与安全原文链接", async ({ request }) => {
  for (const category of ["stocks", "finance", "world"]) {
    const response = await request.get(`/api/news?category=${category}&page=1`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.meta.source).toBe("新浪财经");
    expect(result.data.category).toBe(category);
    expect(result.data.items.length).toBeGreaterThan(0);
    expect(result.data.items.length).toBeLessThanOrEqual(20);
    expect(result.data.total).toBeGreaterThanOrEqual(result.data.items.length);
    expect(new Set(result.data.items.map((item: { id: string }) => item.id)).size).toBe(
      result.data.items.length,
    );
    for (const item of result.data.items) {
      const url = new URL(item.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toMatch(/(^|\.)sina\.com\.cn$|(^|\.)sina\.cn$/);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.title).not.toMatch(/<[^>]*>/);
      expect(Number.isFinite(Date.parse(item.publishedAt))).toBe(true);
      expect(item.source.length).toBeGreaterThan(0);
    }
    const second = await request.get(`/api/news?category=${category}&page=2`);
    expect(second.status()).toBe(200);
    const next = (await second.json()).data;
    expect(next.items.length).toBeGreaterThan(0);
    // 翻页后至少有新记录；不把新资讯进入导致的少量页面重叠当成重复分页。
    const firstIds = new Set(result.data.items.map((item: { id: string }) => item.id));
    expect(next.items.some((item: { id: string }) => !firstIds.has(item.id))).toBe(true);
  }
  for (const url of [
    "/api/news?category=foreign",
    "/api/news?page=0",
    "/api/news?page=101",
    "/api/news?page=1.5",
  ]) {
    expect((await request.get(url)).status(), url).toBe(400);
  }
});

/** 分类分页状态可分享，外链使用独立标签且不传递来源页信息。 */
test("财经资讯分类和分页更新 URL，首页展示五条预览", async ({ page }) => {
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: "财经资讯", exact: true })).toBeVisible();
  await expect(page.locator(".news-row").first()).toBeVisible();
  await page.getByText("环球", { exact: true }).click();
  await expect(page).toHaveURL(/category=world&page=1/);
  await expect(page.locator(".news-row").first()).toBeVisible();
  await page.getByTitle("2", { exact: true }).click();
  await expect(page).toHaveURL(/category=world&page=2/);
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await page.reload();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  const article = page.locator(".news-row").first();
  await expect(article).toHaveAttribute("target", "_blank");
  await expect(article).toHaveAttribute("rel", /noreferrer/);
  const href = new URL((await article.getAttribute("href"))!);
  expect(href.protocol).toBe("https:");
  expect(href.hostname).toMatch(/(^|\.)sina\.com\.cn$|(^|\.)sina\.cn$/);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "市场资讯", exact: true })).toBeVisible();
  await expect(page.locator(".news-row")).toHaveCount(5);
  await page.getByRole("link", { name: /全部资讯/ }).click();
  await expect(page).toHaveURL(/\/news$/);
});

/** 网络失败不展示假资讯，局部重试后继续使用真实源数据。 */
test("资讯接口失败可以局部重试恢复", async ({ page }) => {
  const endpoint = "**/api/news?category=stocks&page=1";
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 502, json: { error: "资讯网络失败测试" } }),
  );
  await page.goto("/news");
  await expect(page.getByText("资讯网络失败测试", { exact: true })).toBeVisible();
  await page.unroute(endpoint);
  await page.getByRole("button", { name: /重新加载/ }).click();
  await expect(page.locator(".news-row").first()).toBeVisible();
});

/** 中英文长标题在 375px 可换行，暗亮主题及重载仍能访问资讯分类。 */
test("财经资讯在 375px 亮暗主题中不溢出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/news?category=world&page=1");
  await expect(page.locator(".news-row").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".news-row").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const nextPage = page.locator(".news-pagination .ant-pagination-next button");
  await nextPage.scrollIntoViewIfNeeded();
  await expect(nextPage).toBeVisible();
  const buttonBox = await nextPage.boundingBox();
  const panelBox = await page.locator(".news-panel").boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(375);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(0);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(812);
  await nextPage.click();
  await expect(page).toHaveURL(/category=world&page=2/);
  await expect(page.locator(".news-row").first()).toBeVisible();
  expect(errors).toEqual([]);
});

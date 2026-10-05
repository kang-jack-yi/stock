import { test, expect } from "@playwright/test";

/** 大板块不能被汇总接口的一百只样本截断，合计与领涨股要来自完整分页。 */
test("超过一百只的板块仍覆盖完整成分，保留三种源计数口径", async ({ request, page }) => {
  const first = await request.get("/api/sectors?type=concept&node=gn_fd&page=1");
  expect(first.status()).toBe(200);
  const initial = (await first.json()).data;
  expect(initial.total).toBeGreaterThan(100);
  expect(initial.sourceStockCount).toEqual(expect.any(Number));
  expect(initial.sector.reportedStockCount).toBeLessThan(initial.total);
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(initial.total / 20) }, async (_, index) => {
      const response = await request.get(`/api/sectors?type=concept&node=gn_fd&page=${index + 1}`);
      expect(response.status()).toBe(200);
      return (await response.json()).data.stocks;
    }),
  );
  const stocks = pages.flat();
  expect(stocks).toHaveLength(initial.total);
  expect(new Set(stocks.map((stock: { symbol: string }) => stock.symbol)).size).toBe(initial.total);
  expect(initial.amount).toBeCloseTo(
    stocks.reduce((sum: number, stock: { amount: number }) => sum + stock.amount, 0),
    1,
  );
  expect(initial.volume).toBe(
    stocks.reduce((sum: number, stock: { volume: number }) => sum + stock.volume, 0),
  );
  expect(initial.leader.symbol).toBe(stocks[0].symbol);
  expect(initial.leader.changePercent).toBeGreaterThanOrEqual(initial.sector.leaderChangePercent);
  const industry = await request.get("/api/sectors?type=industry&node=new_dzxx&page=13");
  expect(industry.status()).toBe(200);
  const completeIndustry = (await industry.json()).data;
  expect(completeIndustry.total).toBeGreaterThan(240);
  expect(completeIndustry.stocks.length).toBeGreaterThan(0);
  expect(completeIndustry.sourceStockCount).toEqual(expect.any(Number));
  await page.goto("/sectors?type=concept&node=gn_fd");
  await expect(page.locator(".sector-constituents .ant-table-tbody tr.ant-table-row")).toHaveCount(
    20,
  );
  await expect(page.locator(".sector-detail-heading")).toContainText(
    `实时成分 ${initial.total} 只`,
  );
  await expect(page.locator(".sector-detail-heading")).toContainText(
    `汇总榜 ${initial.sector.reportedStockCount} 只`,
  );
  await expect(page.getByText("完整成分成交额", { exact: true })).toBeVisible();
  await expect(page.getByText("完整成分领涨股", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".sector-detail-stats")
      .getByRole("link", { name: new RegExp(initial.leader.name) }),
  ).toBeVisible();
});

/** 完整板块榜与实时成分数量使用各自的源字段，不以汇总股数截断成分分页。 */
test("行业与概念板块完整返回，成分股支持独立排序和分页", async ({ request }) => {
  for (const kind of ["industry", "concept"]) {
    const response = await request.get(`/api/sectors?type=${kind}`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.meta.source).toBe("新浪财经");
    expect(result.data.total).toBe(result.data.sectors.length);
    expect(result.data.total).toBeGreaterThan(kind === "industry" ? 20 : 100);
    expect(new Set(result.data.sectors.map((sector: { id: string }) => sector.id)).size).toBe(
      result.data.total,
    );
  }
  const first = await request.get(
    "/api/sectors?type=concept&node=gn_BCdc&sort=amount&asc=0&page=1",
  );
  expect(first.status()).toBe(200);
  const firstResult = (await first.json()).data;
  expect(firstResult.stocks).toHaveLength(20);
  expect(firstResult.total).toBeGreaterThan(20);
  const amounts = firstResult.stocks.map((stock: { amount: number }) => stock.amount);
  expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  const second = await request.get(
    "/api/sectors?type=concept&node=gn_BCdc&sort=amount&asc=0&page=2",
  );
  expect(second.status()).toBe(200);
  const secondResult = (await second.json()).data;
  expect(secondResult.total).toBe(firstResult.total);
  expect(secondResult.stocks).toHaveLength(Math.min(20, firstResult.total - 20));
  expect(
    new Set(
      [...firstResult.stocks, ...secondResult.stocks].map(
        (stock: { symbol: string }) => stock.symbol,
      ),
    ).size,
  ).toBe(firstResult.stocks.length + secondResult.stocks.length);
  for (const url of [
    "/api/sectors?type=foreign",
    "/api/sectors?type=concept&node=gn_BCdc&page=-1",
    "/api/sectors?type=concept&node=gn_BCdc&sort=invalid",
  ]) {
    expect((await request.get(url)).status(), url).toBe(400);
  }
  expect((await request.get("/api/sectors?type=industry&node=gn_BCdc")).status()).toBe(404);
});

/** 图谱、列表、名称查询和共享 URL 均通过浏览器交互，成分页也可以继续翻页。 */
test("板块图谱与列表切换，名称搜索及成分页交互可用", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sectors");
  await expect(page.getByRole("heading", { name: "板块行情", exact: true })).toBeVisible();
  await expect(page.locator(".sector-tile")).toHaveCount(24);
  await page.getByText("概念板块", { exact: true }).click();
  await expect(page).toHaveURL(/type=concept/);
  await expect(page.locator(".sector-tile")).toHaveCount(24);
  const search = page.getByRole("textbox", { name: "搜索板块名称" });
  await search.fill("BC电池");
  await expect(page.locator(".sector-tile")).toHaveCount(1);
  await page.getByRole("button", { name: /BC电池 .*查看成分股/ }).click();
  await expect(page).toHaveURL(/node=gn_BCdc/);
  await expect(page.locator(".sector-constituents h2")).toHaveText("BC电池");
  await expect(page.locator(".sector-constituents .ant-table-tbody tr.ant-table-row")).toHaveCount(
    20,
  );
  await page.locator(".sector-constituents").getByTitle("2", { exact: true }).click();
  await expect(page.locator(".sector-constituents .ant-pagination-item-active")).toHaveText("2");
  await expect(page.locator(".sector-constituents .ant-table-tbody tr.ant-table-row")).toHaveCount(
    6,
  );
  await page.reload();
  await expect(page.locator(".sector-constituents h2")).toHaveText("BC电池");
  await search.fill("BC电池");
  await page.getByTitle("数据列表", { exact: true }).click();
  await expect(page.locator(".sector-board .ant-table-tbody tr.ant-table-row")).toHaveCount(1);
  await expect(page.locator(".sector-name-button")).toHaveAttribute("aria-label", "BC电池，查看成分股");
  await search.fill("完全没有的板块名字");
  await expect(page.getByText("没有匹配的板块，请尝试其他名称", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.locator(".sector-board .ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  const sort = page.getByRole("combobox", { name: "成分股排序指标" });
  await sort.click();
  const sorted = page.waitForResponse(
    (response) => response.url().includes("node=gn_BCdc&sort=amount") && response.status() === 200,
  );
  await sort.press("ArrowDown");
  await sort.press("Enter");
  await sorted;
  await expect(page.locator(".sector-constituents .ant-pagination-item-active")).toHaveText("1");
  expect(errors).toEqual([]);
});

/** 汇总榜和成分查询分别失败时局部重试，不影响另一模块显示和控件使用。 */
test("板块汇总及成分接口失败后能恢复，并显示无效分类节点", async ({ page }) => {
  const catalogEndpoint = "**/api/sectors?type=industry";
  await page.route(catalogEndpoint, (route) =>
    route.fulfill({ status: 502, json: { error: "板块汇总连接失败测试" } }),
  );
  await page.goto("/sectors");
  await expect(
    page.locator(".sector-board").getByText("板块汇总连接失败测试", { exact: true }),
  ).toBeVisible();
  await page.unroute(catalogEndpoint);
  await page
    .locator(".sector-board")
    .getByRole("button", { name: /重新加载/ })
    .click();
  await expect(page.locator(".sector-tile")).toHaveCount(24);
  const constituentEndpoint = "**/api/sectors?type=concept&node=gn_BCdc&**";
  await page.route(constituentEndpoint, (route) =>
    route.fulfill({ status: 502, json: { error: "成分查询连接失败测试" } }),
  );
  await page.goto("/sectors?type=concept&node=gn_BCdc");
  await expect(
    page.locator(".sector-constituents").getByText("成分查询连接失败测试", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sector-tile")).toHaveCount(24);
  await page.unroute(constituentEndpoint);
  await page
    .locator(".sector-constituents")
    .getByRole("button", { name: /重新加载/ })
    .click();
  await expect(page.locator(".sector-constituents .ant-table-tbody tr.ant-table-row")).toHaveCount(
    20,
  );
  await page.goto("/sectors?type=industry&node=gn_BCdc");
  await expect(
    page.getByText("该节点不属于当前板块分类，请在上方选择有效板块", { exact: true }),
  ).toBeVisible();
});

/** 图谱涨跌色、列表和成分表在两种主题下适配 375px，不扩大页面宽度。 */
test("板块页面在 375px 亮暗主题中没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/sectors?type=concept&node=gn_BCdc");
  await expect(page.locator(".sector-tile")).toHaveCount(24);
  await expect(page.locator(".sector-constituents .ant-table-tbody tr.ant-table-row")).toHaveCount(
    20,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".sector-tile")).toHaveCount(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByTitle("数据列表", { exact: true }).click();
  await expect(page.locator(".sector-board .ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

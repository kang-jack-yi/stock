import { test, expect } from "@playwright/test";

/** 全市场数据需覆盖源证券总数，分布互斥且筛选结果满足实际数值边界。 */
test("全市场快照和选股组合条件使用完整证券集合", async ({ request }) => {
  const [screen, market, breadth] = await Promise.all([
    request.get("/api/screener?sort=amount&order=desc"),
    request.get("/api/market/list?node=hs_a"),
    request.get("/api/breadth"),
  ]);
  expect(screen.status()).toBe(200);
  expect(breadth.status()).toBe(200);
  const result = (await screen.json()).data;
  const expectedTotal = (await market.json()).data.total;
  const statistics = (await breadth.json()).data;
  expect(result.universeTotal).toBe(expectedTotal);
  expect(result.total).toBe(expectedTotal);
  expect(statistics.total).toBe(expectedTotal);
  expect(
    statistics.advancing + statistics.declining + statistics.unchanged + statistics.unavailable,
  ).toBe(statistics.total);
  expect(
    statistics.distribution.reduce((sum: number, count: number) => sum + count, 0) +
      statistics.unavailable,
  ).toBe(statistics.total);
  expect(statistics.amount).toBeGreaterThan(
    result.stocks.reduce((sum: number, stock: { amount: number }) => sum + stock.amount, 0),
  );
  const lowValuation = await request.get(
    "/api/screener?profitable=1&excludeSt=1&maxPe=20&maxPb=2&sort=pe&order=asc",
  );
  expect(lowValuation.status()).toBe(200);
  const filtered = (await lowValuation.json()).data;
  expect(filtered.total).toBeGreaterThan(0);
  expect(filtered.total).toBeLessThan(filtered.universeTotal);
  const values = filtered.stocks.map((stock: { pe: number }) => stock.pe);
  expect(values).toEqual([...values].sort((left, right) => left - right));
  for (const stock of filtered.stocks) {
    expect(stock.pe).toBeGreaterThan(0);
    expect(stock.pe).toBeLessThanOrEqual(20);
    expect(stock.pb).toBeLessThanOrEqual(2);
    expect(stock.name).not.toMatch(/ST/i);
  }
  const northern = await request.get("/api/screener?market=bj");
  expect(northern.status()).toBe(200);
  expect(
    (await northern.json()).data.stocks.every((stock: { symbol: string }) =>
      stock.symbol.startsWith("bj"),
    ),
  ).toBe(true);
  const exact = await request.get("/api/screener?query=600519&minCap=1000000000000");
  expect(exact.status()).toBe(200);
  expect((await exact.json()).data.stocks.map((stock: { symbol: string }) => stock.symbol)).toEqual(
    ["sh600519"],
  );
});

/** 输入单位与 URL 原单位来回转换一致，预设、搜索、重置和分页都能继续操作。 */
test("选股预设、名称筛选、分页和重置同步表单与 URL", async ({ page }) => {
  await page.goto("/screener");
  await expect(page.getByRole("heading", { name: "条件选股", exact: true })).toBeVisible();
  await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  await page.getByRole("button", { name: "低估值", exact: true }).click();
  await expect(page).toHaveURL(/maxPe=20/);
  await expect(
    page.getByRole("spinbutton", { name: "市盈率 PE（倍）上限", exact: true }),
  ).toHaveValue("20");
  await expect(page.getByRole("checkbox", { name: "仅正 PE", exact: true })).toBeChecked();
  await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  await page.getByRole("button", { name: "大盘公司", exact: true }).click();
  await expect(page).toHaveURL(/minCap=100000000000/);
  await expect(
    page.getByRole("spinbutton", { name: "总市值（亿元）下限", exact: true }),
  ).toHaveValue("1000");
  await expect(
    page.getByRole("spinbutton", { name: "市盈率 PE（倍）上限", exact: true }),
  ).toHaveValue("");
  await page.getByRole("textbox", { name: "选股名称或代码" }).fill("600519");
  await page.getByRole("button", { name: /应用筛选/ }).click();
  await expect(page).toHaveURL(/query=600519/);
  await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(1);
  await expect(
    page.locator(".screener-results").getByText("贵州茅台", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /重置/ }).click();
  await expect(page).toHaveURL(/\/screener$/);
  await expect(page.getByRole("textbox", { name: "选股名称或代码" })).toHaveValue("");
  await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  await page.getByTitle("2", { exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
});

/** 共同交易日必须完整对齐，比较起点为零，区间指标由相同收盘序列得到。 */
test("股票比较 API 使用共同日期和一致归一基准", async ({ request }) => {
  const response = await request.get("/api/compare?symbols=sh600519,sz000001,sh000300&days=20");
  expect(response.status()).toBe(200);
  const result = (await response.json()).data;
  expect(result.requestedDays).toBe(20);
  expect(result.dates).toHaveLength(20);
  expect(result.dates).toEqual([...result.dates].sort());
  expect(result.quotes.map((quote: { symbol: string }) => quote.symbol)).toEqual([
    "sh600519",
    "sz000001",
    "sh000300",
  ]);
  for (const series of result.series) {
    expect(series.returns).toHaveLength(result.dates.length);
    expect(series.closes).toHaveLength(result.dates.length);
    expect(series.returns[0]).toBe(0);
    expect(series.totalReturn).toBeCloseTo((series.closes.at(-1) / series.closes[0] - 1) * 100, 8);
    expect(series.maxDrawdown).toBeLessThanOrEqual(0);
    expect(series.averageVolume).toBeGreaterThan(0);
  }
});

/** 所选证券与窗口可分享，四只上限和一只下限通过界面真实操作验证。 */
test("比较界面添加移除股票、切换周期，并保持 1 至 4 只限制", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "股票比较", exact: true })).toBeVisible();
  await expect(page.locator(".compare-remove")).toHaveCount(2);
  await expect(page.locator("canvas")).toBeVisible();
  const search = page.getByRole("combobox", { name: "添加比较股票" });
  for (const [code, name] of [
    ["000858", "五粮液"],
    ["600036", "招商银行"],
  ]) {
    await search.fill(code);
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(code));
  }
  await expect(page.locator(".compare-remove")).toHaveCount(4);
  await expect(search).toBeDisabled();
  await page.getByText("近 20 日", { exact: true }).click();
  await expect(page).toHaveURL(/days=20/);
  await expect(page.getByText(/20 个共同交易日/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "指标对照", exact: true })).toBeVisible();
  await page.getByText("查看比较图表数据", { exact: true }).click();
  await expect(page.locator(".chart-table .ant-table-tbody tr.ant-table-row")).toHaveCount(10);
  await expect(
    page.locator(".chart-table").getByRole("columnheader", { name: "贵州茅台", exact: true }),
  ).toBeVisible();
  await page.getByText("查看比较图表数据", { exact: true }).click();
  for (const symbol of ["sh600036", "sz000858", "sz000001"]) {
    await page.getByRole("button", { name: `移除比较 ${symbol}`, exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(symbol));
  }
  await expect(page.locator(".compare-remove")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "移除比较 sh600519", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".compare-remove")).toHaveCount(1);
  await expect(page.getByText(/20 个共同交易日/)).toBeVisible();
  expect(errors).toEqual([]);
});

/** 数据服务失败时仍保留筛选/比较控件，点击重试恢复真实结果。 */
test("选股和比较 API 错误提供可恢复的局部重试", async ({ page }) => {
  for (const [url, endpoint, container] of [
    ["/screener", "**/api/screener?**", ".screener-results"],
    ["/compare", "**/api/compare?**", ".page-content"],
  ]) {
    await page.route(endpoint, (route) =>
      route.fulfill({ status: 502, json: { error: "研究接口失败测试" } }),
    );
    await page.goto(url);
    await expect(
      page.locator(container).getByText("研究接口失败测试", { exact: true }),
    ).toBeVisible();
    await page.unroute(endpoint);
    await page
      .locator(container)
      .getByRole("button", { name: /重新加载/ })
      .click();
    if (url === "/screener")
      await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(
        20,
      );
    else await expect(page.locator("canvas")).toBeVisible();
  }
});

/** 不合法筛选边界与超出限制的比较参数在抓取行情之前返回参数错误。 */
test("研究 API 校验条件边界、证券数量和周期", async ({ request }) => {
  for (const url of [
    "/api/screener?minPrice=20&maxPrice=10",
    "/api/screener?minPe=-1",
    "/api/screener?minCap=Infinity",
    "/api/screener?market=foreign",
    "/api/screener?sort=__proto__",
    "/api/screener?page=1.5",
    "/api/screener?excludeSt=true",
    "/api/compare?symbols=sh600519,sz000001,sh600036,sz000858,sh000300",
    "/api/compare?symbols=invalid",
    "/api/compare?symbols=sh600519&days=10",
  ])
    expect((await request.get(url)).status(), url).toBe(400);
});

/** 新研究页面在 375px 保持页面宽度，内部表格可独立横向滚动。 */
test("选股与比较适配 375px 的亮暗主题", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ["/screener", "/compare"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    if (route === "/screener")
      await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(
        20,
      );
    else await expect(page.locator("canvas")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "切换暗色主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "切换亮色主题" }).click();
  }
});

import { test, expect } from "@playwright/test";

/** 真实上游响应必须包含可追溯时间与单位正确的有限值，覆盖沪深北及指数。 */
test("指数、沪深北股票、五档和财务字段保持真实单位与数据来源", async ({ request }) => {
  const response = await request.get(
    "/api/market/quotes?symbols=sh000001,sz399001,sz399006,sh000300,sh600519,sz000001,bj920344",
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.meta.source).toBe("新浪财经");
  expect(Number.isFinite(Date.parse(result.meta.fetchedAt))).toBe(true);
  expect(result.data).toHaveLength(7);
  const quote = result.data.find((item: { symbol: string }) => item.symbol === "sh600519");
  expect(quote.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(quote.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  expect(quote.price).toBeGreaterThan(0);
  expect(quote.totalShares).toBeGreaterThan(100000000);
  expect(quote.marketCap).toBeCloseTo(quote.totalShares * quote.price, 1);
  expect(quote.turnover).toBeCloseTo((quote.volume / quote.floatShares) * 100, 5);
  expect(quote.changePercent).toBeCloseTo(
    ((quote.price - quote.previousClose) / quote.previousClose) * 100,
    5,
  );
  expect(quote.bids).toHaveLength(5);
  expect(quote.asks).toHaveLength(5);
  for (const level of [...quote.bids, ...quote.asks]) {
    expect(level.volume).toBeGreaterThanOrEqual(0);
    expect(level.price).toBeGreaterThan(0);
  }
  for (const symbol of ["sh600519", "sh000001", "sz399001", "sz399006", "sh000300"]) {
    const minute = await request.get(`/api/market/minutes?symbol=${symbol}`);
    expect(minute.status()).toBe(200);
    const days = (await minute.json()).data;
    expect(days).toHaveLength(5);
    expect(days.map((day: { date: string }) => day.date)).toEqual(
      days.map((day: { date: string }) => day.date).sort(),
    );
    const latest = days.at(-1);
    expect(latest.points).toHaveLength(241);
    expect(latest.points[0].time).toBe("09:30");
    expect(latest.points.at(-1).time).toBe("15:00");
    expect(
      latest.points.every(
        (point: { price: number; volume: number }) =>
          Number.isFinite(point.price) && point.volume >= 0,
      ),
    ).toBe(true);
    if (symbol !== "sh600519") {
      const snapshot = result.data.find((item: { symbol: string }) => item.symbol === symbol);
      if (snapshot.date === latest.date) {
        // 各接口统一为股；分钟量合计与同日指数快照应处于相同数量级。
        const volume = latest.points.reduce(
          (sum: number, point: { volume: number }) => sum + point.volume,
          0,
        );
        expect(volume / snapshot.volume).toBeGreaterThan(0.85);
        expect(volume / snapshot.volume).toBeLessThan(1.15);
      }
    }
    const dailyResponse = await request.get(`/api/market/candles?symbol=${symbol}&scale=240`);
    expect(dailyResponse.status()).toBe(200);
    const daily = (await dailyResponse.json()).data;
    const snapshot = result.data.find((item: { symbol: string }) => item.symbol === symbol);
    const sameDay = daily.find((candle: { date: string }) => candle.date === snapshot.date);
    if (sameDay) {
      // 日 K 的源成交量已经是股，不应再次将指数成交量乘以 100。
      expect(sameDay.volume / snapshot.volume).toBeGreaterThan(0.98);
      expect(sameDay.volume / snapshot.volume).toBeLessThan(1.02);
    }
  }
  for (const symbol of ["sh000001", "sz399001"]) {
    const endpoint =
      "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
    const original = await request.get(`${endpoint}?symbol=${symbol}&scale=5&ma=no&datalen=5`, {
      headers: { Referer: "https://finance.sina.com.cn/" },
    });
    expect(original.status()).toBe(200);
    const closedBar = (await original.json())[0];
    const normalized = await request.get(`/api/market/candles?symbol=${symbol}&scale=5`);
    expect(normalized.status()).toBe(200);
    const sameBar = (await normalized.json()).data.find(
      (bar: { date: string }) => bar.date === closedBar.day,
    );
    // 使用早于当前最后一根的闭合分钟柱，避免盘中最后一根的自然更新导致假失败。
    expect(sameBar.volume).toBe(Number(closedBar.volume));
  }
  const funds = await request.get("/api/market/funds?symbol=sh600519");
  expect(funds.status()).toBe(200);
  const flow = (await funds.json()).data;
  expect(flow.categories).toHaveLength(4);
  expect(flow.net).toBeCloseTo(
    flow.categories.reduce(
      (sum: number, category: { inflow: number; outflow: number }) =>
        sum + category.inflow - category.outflow,
      0,
    ),
    1,
  );
  for (const source of ["gjzb", "lrb", "fzb", "llb"]) {
    const financialResponse = await request.get(
      `/api/market/financials?symbol=sh600519&source=${source}`,
    );
    expect(financialResponse.status()).toBe(200);
    const reports = (await financialResponse.json()).data;
    expect(reports.dates).toHaveLength(8);
    expect(reports.dates).toEqual([...reports.dates].sort().reverse());
    expect(new Set(reports.rows.map((row: { field: string }) => row.field)).size).toBe(
      reports.rows.length,
    );
    expect(
      reports.rows.every(
        (row: { values: unknown[] }) => row.values.length === reports.dates.length,
      ),
    ).toBe(true);
    if (source === "gjzb") {
      expect(
        reports.rows.find((row: { field: string }) => row.field.startsWith("EPSBASIC|")).unit,
      ).toBe("元/股");
      expect(
        reports.rows.find((row: { field: string }) => row.field.startsWith("ROEWEIGHTED|")).unit,
      ).toBe("%");
    }
  }
});

/** 切换所有行情周期并展开数据表，防止仅 canvas 出现却使用了错误的系列。 */
test("分时、五日及所有 K 线周期可切换，表格数据可访问", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/stock/sh600519");
  await expect(page.getByRole("heading", { name: "贵州茅台" })).toBeVisible();
  const chart = page.locator(".chart-panel");
  await expect(chart.locator("canvas")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("新浪财经");
  await expect(page.locator('footer a[href="https://finance.sina.com.cn/"]')).toHaveCount(0);
  await expect(chart.locator(".data-meta")).toContainText(/数据时间 \d{4}-\d{2}-\d{2}/);
  for (const label of ["五日", "日 K", "周 K", "月 K", "5分", "15分", "30分", "60分", "分时"]) {
    await chart.locator(".chart-controls").getByText(label, { exact: true }).click();
    await expect(chart.locator("canvas")).toBeVisible();
    await chart.locator("summary").click();
    await expect(chart.locator(".ant-table-tbody tr.ant-table-row").first()).toBeVisible();
    await expect(
      chart.getByRole("columnheader", {
        name: label === "分时" || label === "五日" ? "均价" : "开盘",
        exact: true,
      }),
    ).toBeVisible();
    await chart.locator("summary").click();
    if (label === "日 K") {
      const container = chart.locator(".chart-container");
      await container.scrollIntoViewIfNeeded();
      const box = await container.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width * 0.6, box!.y + 160);
      const tooltip = container.locator(":scope > div").last();
      await expect(tooltip).toContainText("开盘");
      const lines = (await tooltip.innerText()).split("\n");
      expect(lines.slice(1, 3)).toEqual(["K线", "开盘"]);
      for (const field of ["开盘", "收盘", "最低", "最高", "MA5", "MA10", "MA20"]) {
        const position = lines.indexOf(field);
        expect(position, `提示应包含 ${field}`).toBeGreaterThanOrEqual(0);
        expect(lines[position + 1], `${field} 应保留两位小数`).toMatch(
          /^-?\d{1,3}(?:,\d{3})*\.\d{2}$/,
        );
      }
      expect(await tooltip.innerText()).not.toMatch(/open|close|lowest|highest/);
    }
  }
  await expect(page.locator(".book-row")).toHaveCount(10);
  expect(errors).toEqual([]);
});

/** 排行的市场、排序与分页应在接口端生效，而不是只修改当前页展示。 */
test("市场切换、排序和分页反映到接口请求", async ({ page }) => {
  await page.goto("/market");
  await expect(page.locator(".ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  for (const [label, node] of [
    ["创业板", "cyb"],
    ["科创板", "kcb"],
    ["沪市", "sh_a"],
    ["深市", "sz_a"],
  ]) {
    const loaded = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/market/list?node=${node}`) && response.status() === 200,
    );
    await page.getByText(label, { exact: true }).click();
    await loaded;
    await expect(page.locator(".ant-table-tbody tr.ant-table-row")).toHaveCount(20);
  }
  await page.getByRole("combobox", { name: "排序指标" }).click();
  const amountResponse = page.waitForResponse(
    (response) => response.url().includes("sort=amount") && response.status() === 200,
  );
  await page.getByRole("combobox", { name: "排序指标" }).press("ArrowDown");
  await page.getByRole("combobox", { name: "排序指标" }).press("Enter");
  await amountResponse;
  const secondPage = page.waitForResponse(
    (response) => response.url().includes("page=2") && response.status() === 200,
  );
  await page.getByTitle("2", { exact: true }).click();
  await secondPage;
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
});

/** 使用显式失败响应验证用户可重试；不将网络错误渲染为零报价或空财务。 */
test("行情失败后显示局部错误，并可重新加载真实数据", async ({ page }) => {
  const endpoint = "**/api/market/minutes?symbol=sh600519";
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 502, json: { error: "上游连接失败测试" } }),
  );
  await page.goto("/stock/sh600519");
  await expect(page.getByRole("heading", { name: "贵州茅台" })).toBeVisible();
  await expect(
    page.locator(".chart-panel").getByText("上游连接失败测试", { exact: true }),
  ).toBeVisible();
  await page.unroute(endpoint);
  await page
    .locator(".chart-panel")
    .getByRole("button", { name: /重新加载/ })
    .click();
  await expect(page.locator(".chart-panel canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "五档盘口" })).toBeVisible();
});

/** 缓存降级标识必须出现在界面，行情时间不能被当前请求时间替代。 */
test("使用旧缓存时展示降级提示和真实交易日期", async ({ page }) => {
  await page.route("**/api/market/minutes?symbol=sh600519", async (route) => {
    const upstream = await route.fetch();
    const result = await upstream.json();
    result.meta.stale = true;
    result.meta.warning = "上游暂不可用，当前展示上次成功获取的数据";
    await route.fulfill({ response: upstream, json: result });
  });
  await page.goto("/stock/sh600519");
  await expect(page.locator(".chart-panel canvas")).toBeVisible();
  await expect(page.locator(".chart-panel .stale")).toHaveText(
    "上游暂不可用，当前展示上次成功获取的数据",
  );
  await expect(page.locator(".chart-panel .data-meta")).toContainText(/数据时间 \d{4}-\d{2}-\d{2}/);
});

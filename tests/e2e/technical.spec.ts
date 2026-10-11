import { test, expect } from "@playwright/test";
import type { SignalsResult } from "../../src/lib/signal-types";
import type { TechnicalResult } from "../../src/lib/technical-types";

/** 真实固定免费源覆盖五个已核对成交量单位的板块，指标缺失不补零。 */
test("复权日线真实接口与沪深北字段单位", async ({ request }) => {
  for (const symbol of ["sh600519", "sz000001", "sz300308", "sh688981", "bj920344"]) {
    const response = await request.get(`/api/technical?symbol=${symbol}&adjustment=qfq`);
    expect(response.status()).toBe(200);
    const data: TechnicalResult = (await response.json()).data;
    expect(data.points.length).toBeGreaterThan(40);
    expect(data.points.length).toBeLessThanOrEqual(640);
    expect(data.points[0].ma20).toBeNull();
    expect(data.points.at(-1)!.ma20).toBeGreaterThan(0);
    expect(data.points.at(-1)!.volume).toBeGreaterThan(0);
    expect(new Set(data.points.map((row) => row.date)).size).toBe(data.points.length);
    expect(data.points.every((row) => row.date >= data.from && row.date <= data.to)).toBe(true);
  }
  for (const query of [
    "symbol=sh000001",
    "symbol=sz399001",
    "symbol=sh600519&adjustment=hfq",
    "symbol=https://example.test",
  ])
    expect((await request.get(`/api/technical?${query}`)).status()).toBe(400);
});

/** 服务端账号、同源、关注证券约束与记录隔离，不能通过前端字段指定他人账号。 */
test("技术条件权限、关注范围与账号隔离", async ({ playwright, baseURL }) => {
  const contexts = await Promise.all(
    [0, 1].map(() =>
      playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } }),
    ),
  );
  const [first, second] = contexts;
  try {
    expect((await first.get("/api/signals")).status()).toBe(401);
    for (const [i, api] of contexts.entries())
      expect(
        (
          await api.post("/api/auth/register", {
            data: {
              email: `signals-api-${Date.now()}-${i}@example.test`,
              name: "技术回归",
              password: "Signals-test-123",
            },
          })
        ).status(),
      ).toBe(200);
    const rule = { symbol: "sh600519", kind: "ma20Above" };
    expect((await first.post("/api/signals", { data: rule })).status()).toBe(400);
    expect((await first.post("/api/watchlist", { data: { symbol: rule.symbol } })).status()).toBe(
      200,
    );
    expect(
      (
        await first.post("/api/signals", {
          data: rule,
          headers: { Origin: "https://foreign.example" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await first.post("/api/signals", { data: { ...rule, userId: "other" } })).status(),
    ).toBe(400);
    expect((await first.post("/api/signals", { data: rule })).status()).toBe(200);
    expect((await first.post("/api/signals", { data: rule })).status()).toBe(400);
    const result: SignalsResult = await first.get("/api/signals").then((r) => r.json());
    expect(result.rules).toHaveLength(1);
    expect((await second.get("/api/signals").then((r) => r.json())).rules).toEqual([]);
    expect(
      (await second.delete("/api/signals", { data: { id: result.rules[0].id } })).status(),
    ).toBe(404);
    expect(
      (
        await first.patch("/api/signals", {
          data: { action: "enabled", id: result.rules[0].id, enabled: false },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await first.delete("/api/signals", { data: { id: result.rules[0].id } })).status(),
    ).toBe(200);
    expect((await first.get("/api/signals")).headers()["cache-control"]).toBe("no-store");
  } finally {
    await Promise.all(contexts.map((api) => api.dispose()));
  }
});

/** 真实浏览器点击复权切换、技术副图、订阅暂停和删除，覆盖全部尺寸及主题。 */
test("技术图表与条件操作在桌面平板手机明暗主题正常", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const headers = { Origin: baseURL! };
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers,
        data: {
          email: `signals-ui-${Date.now()}@example.test`,
          name: "技术浏览器回归",
          password: "Signals-test-123",
        },
      })
    ).status(),
  ).toBe(200);
  await page.request.post("/api/watchlist", { headers, data: { symbol: "sh600519" } });
  await page.goto("/stock/sh600519?view=technical");
  const chart = page.locator(".chart-panel");
  await expect(chart.locator(".chart-container")).toBeVisible();
  await chart.getByText("未复权", { exact: true }).click();
  await expect(chart.locator(".panel-caption")).toHaveText("未复权价格 · 均线 · 成交量");
  await chart.getByText("前复权", { exact: true }).click();
  for (const label of ["MACD", "RSI14", "布林带", "成交量"]) {
    await chart.getByText(label, { exact: true }).click();
    await expect(
      chart.locator(".technical-chart-tools .ant-segmented-item-selected").last(),
    ).toHaveText(label);
    await expect(chart.locator(".chart-container")).toBeVisible();
  }
  await page.getByRole("button", { name: "订阅此股票" }).click();
  const rules = page.locator(".technical-rules");
  await expect(rules.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await rules.getByRole("switch").click();
  await expect(rules.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await rules.getByRole("switch").click();
  await page.getByRole("button", { name: "检查我的条件" }).click();
  await expect(page.locator(".ant-message-notice").last()).toBeVisible();
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", { name: theme === "dark" ? "切换暗色主题" : "切换亮色主题" })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator(".ant-message-notice")).toHaveCount(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: `artifacts/phase3-qa/technical-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await rules.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确 定", exact: true }).click();
  await expect(rules.getByText("尚未订阅此股票的条件")).toBeVisible();
  expect(errors).toEqual([]);
});

/** 局部源失败后实际重试恢复；指数保留原图，不冒充复权。 */
test("技术日线失败可重试且未登录与指数边界清楚", async ({ page }) => {
  await page.route("**/api/technical?**", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "技术日线测试上游失败" }),
    }),
  );
  await page.goto("/stock/sh600519?view=technical");
  await expect(page.getByText("登录后可订阅自选或持仓的收盘技术条件")).toBeVisible();
  await expect(page.locator(".chart-panel").getByText("技术日线测试上游失败")).toBeVisible();
  await page.unroute("**/api/technical?**");
  await page.locator(".chart-panel").getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".chart-panel .chart-container")).toBeVisible();
  await page.goto("/stock/sh000001");
  await expect(page.getByRole("tab", { name: "技术信号" })).toHaveCount(0);
  await page.goto("/stock/sh510300?view=technical");
  await expect(page.getByRole("tab", { name: "技术信号" })).toHaveCount(0);
});

/** 实际跨标签会话变更后，旧规则和草稿清空；退出后不留账号数据。 */
test("技术信号工作台跨账号切换与草稿隔离", async ({ page, baseURL }) => {
  const headers = { Origin: baseURL! };
  for (const [i, name] of ["旧技术账号", "新技术账号"].entries()) {
    expect(
      (
        await page.request.post("/api/auth/register", {
          headers,
          data: {
            email: `signals-switch-${Date.now()}-${i}@example.test`,
            password: "Signals-test-123",
            name,
          },
        })
      ).status(),
    ).toBe(200);
    if (i === 0) {
      await page.request.post("/api/watchlist", { headers, data: { symbol: "sh600519" } });
      await page.request.post("/api/signals", {
        headers,
        data: { symbol: "sh600519", kind: "ma20Above" },
      });
      await page.goto("/signals");
      await expect(
        page.locator(".technical-rules").getByRole("link", { name: "sh600519", exact: true }),
      ).toBeVisible();
      await page.getByRole("textbox", { name: "技术订阅股票代码" }).fill("sz300308");
    }
  }
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return page.getByRole("button", { name: "账号菜单" }).textContent();
      },
      { timeout: 15000, intervals: [1000] },
    )
    .toContain("新技术账号");
  await expect(page.getByRole("textbox", { name: "技术订阅股票代码" })).toHaveValue("");
  await expect(page.locator(".technical-rules").getByText("尚未订阅技术条件")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/phase3-qa/signals-empty-mobile.png", fullPage: true });
  await page.request.post("/api/auth/logout", { headers, data: {} });
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return page.getByText("登录后管理个人技术条件和记录").count();
      },
      { timeout: 15000, intervals: [1000] },
    )
    .toBe(1);
  await expect(page.locator(".technical-rules")).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { portfolioToday, valuePortfolio } from "../../src/lib/portfolio-calculation";
import type { PortfolioInput, PortfolioResult } from "../../src/lib/portfolio-types";

const input: PortfolioInput = {
  date: "2026-01-05",
  kind: "deposit",
  symbol: "",
  quantity: 0,
  price: 0,
  amount: 10000,
  fee: 0,
  note: "测试入金",
};

/** 手工账本 API 验证会话隔离、CSRF、非法历史编辑/删除的事务回滚。 */
test("持仓账本权限、资金、超卖和历史事务回滚", async ({ playwright, baseURL }) => {
  const first = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const second = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  expect((await first.get("/api/portfolio")).status()).toBe(401);
  for (const [index, context] of [first, second].entries())
    expect(
      (
        await context.post("/api/auth/register", {
          data: {
            email: `portfolio-${Date.now()}-${index}@example.test`,
            password: "Research-test-123",
            name: "持仓测试",
          },
        })
      ).status(),
    ).toBe(200);
  expect(
    (
      await first.post("/api/portfolio", {
        data: input,
        headers: { Origin: "https://foreign.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await first.post("/api/portfolio", { data: { ...input, date: "2099-01-01" } })).status(),
  ).toBe(400);
  const trade = {
    ...input,
    kind: "buy",
    symbol: "sh600519",
    amount: 0,
    quantity: 100,
    price: 10,
    fee: 5,
  };
  expect((await first.post("/api/portfolio", { data: trade })).status()).toBe(400);
  expect((await first.post("/api/portfolio", { data: input })).status()).toBe(200);
  expect(
    (await first.post("/api/portfolio", { data: { ...trade, symbol: "sh000001" } })).status(),
  ).toBe(400);
  expect((await first.post("/api/portfolio", { data: trade })).status()).toBe(200);
  const response = await first.get("/api/portfolio");
  expect(response.headers()["cache-control"]).toBe("no-store");
  const result: PortfolioResult = await response.json();
  expect(result.cash).toBe(8995);
  expect(result.cost).toBe(1005);
  expect((await second.get("/api/portfolio").then((r) => r.json())).transactions).toEqual([]);
  const deposit = result.transactions[0];
  expect((await second.delete("/api/portfolio", { data: { id: deposit.id } })).status()).toBe(404);
  expect((await first.delete("/api/portfolio", { data: { id: deposit.id } })).status()).toBe(400);
  expect(
    (
      await first.patch("/api/portfolio", {
        data: { id: deposit.id, record: { ...input, amount: 10 } },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await first.post("/api/portfolio", { data: { ...trade, kind: "sell", quantity: 101 } })
    ).status(),
  ).toBe(400);
  const unchanged: PortfolioResult = await first.get("/api/portfolio").then((r) => r.json());
  expect(unchanged.transactions).toHaveLength(2);
  expect(unchanged.transactions[0].amount).toBe(10000);
  expect(
    (
      await first.post("/api/portfolio", {
        data: { ...trade, kind: "sell", quantity: 100, price: 12, fee: 5 },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await first.post("/api/portfolio", {
        data: { ...input, kind: "dividend", symbol: "sh600519", amount: 20 },
      })
    ).status(),
  ).toBe(200);
  const closed: PortfolioResult = await first.get("/api/portfolio").then((r) => r.json());
  expect(closed.cash).toBe(10210);
  expect(closed.realized).toBe(210);
  expect(closed.totalProfit).toBe(210);
  await first.dispose();
  await second.dispose();
});

/** 真浏览器新增、编辑、确认删除，并检查手机双主题布局与表单状态。 */
test("持仓表单完整操作与移动端双主题布局", async ({ page, baseURL }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") console.log("Portfolio browser console:", entry.text());
  });
  await page.goto("/register");
  await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `portfolio-ui-${Date.now()}@example.test`,
      password: "Research-test-123",
      name: "持仓界面测试",
    },
  });
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "持仓与组合", exact: true })).toBeVisible();
  await expect(page.getByText("暂无记录，点击新增记录登记入金")).toBeVisible();
  await page.getByRole("button", { name: /新增记录/ }).click();
  await expect(page.getByLabel("发生日期", { exact: true })).toHaveValue(portfolioToday());
  await page.getByRole("spinbutton", { name: "现金金额", exact: true }).fill("10000");
  await page.getByRole("textbox", { name: "账本备注", exact: true }).fill("第一笔入金");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(
    page.locator(".portfolio-records").getByText("第一笔入金", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /编\s*辑/ }).click();
  await page.getByRole("spinbutton", { name: "现金金额", exact: true }).fill("12000");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(page.locator(".portfolio-metric").filter({ hasText: "现金余额" })).toContainText(
    "12,000.00",
  );
  await page.getByRole("button", { name: /删\s*除/ }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText("暂无记录，点击新增记录登记入金")).toBeVisible();
  await page.request.post("/api/portfolio", { headers: { Origin: baseURL! }, data: input });
  await page.request.post("/api/portfolio", {
    headers: { Origin: baseURL! },
    data: {
      ...input,
      kind: "buy",
      symbol: "sh600519",
      amount: 0,
      quantity: 100,
      price: 10,
      fee: 5,
    },
  });
  await page.reload();
  await expect(page.locator(".portfolio-holdings .ant-table-row")).toHaveCount(1);
  for (const mode of ["light", "dark"]) {
    await page.evaluate((mode) => localStorage.setItem("guanlan-theme", mode), mode);
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 1050 });
    await expect(page.locator(".portfolio-metric")).toHaveCount(8);
    await expect(page.locator(".portfolio-concentration canvas")).toBeVisible();
    await page.screenshot({
      path: `artifacts/phase2-qa/portfolio-desktop-${mode}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/phase2-qa/portfolio-mobile-${mode}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: /新增记录/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("spinbutton", { name: "现金金额", exact: true }).fill("123");
    await page.getByRole("textbox", { name: "账本备注", exact: true }).fill("草稿不会被刷新覆盖");
    await page.request.get("/api/portfolio");
    await expect(page.getByRole("spinbutton", { name: "现金金额", exact: true })).toHaveValue(
      "123.00",
    );
    await page.screenshot({
      path: `artifacts/phase2-qa/portfolio-form-mobile-${mode}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: /取\s*消/ }).click();
  }
  // 浏览器响应夹具只验证上游缺价布局，不向真实账号或市场写模拟行情。
  const baseline: PortfolioResult = await page.request
    .get("/api/portfolio")
    .then((response) => response.json());
  const missing = valuePortfolio(baseline.transactions, []);
  await page.route("**/api/portfolio", (route) => route.fulfill({ json: missing }));
  for (const mode of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("guanlan-theme", value), mode);
    await page.reload();
    await expect(page.locator(".portfolio-warning")).toBeVisible();
    await expect(page.locator(".portfolio-metric").filter({ hasText: "总资产" })).toContainText(
      "—",
    );
    await expect(page.locator(".portfolio-concentration canvas")).toHaveCount(0);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      const info = await page.locator("#main-content > .ant-alert").first().boundingBox();
      const warning = await page.locator(".portfolio-warning").boundingBox();
      expect(info).not.toBeNull();
      expect(warning).not.toBeNull();
      expect(warning!.y - info!.y - info!.height).toBeCloseTo(24, 0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/phase2-qa/portfolio-missing-${width}-${mode}.png`,
        fullPage: true,
      });
    }
  }
  expect(browserErrors).toEqual([]);
});

/** 详情传入证券后，手机可登记买入、送转股和税后分红，错误操作保留草稿。 */
test("手机股票预填、买入、送转与分红，非法现金操作保留表单", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `portfolio-trade-ui-${Date.now()}@example.test`,
          password: "Research-test-123",
          name: "交易表单测试",
        },
      })
    ).status(),
  ).toBe(200);
  await page.request.post("/api/portfolio", { headers: { Origin: baseURL! }, data: input });
  await page.goto("/portfolio?symbol=sh600519");
  await page.getByRole("button", { name: /新增记录/ }).click();
  await expect(page.getByLabel("股票代码", { exact: true })).toHaveValue("sh600519");
  await page.getByRole("spinbutton", { name: "股数", exact: true }).fill("100");
  await page.getByRole("spinbutton", { name: "成交单价", exact: true }).fill("10");
  await page.getByRole("spinbutton", { name: "交易费用", exact: true }).fill("5");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".portfolio-metric").filter({ hasText: "现金余额" })).toContainText(
    "8,995.00",
  );
  for (const label of ["送转股", "现金分红"]) {
    await page.getByRole("button", { name: /新增记录/ }).click();
    await page.getByRole("combobox", { name: "记录类型", exact: true }).click();
    await page.locator(".ant-select-item-option-content").getByText(label, { exact: true }).click();
    if (label === "送转股")
      await page.getByRole("spinbutton", { name: "股数", exact: true }).fill("100");
    else await page.getByRole("spinbutton", { name: "现金金额", exact: true }).fill("50");
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  const result: PortfolioResult = await page.request
    .get("/api/portfolio")
    .then((response) => response.json());
  expect(result.holdings[0].quantity).toBe(200);
  expect(result.cost).toBe(1005);
  expect(result.realized).toBe(50);
  await page.getByRole("button", { name: /新增记录/ }).click();
  await page.getByRole("combobox", { name: "记录类型", exact: true }).click();
  await page.locator(".ant-select-item-option-content").getByText("出金", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "现金金额", exact: true }).fill("999999");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(page.getByText(/现金余额不足/)).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "现金金额", exact: true })).toHaveValue(
    "999999.00",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

/** 模拟另一标签页更换共享会话，焦点校验必须卸载前一账号的编辑弹窗与草稿。 */
test("会话切换与退出后持仓旧弹窗和草稿清除", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `portfolio-session-a-${Date.now()}@example.test`,
          password: "Research-test-123",
          name: "旧持仓账号",
        },
      })
    ).status(),
  ).toBe(200);
  await page.request.post("/api/portfolio", {
    headers: { Origin: baseURL! },
    data: { ...input, note: "旧账号私人入金" },
  });
  await page.goto("/portfolio");
  await expect(
    page.locator(".portfolio-records").getByText("旧账号私人入金", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /编\s*辑/ }).click();
  await page.getByRole("textbox", { name: "账本备注", exact: true }).fill("不应跨账号保留的草稿");
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `portfolio-session-b-${Date.now()}@example.test`,
          password: "Research-test-123",
          name: "新持仓账号",
        },
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return page.getByRole("button", { name: "账号菜单", exact: true }).textContent();
      },
      { timeout: 15000, intervals: [1000] },
    )
    .toContain("新持仓账号");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("旧账号私人入金", { exact: true })).toHaveCount(0);
  await expect(page.getByText("暂无记录，点击新增记录登记入金", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /新增记录/ }).click();
  await expect(page.getByRole("textbox", { name: "账本备注", exact: true })).toHaveValue("");
  await expect(page.getByRole("spinbutton", { name: "现金金额", exact: true })).toHaveValue("0.00");
  expect(
    (
      await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return page
          .locator("#main-content")
          .getByRole("link", { name: "登录账号", exact: true })
          .count();
      },
      { timeout: 15000, intervals: [1000] },
    )
    .toBe(1);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".portfolio-records")).toHaveCount(0);
  expect((await page.request.get("/api/portfolio")).status()).toBe(401);
  expect(errors).toEqual([]);
});

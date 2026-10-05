import { test, expect } from "@playwright/test";

/** API 账号测试用同源 Origin，账号隔离通过独立 Cookie 容器验证。 */
test("账号注册、登录、退出、会话属性、CSRF 与自选股隔离", async ({ playwright, baseURL }) => {
  const origin = baseURL!;
  const first = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const second = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const email = `e2e-${Date.now()}@example.test`,
    password = "test-password-9284";
  expect((await first.get("/api/watchlist")).status()).toBe(401);
  expect((await first.post("/api/auth/register", { data: null })).status()).toBe(400);
  expect(
    (await first.post("/api/auth/register", { headers: { Origin: "null" }, data: {} })).status(),
  ).toBe(403);
  const registered = await first.post("/api/auth/register", {
    data: { email, password, name: "测试用户甲" },
  });
  expect(registered.status()).toBe(200);
  const cookie = registered.headers()["set-cookie"];
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(await registered.json()).not.toHaveProperty("password_hash");
  expect((await first.post("/api/watchlist", { data: { symbol: "sh600519" } })).status()).toBe(200);
  expect((await first.get("/api/watchlist").then((r) => r.json())).symbols).toEqual(["sh600519"]);
  expect(
    (
      await second.post("/api/auth/register", {
        data: { email: `second-${email}`, password, name: "测试用户乙" },
      })
    ).status(),
  ).toBe(200);
  expect((await second.get("/api/watchlist").then((r) => r.json())).symbols).toEqual([]);
  expect(
    (
      await second.delete("/api/watchlist", { data: { symbol: "sh600519", userId: "ignored" } })
    ).status(),
  ).toBe(200);
  expect((await first.get("/api/watchlist").then((r) => r.json())).symbols).toEqual(["sh600519"]);
  expect(
    (
      await first.post("/api/watchlist", {
        headers: { Origin: "https://foreign.example" },
        data: { symbol: "sz000001" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await first.post("/api/watchlist", { data: { symbol: "https://example.com" } })).status(),
  ).toBe(400);
  expect(
    (
      await first.post("/api/auth/register", { data: { email, password, name: "重复账号" } })
    ).status(),
  ).toBe(409);
  await first.post("/api/auth/logout");
  expect((await first.get("/api/watchlist")).status()).toBe(401);
  expect(
    (await first.post("/api/auth/login", { data: { email, password: "wrong-password" } })).status(),
  ).toBe(401);
  expect((await first.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  expect((await first.get("/api/watchlist").then((r) => r.json())).symbols).toEqual(["sh600519"]);
  await first.delete("/api/watchlist", { data: { symbol: "sh600519" } });
  expect((await first.get("/api/watchlist").then((r) => r.json())).symbols).toEqual([]);
  await first.post("/api/auth/logout");
  await second.post("/api/auth/logout");
  await first.dispose();
  await second.dispose();
});

test("搜索、行情、K线、资金和财务页面使用真实接口", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "市场总览" })).toBeVisible();
  await expect(page.locator(".index-value").first()).not.toHaveText("—");
  await page.getByRole("combobox", { name: "搜索股票" }).fill("600519");
  await page.getByRole("option", { name: /贵州茅台/ }).click();
  await expect(page).toHaveURL(/\/stock\/sh600519/);
  await expect(page.getByRole("heading", { name: "贵州茅台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "五档盘口" })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.locator(".chart-controls").getByText("日 K", { exact: true }).click();
  await expect(page.locator(".chart-panel").getByText("未复权价格 · 均线 · 成交量")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("tab", { name: "资金流向" }).click();
  await expect(page.getByText("今日资金净流入", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "财务报表" }).click();
  await expect(page.getByText("报告期对比", { exact: true })).toBeVisible();
  await page.getByText("资产负债表", { exact: true }).click();
  await expect(page.getByText("货币资金", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("亮暗主题持久化，375px 页面不产生横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({ path: "test-results/overview-light.png", fullPage: true });
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({ path: "test-results/overview-dark.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "市场总览" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/overview-mobile-dark.png", fullPage: true });
  await page.getByRole("button", { name: "切换亮色主题" }).click();
  await page.goto("/stock/sh600519");
  await expect(page.getByRole("heading", { name: "贵州茅台" })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/stock-mobile-light.png", fullPage: true });
});

test("未登录自选页面受保护，界面注册后可以收藏和移除股票", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("link", { name: "创建账号" }).click();
  await page.getByLabel("昵称", { exact: true }).fill("界面测试");
  await page.getByLabel("邮箱", { exact: true }).fill(`ui-${Date.now()}@example.test`);
  await page.getByLabel("密码", { exact: true }).fill("test-password-9284");
  await page.getByRole("button", { name: /创建账号/ }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByRole("heading", { name: "我的自选" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "我的自选" })).toBeVisible();
  await page.goto("/stock/sh600519");
  await expect(page.getByRole("heading", { name: "贵州茅台" })).toBeVisible();
  await page.getByRole("button", { name: "加入自选 sh600519" }).click();
  await expect(page.getByRole("button", { name: "移出自选 sh600519" })).toBeVisible();
  await page.goto("/watchlist");
  await expect(
    page.locator(".ant-table-tbody").getByText("贵州茅台", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "移出自选 sh600519" }).click();
  await expect(page.getByText("自选列表还是空的，搜索你关注的第一只股票吧")).toBeVisible();
  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByText("退出登录", { exact: true }).click();
  await expect(page.getByRole("button", { name: "登录 / 注册" })).toBeVisible();
});

/** 同一邮箱同时提交时，数据库唯一约束仍返回业务冲突，而不是服务器错误。 */
test("并发注册同一邮箱只有一个账号创建成功", async ({ playwright, baseURL }) => {
  const origin = baseURL!;
  const a = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const b = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const data = {
    email: `race-${Date.now()}@example.test`,
    password: "test-password-9284",
    name: "并发测试",
  };
  const responses = await Promise.all([
    a.post("/api/auth/register", { data }),
    b.post("/api/auth/register", { data }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  await a.dispose();
  await b.dispose();
});

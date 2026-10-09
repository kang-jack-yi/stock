import { test, expect } from "@playwright/test";

/** 独立会话验证方案写入、隔离、白名单和限额，不依赖上游行情状态。 */
test("选股方案 CRUD、账号隔离、来源校验和二十个限额", async ({ playwright, baseURL }) => {
  const first = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const second = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  expect((await first.get("/api/screeners")).status()).toBe(401);
  for (const [context, name] of [
    [first, "甲"],
    [second, "乙"],
  ] as const) {
    expect(
      (
        await context.post("/api/auth/register", {
          data: {
            email: `saved-${name === "甲" ? "first" : "second"}-${Date.now()}@example.test`,
            password: "test-password-9284",
            name: `方案用户${name}`,
          },
        })
      ).status(),
    ).toBe(200);
  }
  const filters = {
    market: "sh",
    minCap: 100000000000,
    maxPe: 20,
    profitable: true,
    sort: "pe",
    order: "asc",
  };
  const created = await first.post("/api/screeners", { data: { name: "价值观察", filters } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const saved = (await first.get("/api/screeners").then((response) => response.json())).screeners;
  expect(saved).toHaveLength(1);
  expect(saved[0].filters).toMatchObject(filters);
  expect(saved[0].filters).not.toHaveProperty("page");
  expect(
    (await second.get("/api/screeners").then((response) => response.json())).screeners,
  ).toEqual([]);
  expect((await second.patch("/api/screeners", { data: { id, name: "不可更改" } })).status()).toBe(
    404,
  );
  expect((await second.delete("/api/screeners", { data: { id } })).status()).toBe(404);
  expect((await first.patch("/api/screeners", { data: { id, name: "新版观察" } })).status()).toBe(
    200,
  );
  expect(
    (
      await first.patch("/api/screeners", { data: { id, filters: { market: "cyb", minPrice: 5 } } })
    ).status(),
  ).toBe(200);
  const updated = (await first.get("/api/screeners").then((response) => response.json()))
    .screeners[0];
  expect(updated.name).toBe("新版观察");
  expect(updated.filters.market).toBe("cyb");
  expect(updated.filters).not.toHaveProperty("maxPe");
  expect(
    (
      await first.post("/api/screeners", {
        headers: { Origin: "https://foreign.example" },
        data: { name: "CSRF", filters },
      })
    ).status(),
  ).toBe(403);
  for (const invalid of [
    { name: "", filters },
    { name: "x".repeat(41), filters },
    { name: "非法", filters: { page: 2 } },
    { name: "非法", filters: { sort: "__proto__" } },
    { name: "非法", filters: { minPrice: 20, maxPrice: 10 } },
    { name: "非法", filters: { minCap: "1000" } },
    { name: "非法", filters: { url: "https://example.test" } },
    { name: "非法", filters: { profitable: "1" } },
    { name: "非法", filters, userId: "fake" },
  ])
    expect((await first.post("/api/screeners", { data: invalid })).status()).toBe(400);
  for (let index = 1; index < 20; index++)
    expect(
      (
        await first.post("/api/screeners", { data: { name: `方案${index}`, filters: {} } })
      ).status(),
    ).toBe(201);
  expect(
    (await first.post("/api/screeners", { data: { name: "超额", filters: {} } })).status(),
  ).toBe(400);
  expect((await first.delete("/api/screeners", { data: { id } })).status()).toBe(200);
  expect(
    (await first.get("/api/screeners").then((response) => response.json())).screeners,
  ).toHaveLength(19);
  await first.dispose();
  await second.dispose();
});

/** 保存来源必须是已应用 URL；覆盖、改名、恢复、批量添加和删除通过真实交互验证。 */
test("保存与恢复选股方案、更新条件和本页批量自选", async ({ page, baseURL }) => {
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `saved-ui-${Date.now()}@example.test`,
          password: "test-password-9284",
          name: "方案界面用户",
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/screener?query=600519&minCap=100000000000&sort=price&order=asc&page=2");
  await page.getByRole("textbox", { name: "选股名称或代码" }).fill("000001");
  await page.getByRole("button", { name: "保存当前条件" }).click();
  await page.getByRole("textbox", { name: "选股方案名称" }).fill("观察茅台");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^保\s*存$/ })
    .click();
  const row = page.locator(".saved-screener-row").filter({ hasText: "观察茅台" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^运\s*行$/ }).click();
  await expect(page).toHaveURL(/query=600519/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(page.getByRole("textbox", { name: "选股名称或代码" })).toHaveValue("600519");
  await expect(
    page.getByRole("spinbutton", { name: "总市值（亿元）下限", exact: true }),
  ).toHaveValue("1000");
  await expect(page.locator(".screener-results .ant-table-tbody tr.ant-table-row")).toHaveCount(1);
  expect(
    (await page.request.get("/api/watchlist").then((response) => response.json())).symbols,
  ).toEqual([]);
  await page.getByRole("button", { name: "本页批量加入自选" }).click();
  await page.getByRole("button", { name: "加入自选", exact: true }).click();
  await expect(page.getByText("已添加 1 只股票到自选", { exact: true })).toBeVisible();
  expect(
    (await page.request.get("/api/watchlist").then((response) => response.json())).symbols,
  ).toEqual(["sh600519"]);
  await row.getByRole("button", { name: /^改\s*名$/ }).click();
  await page.getByRole("textbox", { name: "选股方案名称" }).fill("价值观察");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^保\s*存$/ })
    .click();
  await expect(page.locator(".saved-screener-row").filter({ hasText: "价值观察" })).toBeVisible();
  await page.getByRole("button", { name: "成交活跃", exact: true }).click();
  await expect(page).toHaveURL(/minTurnover=5/);
  await page
    .locator(".saved-screener-row")
    .getByRole("button", { name: "更新条件", exact: true })
    .click();
  await page.getByRole("button", { name: /^更\s*新$/ }).click();
  await expect(page.getByText("已使用当前应用条件更新方案", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /重置/ }).click();
  await page
    .locator(".saved-screener-row")
    .getByRole("button", { name: /^运\s*行$/ })
    .click();
  await expect(page).toHaveURL(/minTurnover=5/);
  await expect(page).toHaveURL(/minAmount=100000000/);
  await page.reload();
  await expect(page.locator(".saved-screener-row")).toContainText("价值观察");
  await page
    .locator(".saved-screener-row")
    .getByRole("button", { name: /^删\s*除$/ })
    .click();
  await page
    .locator(".ant-popover")
    .getByRole("button", { name: /^删\s*除$/ })
    .click();
  await expect(page.getByText("还没有保存的选股方案", { exact: true })).toBeVisible();
});

/** 长名称与按钮在 375px 不撑开页面，账号方案遵循根主题。 */
test("保存方案面板适配手机亮暗主题", async ({ page, baseURL }) => {
  await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `saved-mobile-${Date.now()}@example.test`,
      password: "test-password-9284",
      name: "方案布局用户",
    },
  });
  await page.request.post("/api/screeners", {
    headers: { Origin: baseURL! },
    data: { name: "观察方案".repeat(10), filters: {} },
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/screener");
  await expect(page.locator(".saved-screener-row")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/saved-screeners-mobile-light.png", fullPage: true });
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/saved-screeners-mobile-dark.png", fullPage: true });
});

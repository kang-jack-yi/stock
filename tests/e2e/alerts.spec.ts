import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AlertsResult } from "../../src/lib/alert-types";

/** 提醒 API 必须按会话隔离，并在更新、删除时拒绝其他账号编号。 */
test("提醒创建、暂停、重新启用、删除、CSRF和账号隔离", async ({ playwright, baseURL }) => {
  const first = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const second = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  expect((await first.get("/api/alerts")).status()).toBe(401);
  for (const [index, context] of [first, second].entries()) {
    expect(
      (
        await context.post("/api/auth/register", {
          data: {
            email: `alerts-${Date.now()}-${index}@example.test`,
            password: "Research-test-123",
            name: "提醒测试",
          },
        })
      ).status(),
    ).toBe(200);
  }
  const input = { symbol: "sh600519", metric: "price", direction: "above", threshold: 1300 };
  expect(
    (
      await first.post("/api/alerts", {
        data: input,
        headers: { Origin: "https://foreign.example" },
      })
    ).status(),
  ).toBe(403);
  expect((await first.post("/api/alerts", { data: { ...input, threshold: 0 } })).status()).toBe(
    400,
  );
  expect((await first.post("/api/alerts", { data: { ...input, userId: "other" } })).status()).toBe(
    400,
  );
  expect((await first.post("/api/alerts", { data: input })).status()).toBe(200);
  const result = await first.get("/api/alerts");
  expect(result.headers()["cache-control"]).toBe("no-store");
  const rule = (await result.json()).rules[0];
  expect(rule.previousValue).toBeNull();
  expect((await second.get("/api/alerts").then((r) => r.json())).rules).toEqual([]);
  expect(
    (
      await second.patch("/api/alerts", {
        data: { action: "enabled", id: rule.id, enabled: false },
      })
    ).status(),
  ).toBe(404);
  expect((await second.delete("/api/alerts", { data: { id: rule.id } })).status()).toBe(404);
  expect(
    (
      await first.patch("/api/alerts", { data: { action: "enabled", id: rule.id, enabled: false } })
    ).status(),
  ).toBe(200);
  expect((await first.get("/api/alerts").then((r) => r.json())).rules[0].enabled).toBe(false);
  expect(
    (
      await first.patch("/api/alerts", { data: { action: "enabled", id: rule.id, enabled: true } })
    ).status(),
  ).toBe(200);
  expect((await first.get("/api/alerts").then((r) => r.json())).rules[0].previousAt).toBeNull();
  expect((await first.delete("/api/alerts", { data: { id: rule.id } })).status()).toBe(200);
  expect((await first.get("/api/alerts").then((r) => r.json())).rules).toEqual([]);
  await first.dispose();
  await second.dispose();
});

/** 上限不能被并发新增绕过；格式错误不写入数据库。 */
test("提醒50条上限和指标边界", async ({ playwright, baseURL }) => {
  const context = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  await context.post("/api/auth/register", {
    data: {
      email: `alerts-limit-${Date.now()}@example.test`,
      password: "Research-test-123",
      name: "上限测试",
    },
  });
  const input = { symbol: "sh600519", metric: "changePercent", direction: "below", threshold: -3 };
  expect(
    (await context.post("/api/alerts", { data: { ...input, threshold: -101 } })).status(),
  ).toBe(400);
  expect(
    (
      await context.post("/api/alerts", { data: { ...input, symbol: "https://example.com" } })
    ).status(),
  ).toBe(400);
  for (let i = 0; i < 49; i++)
    expect((await context.post("/api/alerts", { data: input })).status()).toBe(200);
  const pair = await Promise.all([
    context.post("/api/alerts", { data: input }),
    context.post("/api/alerts", { data: input }),
  ]);
  expect(pair.map((r) => r.status()).sort()).toEqual([200, 400]);
  expect((await context.get("/api/alerts").then((r) => r.json())).rules).toHaveLength(50);
  await context.dispose();
});

/** 用明确的历史记录夹具验证已读交互，不依赖测试时市场是否开盘。 */
test("提醒历史展示实际值和行情时间，支持单条及全部已读", async ({ page, baseURL }) => {
  await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `alerts-history-${Date.now()}@example.test`,
      password: "Research-test-123",
      name: "历史测试",
    },
  });
  const fixture: AlertsResult = {
    rules: [],
    workerAt: null,
    workerRunning: false,
    workerMessage: "测试夹具",
    events: [0, 1].map((index) => ({
      id: randomUUID(),
      ruleId: null,
      symbol: "sh600519",
      name: "提醒历史测试夹具",
      metric: "price",
      direction: "above",
      threshold: 100,
      value: 101 + index,
      quoteAt: "2026-10-09T02:00:00.000Z",
      read: false,
    })),
  };
  const actions: object[] = [];
  await page.route("**/api/alerts", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const input = request.postDataJSON();
      actions.push(input);
      fixture.events.forEach((event) => {
        if (!input.id || input.id === event.id) event.read = true;
      });
      await route.fulfill({ json: { ok: true } });
    } else await route.fulfill({ json: fixture });
  });
  await page.goto("/alerts");
  await expect(page.getByText("未读", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/实际值 101.00 元\/点/)).toBeVisible();
  await expect(page.locator(".alerts-history .small-muted").first()).toContainText("10:00:00");
  await page.getByRole("button", { name: "标为已读", exact: true }).first().click();
  await expect(page.getByText("未读", { exact: true })).toHaveCount(1);
  expect(actions[0]).toEqual({ action: "read", id: fixture.events[0].id });
  await page.getByRole("button", { name: "全部标为已读", exact: true }).click();
  await expect(page.getByText("未读", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全部标为已读", exact: true })).toBeDisabled();
  expect(actions[1]).toEqual({ action: "read" });
});

import { test, expect } from "@playwright/test";
import type { ReviewsResult } from "../../src/lib/review-types";
import type { MarketStock } from "../../src/lib/types";
import { marketBreadth } from "../../src/lib/screener";
import type { User } from "../../src/lib/types";

/** 只模拟浏览器会话和复盘响应，验证跨标签会话重验证后不会保留旧账号日期。 */
test("会话账号切换清除复盘日期和旧展示状态，退出后显示登录入口", async ({ page, baseURL }) => {
  await page.goto("/login");
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `review-switch-${Date.now()}@example.test`,
      password: "Research-test-123",
      name: "复盘切换测试",
    },
  });
  expect(response.status()).toBe(200);
  const first = (await response.json()).user as User;
  let active: User | null = first;
  const requestedDates: string[] = [];
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: active } }));
  await page.route("**/api/reviews*", (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    if (active?.id !== first.id) requestedDates.push(date ?? "default");
    const dates = active?.id === first.id ? ["2026-09-30", "2026-09-29"] : ["2026-09-28"];
    const selectedDate = date ?? dates[0];
    const fetchedAt = `${selectedDate}T07:10:00.000Z`;
    const fixture: ReviewsResult = {
      today: "2026-10-09",
      canCapture: false,
      captureLabel: "会话切换测试夹具",
      dates,
      selectedDate,
      previousDate: null,
      review: {
        date: selectedDate,
        savedAt: Date.parse(fetchedAt),
        watchlist: [],
        unavailable: [],
        screeners: [],
        alerts: [],
      },
      market: {
        date: selectedDate,
        fetchedAt,
        startedAt: fetchedAt,
        marketFetchedAt: fetchedAt,
        sectorFetchedAt: [fetchedAt, fetchedAt],
        sourceTotal: 0,
        verifiedTotal: 0,
        excludedTotal: 0,
        breadth: marketBreadth([], fetchedAt),
      },
      screeners: [],
      sectors: [],
      workerAt: null,
      workerRunning: false,
      workerMessage: "测试夹具",
    };
    return route.fulfill({ json: fixture });
  });
  await page.goto("/review");
  await page.getByRole("combobox", { name: "复盘日期" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("2026-09-29", { exact: true })
    .click();
  await expect(page.locator(".review-history .ant-select")).toContainText("2026-09-29");
  active = { ...first, id: "another-account-fixture", name: "另一个测试账号" };
  // SWR 默认焦点重验证有五秒节流，模拟用户从另一标签切回已打开页面。
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".review-history .ant-select")).toContainText("2026-09-28");
  expect(requestedDates).toContain("default");
  expect(requestedDates).not.toContain("2026-09-29");
  await expect(page.locator(".review-summary")).not.toContainText("2026-09-29");
  active = null;
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.locator(".review-history").getByRole("link", { name: "登录账号", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "复盘日期" })).toHaveCount(0);
});

/** 会话账号独立读取真实空状态，不通过测试写入任何公共市场快照。 */
test("复盘API认证、账号隔离、日期校验与跨站写操作防护", async ({ playwright, baseURL }) => {
  const first = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const second = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  try {
    expect((await first.get("/api/reviews")).status()).toBe(401);
    for (const [index, context] of [first, second].entries()) {
      expect(
        (
          await context.post("/api/auth/register", {
            data: {
              email: `review-${Date.now()}-${index}@example.test`,
              password: "Research-test-123",
              name: "复盘测试",
            },
          })
        ).status(),
      ).toBe(200);
      const response = await context.get("/api/reviews");
      expect(response.headers()["cache-control"]).toBe("no-store");
      const result = await response.json();
      expect(result.review).toBeNull();
      expect(result.dates).toEqual([]);
      expect(result.sectors).toEqual([]);
      expect(result.previousDate).toBeNull();
    }
    expect((await first.get("/api/reviews?date=invalid")).status()).toBe(400);
    expect((await first.get("/api/reviews?date=2026-02-30")).status()).toBe(400);
    expect(
      (
        await first.post("/api/reviews", {
          data: {},
          headers: { Origin: "https://foreign.example" },
        })
      ).status(),
    ).toBe(403);
    expect((await first.post("/api/reviews", { data: { date: "2026-09-30" } })).status()).toBe(400);
    expect((await first.post("/api/reviews", { data: { userId: "other" } })).status()).toBe(400);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

/** 明确标识的浏览器响应夹具，只模拟展示，不写入真实收盘数据库。 */
test("复盘有历史时方案分页、日期切换、待核实记录和手机桌面亮暗布局", async ({
  page,
  baseURL,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `review-history-ui-${Date.now()}@example.test`,
          password: "Research-test-123",
          name: "复盘夹具展示测试",
        },
      })
    ).status(),
  ).toBe(200);
  const stocks: MarketStock[] = Array.from({ length: 31 }, (_, index) => ({
    symbol: `sz${String(index + 1).padStart(6, "0")}`,
    name: `布局测试证券${index + 1}`,
    price: 10,
    change: 1,
    changePercent: 11.11,
    volume: 100,
    amount: 10000,
    pe: 10,
    pb: 1,
    marketCap: 1e8,
    floatCap: 1e8,
    turnover: 1,
    time: "15:00:00",
  }));
  const matches = stocks.map(({ symbol, name }) => ({ symbol, name }));
  const screeners = [
    {
      id: "fixture",
      name: "长名称测试方案——完整匹配集合与待核实变化",
      conditionHash: "test-only",
      matches,
      hasBaseline: true,
      baselineLabel: "测试夹具：与相邻可用快照的相同条件比较",
      added: matches.slice(0, 2),
      removed: matches.slice(2, 3),
      unverifiable: matches.slice(3, 4),
    },
  ];
  const fixture: ReviewsResult = {
    today: "2026-10-09",
    canCapture: false,
    captureLabel: "测试夹具：等待收盘",
    dates: ["2026-10-09", "2026-10-08"],
    selectedDate: "2026-10-09",
    previousDate: "2026-10-08",
    review: {
      date: "2026-10-09",
      savedAt: Date.parse("2026-10-09T15:10:00+08:00"),
      watchlist: stocks,
      unavailable: [
        { symbol: "sh600519", name: "无法核实的测试证券", reason: "行情日期未知，未参与当日统计" },
      ],
      screeners,
      alerts: [],
    },
    market: {
      date: "2026-10-09",
      fetchedAt: "2026-10-09T07:10:00.000Z",
      startedAt: "2026-10-09T07:06:00.000Z",
      marketFetchedAt: "2026-10-09T07:07:00.000Z",
      sectorFetchedAt: ["2026-10-09T07:08:00.000Z", "2026-10-09T07:09:00.000Z"],
      sourceTotal: 32,
      verifiedTotal: 31,
      excludedTotal: 1,
      breadth: marketBreadth(stocks, "2026-10-09T07:06:00.000Z"),
    },
    screeners,
    sectors: [],
    workerAt: null,
    workerRunning: false,
    workerMessage: "测试夹具",
  };
  await page.route("**/api/reviews*", (route) => {
    const date = new URL(route.request().url()).searchParams.get("date") || fixture.today;
    return route.fulfill({
      json: {
        ...fixture,
        selectedDate: date,
        previousDate: date === fixture.today ? "2026-10-08" : null,
        review: { ...fixture.review, date },
      },
    });
  });
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "自选收盘表现", exact: true })).toBeVisible();
  await page.locator(".review-screeners .ant-collapse-header").click();
  await expect(page.getByRole("tab", { name: "当日全部 31" })).toBeVisible();
  await expect(
    page.locator(".review-screeners .ant-table-tbody tr.ant-table-row:visible"),
  ).toHaveCount(10);
  await page.locator(".review-screeners").getByTitle("2", { exact: true }).click();
  await expect(
    page.locator(".review-screeners .ant-table-tbody tr.ant-table-row:visible").first(),
  ).toContainText("布局测试证券11");
  await page.getByRole("tab", { name: "待核实 1" }).click();
  await expect(
    page.locator(".review-screeners .ant-table-tbody tr.ant-table-row:visible"),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: "新增 2" }).click();
  await expect(
    page.locator(".review-screeners .ant-table-tbody tr.ant-table-row:visible"),
  ).toHaveCount(2);
  await page.getByRole("combobox", { name: "复盘日期" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("2026-10-08", { exact: true })
    .click();
  await expect(page.locator(".review-comparison")).toContainText("暂无基线");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("guanlan-theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "自选收盘表现", exact: true })).toBeVisible();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      const gaps = await page.evaluate(() => {
        const panels = [
          ...document.querySelectorAll(
            ".review-history, .review-watchlist, .review-screeners, .review-sectors, .review-alerts",
          ),
        ];
        return panels.map((panel, index) => {
          const previous = index === 0 ? panel.previousElementSibling : panels[index - 1];
          return previous
            ? panel.getBoundingClientRect().top - previous.getBoundingClientRect().bottom
            : 0;
        });
      });
      expect(gaps.every((gap) => gap >= 23 && gap <= 25)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`review-history-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});

/** 真实浏览器验证没有历史时的亮暗主题、手机排版、可见状态与操作。 */
test("复盘空状态亮暗主题与375px手机布局，日期选择与保存按钮语义正常", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/review");
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `review-ui-${Date.now()}@example.test`,
          password: "Research-test-123",
          name: "复盘布局测试",
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "每日复盘", exact: true })).toBeVisible();
  await expect(page.getByText("暂无收盘快照，从今天开始积累", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "复盘日期" })).toBeDisabled();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      localStorage.setItem("guanlan-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByText("暂无收盘快照，从今天开始积累", { exact: true })).toBeVisible();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await expect(page.getByRole("button", { name: "保存当日收盘" })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

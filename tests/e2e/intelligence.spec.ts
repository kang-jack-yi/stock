import { test, expect, type Page } from "@playwright/test";
import { intelligenceId, pageIntelligence } from "../../src/lib/intelligence-parse";
import type {
  IntelligenceItem,
  IntelligenceQuery,
  IntelligenceResult,
} from "../../src/lib/intelligence-types";
import type { User } from "../../src/lib/types";

/** 创建独立测试账号，通过真实会话保护进入页面；源夹具只存在浏览器拦截层。 */
async function register(page: Page, baseURL: string) {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL },
    data: {
      name: "情报回归账号",
      email: `intelligence-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      password: "Research-test-123",
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user as User;
}

/** 公开标题、原文、安全关联及日期精度测试夹具，永不写入行情数据库。 */
function entries(): IntelligenceItem[] {
  return Array.from({ length: 46 }, (_, index) => ({
    id: intelligenceId("announcement", "sh600519", `e2e-${index}`),
    kind: index < 31 ? "announcement" : index < 38 ? "news" : index < 42 ? "alert" : "signal",
    symbol: "sh600519",
    name: "贵州茅台",
    title: `情报测试${String(index).padStart(2, "0")}：${index === 0 ? "长标题用于验证手机上文字换行，公告披露日期并非实际实施日期。" : "真实数据只由测试夹具模拟"}`,
    occurredAt:
      index >= 42
        ? "2026-10-09"
        : `2026-10-09T${String(23 - Math.floor(index / 3)).padStart(2, "0")}:00:00.000Z`,
    dateOnly: index < 31 || index >= 42,
    url:
      index < 31
        ? "https://static.cninfo.com.cn/finalpage/2026-10-09/123456.PDF"
        : index < 38
          ? "https://finance.sina.com.cn/stock/2026-10-09/doc-fixture.shtml"
          : null,
    association:
      index < 31
        ? "公告证券代码关联；披露日不等于实施日"
        : index < 38
          ? "标题名称匹配（请核对原文）"
          : "本账号测试触发记录",
    read: false,
    saved: false,
  }));
}

/** 拦截当前测试页的有限范围API，模拟已读/收藏后重新分页，不替代真实源验证。 */
async function fixture(
  page: Page,
  items: IntelligenceItem[],
  state: { failing: boolean; accountEmpty?: boolean },
) {
  await page.route("**/api/intelligence?**", async (route) => {
    if (state.failing) return route.fulfill({ status: 503, json: { error: "测试来源暂时不可用" } });
    const params = new URL(route.request().url()).searchParams;
    const query: IntelligenceQuery = {
      symbol: params.get("symbol") || (params.get("state") === "saved" ? "" : "sh600519"),
      kind: (params.get("kind") || "all") as IntelligenceQuery["kind"],
      state: (params.get("state") || "all") as IntelligenceQuery["state"],
      page: Number(params.get("page") || 1),
    };
    const result: IntelligenceResult = {
      query,
      selectedName: state.accountEmpty ? null : "贵州茅台",
      symbols: state.accountEmpty ? [] : ["sh600519", "sz000001"],
      savedSymbols: [...new Set(items.filter((item) => item.saved).map((item) => item.symbol))],
      ...pageIntelligence(state.accountEmpty ? [] : items, query),
      pageSize: 20,
      start: "2026-09-12",
      fetchedAt: "2026-10-11T02:00:00.000Z",
      coverage: [
        { label: "公开公告", count: 31, status: "ok", message: "最近30日完整窗口测试夹具" },
        {
          label: "公开股市资讯",
          count: 7,
          status: "warning",
          message: "部分页面加载失败；已成功检查80条标题，请重新加载",
        },
      ],
    };
    return route.fulfill({ json: result });
  });
  await page.route("**/api/intelligence", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const input = route.request().postDataJSON() as {
      id: string;
      action: "read" | "saved";
      value: boolean;
    };
    const item = items.find((item) => item.id === input.id);
    if (!item) return route.fulfill({ status: 404, json: { error: "记录不存在" } });
    item[input.action] = input.value;
    return route.fulfill({ json: { ok: true } });
  });
}

/** 实际点击列表分页、筛选、已读/未读、收藏/取消收藏，验证查询结果跟随持久状态。 */
test("情报流分页筛选、阅读收藏及原文入口", async ({ page, baseURL }) => {
  await register(page, baseURL!);
  const items = entries();
  await fixture(page, items, { failing: false });
  await page.goto("/intelligence");
  await expect(page.locator(".intelligence-item")).toHaveCount(20);
  await expect(page.locator(".intelligence-pagination")).toContainText("共46条");
  const first = page.locator(".intelligence-item").first();
  await expect(first.getByRole("link", { name: "查看原文" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await first.getByRole("button", { name: /标为已读/ }).click();
  await expect(first.getByRole("button", { name: /标为未读/ })).toBeVisible();
  await first.getByRole("button", { name: /(?<!取消)收藏$/ }).click();
  await expect(first.getByRole("button", { name: /取消收藏/ })).toBeVisible();
  await page.locator(".intelligence-pagination").getByTitle("2", { exact: true }).click();
  await expect(page.locator(".intelligence-pagination .ant-pagination-item-active")).toHaveText(
    "2",
  );
  await expect(page.locator(".intelligence-item")).toHaveCount(20);
  await page.getByRole("combobox", { name: "阅读收藏状态" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("我的收藏", { exact: true })
    .click();
  await expect(page.locator(".intelligence-item")).toHaveCount(1);
  await expect(page.locator(".intelligence-archive")).toContainText("来源移除");
  await page.getByRole("button", { name: /取消收藏/ }).click();
  await expect(page.getByText("当前筛选下没有情报")).toBeVisible();
  await page.getByRole("combobox", { name: "阅读收藏状态" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("仅未读", { exact: true })
    .click();
  await expect(page.locator(".intelligence-pagination")).toContainText("共45条");
  await page.getByRole("combobox", { name: "情报类型" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("技术信号", { exact: true })
    .click();
  await expect(page.locator(".intelligence-item")).toHaveCount(4);
  await expect(page.locator(".intelligence-item").first()).toContainText("2026-10-09（收盘日）");
  await page.getByRole("combobox", { name: "情报股票" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("sz000001", { exact: true })
    .click();
  await expect(page.getByText("当前筛选下没有情报")).toBeVisible();
});

/** 错误可重试，局部故障不阻断列表，检查6种尺寸主题与手机真实操作。 */
test("情报失败恢复、局部来源提示与明暗响应式布局", async ({ page, baseURL }) => {
  await register(page, baseURL!);
  const state = { failing: true };
  await fixture(page, entries(), state);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/intelligence");
  await expect(page.getByText("测试来源暂时不可用")).toBeVisible();
  state.failing = false;
  await page
    .getByRole("button", { name: /重新加载/ })
    .last()
    .click();
  await expect(page.locator(".intelligence-item")).toHaveCount(20);
  await expect(page.getByText(/部分页面加载失败/)).toBeVisible();
  for (const width of [1440, 768, 375])
    for (const mode of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1000 });
      const current = await page.locator("html").getAttribute("data-theme");
      if (current !== mode) await page.getByRole("button", { name: /切换.*主题/ }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.locator(".intelligence-filters .ant-select").first()).toHaveCSS(
        "color",
        mode === "dark" ? "rgb(241, 242, 245)" : "rgb(32, 33, 36)",
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(
        page
          .locator(".intelligence-item")
          .first()
          .getByRole("button", { name: /(?<!取消)收藏$/ }),
      ).toBeVisible();
      await page.screenshot({
        path: `artifacts/phase3-qa/intelligence-${width}-${mode}.png`,
        fullPage: true,
      });
    }
  await page
    .locator(".intelligence-item")
    .first()
    .getByRole("button", { name: /标为已读/ })
    .click();
  await expect(
    page
      .locator(".intelligence-item")
      .first()
      .getByRole("button", { name: /标为未读/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

/** 真实接口验证会话、防跨站、严格字段、请求体限制与不能制造情报条目。 */
test("情报接口认证、账号隔离与状态写入校验", async ({ playwright, baseURL }) => {
  const first = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const second = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  try {
    expect((await first.get("/api/intelligence")).status()).toBe(401);
    for (const [index, context] of [first, second].entries())
      expect(
        (
          await context.post("/api/auth/register", {
            data: {
              email: `intelligence-api-${Date.now()}-${index}@example.test`,
              name: "接口隔离测试",
              password: "Research-test-123",
            },
          })
        ).status(),
      ).toBe(200);
    const result = await first.get("/api/intelligence?state=saved");
    expect(result.status()).toBe(200);
    expect(result.headers()["cache-control"]).toBe("no-store");
    expect((await result.json()).items).toEqual([]);
    expect(
      (await second.get("/api/intelligence?state=saved").then((response) => response.json())).items,
    ).toEqual([]);
    for (const query of [
      "symbol=sh000001",
      "kind=script",
      "page=0",
      "page=2&page=1",
      "userId=another-user",
      "symbol=https://example.test/",
    ])
      expect((await first.get(`/api/intelligence?${query}`)).status()).toBe(400);
    const update = { id: "a".repeat(64), action: "saved", value: true };
    expect(
      (
        await first.patch("/api/intelligence", {
          headers: { Origin: "https://evil.test" },
          data: update,
        })
      ).status(),
    ).toBe(403);
    expect((await first.patch("/api/intelligence", { data: update })).status()).toBe(404);
    expect(
      (
        await first.patch("/api/intelligence", {
          data: { ...update, payload: { url: "javascript:alert(1)" } },
        })
      ).status(),
    ).toBe(400);
    expect(
      (await first.patch("/api/intelligence", { data: { ...update, id: "wrong" } })).status(),
    ).toBe(400);
    expect(
      (await first.patch("/api/intelligence", { data: { ...update, value: "true" } })).status(),
    ).toBe(400);
    expect(
      (
        await first.patch("/api/intelligence", { data: { ...update, extra: "x".repeat(5000) } })
      ).status(),
    ).toBe(413);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

/** 用户跨标签切换后筛选与收藏不沿用旧账号，退出后不保留情报卡片。 */
test("情报账号切换清除旧筛选和列表", async ({ page, baseURL }) => {
  const user = await register(page, baseURL!);
  let active: User | null = user;
  const state = { failing: false, accountEmpty: false };
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: active } }));
  await fixture(page, entries(), state);
  await page.goto("/intelligence");
  await expect(page.locator(".intelligence-item")).toHaveCount(20);
  await page.getByRole("combobox", { name: "情报类型" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("技术信号", { exact: true })
    .click();
  await expect(page.locator(".intelligence-item")).toHaveCount(4);
  active = { ...user, id: "second-account-fixture", name: "第二账号" };
  state.accountEmpty = true;
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".intelligence-item")).toHaveCount(0);
  await expect(page.locator(".intelligence-filters")).toContainText("全部类型");
  active = null;
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("请登录后查看关注情报")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "情报类型" })).toHaveCount(0);
});

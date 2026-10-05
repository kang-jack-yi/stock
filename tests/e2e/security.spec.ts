import { test, expect } from "@playwright/test";

/** 写接口拒绝缺少、伪造及协议不同的 Origin；无有效会话也不能操作收藏。 */
test("写操作来源、请求大小和已撤销会话均受验证", async ({ playwright, baseURL }) => {
  const origin = baseURL!;
  const client = await playwright.request.newContext({ baseURL: origin });
  const credentials = {
    email: `security-${Date.now()}@example.test`,
    password: "test-password-9284",
    name: "安全测试",
  };
  const originVariants: Record<string, string>[] = [
    {},
    { Origin: "null" },
    { Origin: "https://foreign.example" },
    { Origin: origin.replace("http:", "https:") },
  ];
  for (const headers of originVariants) {
    expect((await client.post("/api/auth/register", { headers, data: credentials })).status()).toBe(
      403,
    );
  }
  const headers = { Origin: origin };
  expect(
    (await client.post("/api/watchlist", { headers, data: { symbol: "sh600519" } })).status(),
  ).toBe(401);
  const created = await client.post("/api/auth/register", { headers, data: credentials });
  expect(created.status()).toBe(200);
  const state = await client.storageState();
  const session = state.cookies.find((cookie) => cookie.name === "guanlan_session");
  expect(session?.value).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (
      await client.post("/api/watchlist", {
        headers,
        data: { symbol: "sh600519", oversized: "x".repeat(5000) },
      })
    ).status(),
  ).toBe(413);
  expect((await client.post("/api/watchlist", { headers, data: ["sh600519"] })).status()).toBe(400);
  expect(
    (await client.post("/api/watchlist", { headers, data: { symbol: "sh600519" } })).status(),
  ).toBe(200);
  expect((await client.get("/api/watchlist")).headers()["cache-control"]).toBe("no-store");
  expect((await client.get("/api/auth/me")).headers()["cache-control"]).toBe("no-store");
  expect((await client.post("/api/auth/logout", { headers })).status()).toBe(200);
  const replay = await playwright.request.newContext({ baseURL: origin, storageState: state });
  expect((await replay.get("/api/watchlist")).status()).toBe(401);
  expect((await replay.get("/api/auth/me").then((response) => response.json())).user).toBeNull();
  await client.dispose();
  await replay.dispose();
});

/** 使用真实证券写入至边界，验证并发添加也不会越过账号最多 60 只的限制。 */
test("自选并发写入保持唯一，并严格限制为 60 只", async ({ playwright, baseURL }) => {
  const origin = baseURL!;
  const client = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const created = await client.post("/api/auth/register", {
    data: {
      email: `capacity-${Date.now()}@example.test`,
      password: "test-password-9284",
      name: "容量测试",
    },
  });
  expect(created.status()).toBe(200);
  const pages = await Promise.all(
    [1, 2, 3, 4].map(async (page) => {
      const response = await client.get(`/api/market/list?sort=symbol&page=${page}`);
      expect(response.status()).toBe(200);
      return (await response.json()).data.stocks.map((stock: { symbol: string }) => stock.symbol);
    }),
  );
  const symbols = [...new Set(pages.flat())] as string[];
  expect(symbols.length).toBeGreaterThanOrEqual(62);
  const writes = await Promise.all(
    symbols.slice(0, 59).map((symbol) => client.post("/api/watchlist", { data: { symbol } })),
  );
  expect(writes.every((response) => response.status() === 200)).toBe(true);
  const boundary = await Promise.all(
    symbols.slice(59, 62).map((symbol) => client.post("/api/watchlist", { data: { symbol } })),
  );
  expect(boundary.map((response) => response.status()).sort()).toEqual([200, 400, 400]);
  const duplicate = await Promise.all(
    Array.from({ length: 5 }, () =>
      client.post("/api/watchlist", { data: { symbol: symbols[0] } }),
    ),
  );
  expect(duplicate.every((response) => response.status() === 200)).toBe(true);
  const saved = (await client.get("/api/watchlist").then((response) => response.json())).symbols;
  expect(saved).toHaveLength(60);
  expect(new Set(saved).size).toBe(60);
  await client.post("/api/auth/logout");
  await client.dispose();
});

/** 账户切换必须同时刷新服务端会话和浏览器缓存，界面不能短暂保留前一账号的收藏。 */
test("同一浏览器退出并登录另一账号后，自选界面保持账号隔离", async ({ page, baseURL }) => {
  const origin = baseURL!;
  const password = "test-password-9284";
  const first = { email: `cache-a-${Date.now()}@example.test`, password, name: "缓存用户甲" };
  const second = { email: `cache-b-${Date.now()}@example.test`, password, name: "缓存用户乙" };
  expect(
    (
      await page.request.post("/api/auth/register", { headers: { Origin: origin }, data: first })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/watchlist", {
        headers: { Origin: origin },
        data: { symbol: "sh600519" },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/watchlist");
  await expect(
    page.locator(".ant-table-tbody").getByText("贵州茅台", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByText("退出登录", { exact: true }).click();
  await expect(page.getByRole("button", { name: "登录 / 注册" })).toBeVisible();
  expect(
    (
      await page.request.post("/api/auth/register", { headers: { Origin: origin }, data: second })
    ).status(),
  ).toBe(200);
  await page.goto("/login");
  // 已登录账号访问登录页会直接跳转自选，证明 Server Component 重新读取了会话。
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByText("自选列表还是空的，搜索你关注的第一只股票吧")).toBeVisible();
  await expect(page.getByText("贵州茅台", { exact: true })).toHaveCount(0);
});

/** 非法枚举、页码和证券 URL 只返回参数错误，避免用户输入成为任意上游请求。 */
test("行情参数无效时返回业务错误，不执行任意 URL 或脚本", async ({ request }) => {
  for (const url of [
    "/api/market/quotes?symbols=https://foreign.example",
    "/api/market/quotes?symbols=sh600519;alert(1)",
    "/api/market/list?node=invalid",
    "/api/market/list?page=-1",
    "/api/market/list?page=1.2",
    "/api/market/list?sort=__proto__",
    "/api/market/candles?symbol=sh600519&scale=1",
    "/api/market/financials?symbol=sh600519&source=invalid",
    "/api/market/search?q=",
  ]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
  }
  expect((await request.get("/api/market/not-a-module")).status()).toBe(404);
  const missing = await request.get("/stock/invalid");
  // Next.js 流式 not-found 响应可以是 200，错误页面内容才是该场景的权威证据。
  expect(await missing.text()).toContain("这里还没有行情");
});

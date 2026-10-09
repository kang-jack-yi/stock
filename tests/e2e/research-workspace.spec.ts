import { test, expect } from "@playwright/test";

/** 研究写入拒绝跨账号分组、跨站来源、非法日期与超限内容；删除不影响自选。 */
test("研究记录按账号隔离，分组删除保留内容并验证写入边界", async ({ playwright, baseURL }) => {
  const origin = baseURL!;
  const first = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const second = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    expect((await first.get("/api/research")).status()).toBe(401);
    for (const [client, suffix] of [
      [first, "a"],
      [second, "b"],
    ] as const) {
      expect(
        (
          await client.post("/api/auth/register", {
            data: {
              email: `research-${suffix}-${Date.now()}@example.test`,
              password: "test-password-9284",
              name: `研究用户${suffix}`,
            },
          })
        ).status(),
      ).toBe(200);
    }
    expect(
      (await first.post("/api/research", { data: { action: "group", name: "长期关注" } })).status(),
    ).toBe(200);
    const workspace = await first.get("/api/research");
    expect(workspace.headers()["cache-control"]).toBe("no-store");
    const groupId = (await workspace.json()).groups[0].id;
    const entry = {
      action: "entry",
      symbol: "sh600519",
      groupId,
      note: "验证现金流持续性",
      tags: ["长期", "现金流"],
      reviewDate: "2026-10-30",
      position: 10,
    };
    expect((await second.post("/api/research", { data: entry })).status()).toBe(404);
    expect(
      (
        await first.post("/api/research", {
          headers: { Origin: "https://foreign.example" },
          data: entry,
        })
      ).status(),
    ).toBe(403);
    for (const invalid of [
      { ...entry, reviewDate: "2026-02-30" },
      { ...entry, reviewDate: "2026-13-01" },
      { ...entry, tags: Array.from({ length: 9 }, (_, index) => `标签${index}`) },
      { ...entry, tags: ["x".repeat(17)] },
      { ...entry, note: "x".repeat(1501) },
      { ...entry, symbol: "https://foreign.example" },
    ])
      expect((await first.post("/api/research", { data: invalid })).status()).toBe(400);
    expect((await first.post("/api/research", { data: entry })).status()).toBe(200);
    expect(
      (await first.post("/api/research", { data: { action: "group", name: "长期关注" } })).status(),
    ).toBe(409);
    expect((await second.get("/api/research").then((response) => response.json())).entries).toEqual(
      [],
    );
    expect(
      (
        await second.patch("/api/research", {
          data: { action: "group", id: groupId, name: "别的账号" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await second.delete("/api/research", { data: { action: "group", id: groupId } })).status(),
    ).toBe(404);
    await first.post("/api/watchlist", { data: { symbol: "sh600519" } });
    expect(
      (await first.delete("/api/research", { data: { action: "group", id: groupId } })).status(),
    ).toBe(200);
    const retained = (await first.get("/api/research").then((response) => response.json()))
      .entries[0];
    expect(retained).toMatchObject({
      symbol: entry.symbol,
      groupId: null,
      note: entry.note,
      tags: entry.tags,
      reviewDate: entry.reviewDate,
      position: entry.position,
    });
    expect((await first.get("/api/watchlist").then((response) => response.json())).symbols).toEqual(
      ["sh600519"],
    );
    expect(
      (
        await first.delete("/api/research", { data: { action: "entry", symbol: "sh600519" } })
      ).status(),
    ).toBe(200);
    expect((await first.get("/api/research").then((response) => response.json())).entries).toEqual(
      [],
    );
    expect((await first.get("/api/watchlist").then((response) => response.json())).symbols).toEqual(
      ["sh600519"],
    );
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

/** 保存顺序只接收当前自选的完整集合，排序操作保留原有笔记字段。 */
test("自选手动排序持久化且不会覆盖笔记", async ({ playwright, baseURL }) => {
  const client = await playwright.request.newContext({
    baseURL: baseURL!,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  try {
    await client.post("/api/auth/register", {
      data: {
        email: `order-${Date.now()}@example.test`,
        password: "test-password-9284",
        name: "排序测试",
      },
    });
    for (const symbol of ["sh600519", "sz000001"])
      await client.post("/api/watchlist", { data: { symbol } });
    await client.post("/api/research", {
      data: {
        action: "entry",
        symbol: "sh600519",
        groupId: null,
        note: "排序后仍保留",
        tags: ["测试"],
        reviewDate: "",
        position: 0,
      },
    });
    for (const symbols of [["sh600519"], ["sh600519", "sh600519"], ["sh600519", "sz000002"]])
      expect(
        (await client.patch("/api/research", { data: { action: "order", symbols } })).status(),
      ).toBe(409);
    expect(
      (
        await client.patch("/api/research", {
          data: { action: "order", symbols: ["sz000001", "sh600519"] },
        })
      ).status(),
    ).toBe(200);
    const entries = (await client.get("/api/research").then((response) => response.json())).entries;
    expect(entries.map((entry: { symbol: string }) => entry.symbol)).toEqual([
      "sz000001",
      "sh600519",
    ]);
    expect(entries[1]).toMatchObject({ note: "排序后仍保留", tags: ["测试"] });
  } finally {
    await client.dispose();
  }
});

/** 浏览器覆盖分组管理、笔记编辑、筛选和排序，375px 与暗色都不得横向溢出。 */
test("自选研究工作台可编辑并保持移动端布局", async ({ page, baseURL }) => {
  const headers = { Origin: baseURL! };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers,
        data: {
          email: `research-ui-${Date.now()}@example.test`,
          password: "test-password-9284",
          name: "工作台测试",
        },
      })
    ).status(),
  ).toBe(200);
  for (const symbol of ["sh600519", "sz000001"])
    await page.request.post("/api/watchlist", { headers, data: { symbol } });
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "关注计划" })).toBeVisible();
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("观察中");
  await page.getByRole("button", { name: "保存分组" }).click();
  await expect(page.getByRole("button", { name: "重命名分组 观察中" })).toBeVisible();
  await page.getByRole("button", { name: "编辑研究 sh600519", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("关注理由与待验证问题", { exact: true }).fill("等待下一期现金流数据");
  await dialog.getByLabel("复查日期", { exact: true }).fill("2026-10-30");
  await dialog.getByLabel("自选分组", { exact: true }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("观察中", { exact: true })
    .click();
  await expect(dialog.locator(".ant-select").first()).toContainText("观察中");
  await dialog.getByRole("button", { name: "保存研究笔记" }).click();
  await expect(page.getByText("研究笔记已保存", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".research-plans").getByText("等待下一期现金流数据")).toBeVisible();
  await page.getByRole("button", { name: "上移 sz000001", exact: true }).click();
  await expect(page.locator(".research-plan-code").first()).toHaveText("sz000001");
  await page.reload();
  await expect(page.locator(".research-plan-code").first()).toHaveText("sz000001");
  await page.getByRole("button", { name: "编辑研究 sh600519", exact: true }).click();
  await expect(dialog.getByLabel("关注理由与待验证问题", { exact: true })).toHaveValue(
    "等待下一期现金流数据",
  );
  await expect(dialog.locator(".ant-select").first()).toContainText("观察中");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "重命名分组 观察中" }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("重点观察");
  await page.getByRole("button", { name: "保存分组" }).click();
  await expect(page.getByRole("button", { name: "重命名分组 重点观察" })).toBeVisible();
  await page.getByRole("combobox", { name: "筛选自选分组" }).click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("重点观察", { exact: true })
    .click();
  await expect(page.locator(".research-plan-code")).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 812 });
  for (let index = 0; index < 2; index++) {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.getByRole("button", { name: index === 0 ? "切换暗色主题" : "切换亮色主题" }).click();
  }
  await page.getByRole("button", { name: "删除分组 重点观察" }).click();
  await page
    .locator(".ant-popconfirm")
    .getByRole("button", { name: /^删\s*除$/ })
    .click();
  await expect(page.locator(".research-plan-code")).toHaveCount(2);
  await expect(page.locator(".research-plans").getByText("等待下一期现金流数据")).toBeVisible();
  expect(errors).toEqual([]);
});

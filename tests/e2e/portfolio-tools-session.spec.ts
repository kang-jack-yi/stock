import { test, expect } from "@playwright/test";

/** 更换共享 Cookie 模拟另一标签登录，导入文件与风险草稿均应卸载。 */
test("跨标签账号切换清空CSV预览和风险设置草稿", async ({ page, baseURL }) => {
  /** 只创建独立 E2E 账号，不与真实数据库合用。 */
  async function register(name: string) {
    expect(
      (
        await page.request.post("/api/auth/register", {
          headers: { Origin: baseURL! },
          data: {
            email: `tools-session-${crypto.randomUUID()}@example.test`,
            password: "Research-test-123",
            name,
          },
        })
      ).status(),
    ).toBe(200);
  }
  /** 焦点验证会话后工作台按账号 key 重建，旧草稿不能在新账号出现。 */
  async function switchAccount(name: string) {
    await register(name);
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          return page.getByRole("button", { name: "账号菜单", exact: true }).textContent();
        },
        { timeout: 15000, intervals: [1000] },
      )
      .toContain(name);
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await register("导入旧账号");
  await page.goto("/portfolio");
  await page.getByRole("button", { name: "批量导入" }).click();
  await page.getByLabel("选择 CSV 文件").setInputFiles({
    name: "私人草稿.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("date,kind,amount\n2026-01-05,deposit,123"),
  });
  await page.getByRole("button", { name: "验证并预览" }).click();
  await expect(page.getByText("完整回放通过：新增 1 条，已导入 0 条")).toBeVisible();
  await switchAccount("风险新账号");
  await page.getByRole("button", { name: "批量导入" }).click();
  await expect(page.getByText("私人草稿.csv · 1 条")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "验证并预览" })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "设置组合目标" })).toBeEnabled();
  await page.getByRole("button", { name: "设置组合目标" }).click();
  await page.getByLabel("单股上限", { exact: true }).fill("33");
  await switchAccount("最终空账号");
  await expect(page.getByRole("button", { name: "设置组合目标" })).toBeEnabled();
  await page.getByRole("button", { name: "设置组合目标" }).click();
  await expect(page.getByLabel("单股上限", { exact: true })).toHaveValue("");
});

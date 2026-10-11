import { test, expect, type Page } from "@playwright/test";
import { defaultPortfolioColumns, parsePortfolioCsv } from "../../src/lib/portfolio-import";
import type { PortfolioImportPreview } from "../../src/lib/portfolio-import";

const csv =
  "date,kind,amount,note,reference\n2026-01-05,deposit,10000,批量测试,first\n2026-01-05,deposit,10000,批量测试,second";
/** 自动推断模板列，测试请求与真实界面使用相同字段映射。 */
function input(text = csv) {
  return {
    csv: text,
    columns: defaultPortfolioColumns(parsePortfolioCsv(text).headers),
    action: "preview",
  };
}

/** 只等待弹窗自身的有限入口动画，子按钮的旋转与其他循环动画不属于入口定位。 */
async function settlePortfolioDialog(page: Page) {
  await page.getByRole("dialog").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect && Number.isFinite(animation.effect.getComputedTiming().endTime),
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
}

test("批量导入鉴权、同源、来源冲突与账号隔离", async ({ playwright, baseURL }) => {
  const contexts = await Promise.all(
    [0, 1].map(() =>
      playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } }),
    ),
  );
  try {
    expect((await contexts[0].post("/api/portfolio/import", { data: input() })).status()).toBe(401);
    expect((await contexts[0].get("/api/portfolio/export")).status()).toBe(401);
    for (const [index, context] of contexts.entries())
      expect(
        (
          await context.post("/api/auth/register", {
            data: {
              email: `tools-${Date.now()}-${index}@example.test`,
              password: "Research-test-123",
              name: "账本工具测试",
            },
          })
        ).status(),
      ).toBe(200);
    expect(
      (
        await contexts[0].post("/api/portfolio/import", {
          data: input(),
          headers: { Origin: "https://foreign.example" },
        })
      ).status(),
    ).toBe(403);
    const response = await contexts[0].post("/api/portfolio/import", { data: input() });
    expect(response.headers()["cache-control"]).toBe("no-store");
    const preview: PortfolioImportPreview = await response.json();
    expect(preview.added).toBe(2);
    expect(preview.error).toBe("");
    expect(
      (
        await contexts[0].post("/api/portfolio/import", {
          data: { ...input(), action: "commit", version: preview.version },
        })
      ).status(),
    ).toBe(200);
    const duplicate: PortfolioImportPreview = await contexts[0]
      .post("/api/portfolio/import", { data: input() })
      .then((r) => r.json());
    expect(duplicate.skipped).toBe(2);
    expect(duplicate.added).toBe(0);
    expect(
      (await contexts[1].post("/api/portfolio/import", { data: input() }).then((r) => r.json()))
        .added,
    ).toBe(2);
    const conflict = await contexts[0]
      .post("/api/portfolio/import", { data: input(csv.replace("deposit,10000", "deposit,20000")) })
      .then((r) => r.json());
    expect(conflict.rows[0].error).toMatch(/内容已变化/);
    expect(
      (
        await contexts[0].put("/api/portfolio/risk", {
          data: {
            stockLimit: 20,
            cashTarget: 50,
            assumedDrop: 10,
            targets: [{ symbol: "sh600519", weight: 40 }],
          },
        })
      ).status(),
    ).toBe(200);
    expect((await contexts[1].get("/api/portfolio/risk").then((r) => r.json())).stockLimit).toBe(
      null,
    );
    expect(
      (
        await contexts[0].put("/api/portfolio/risk", {
          data: {
            stockLimit: 20,
            cashTarget: 80,
            assumedDrop: 10,
            targets: [{ symbol: "sh600519", weight: 40 }],
          },
        })
      ).status(),
    ).toBe(400);
    const exported = await contexts[0].get("/api/portfolio/export");
    expect(exported.headers()["content-type"]).toContain("text/csv");
    expect(await exported.text()).toContain("备注（安全文本）");
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
  }
});

test("真实CSV上传预览确认、重复防护、目标表单与六种尺寸主题布局", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `tools-ui-${Date.now()}@example.test`,
          password: "Research-test-123",
          name: "工具界面回归",
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/portfolio");
  await expect(page.getByRole("button", { name: "设置组合目标" })).toBeEnabled();
  await page.getByRole("button", { name: "批量导入" }).click();
  await page.getByLabel("选择 CSV 文件").setInputFiles({
    name: "非UTF8.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([0xff]),
  });
  await expect(page.getByText("文件编码不是 UTF-8，请另存为 UTF-8 CSV 后重新选择")).toBeVisible();
  await page
    .getByLabel("选择 CSV 文件")
    .setInputFiles({ name: "两笔合法入金.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "验证并预览" }).click();
  await expect(page.getByText("完整回放通过：新增 2 条，已导入 0 条")).toBeVisible();
  await page.getByRole("button", { name: "确认导入 2 条" }).click();
  await expect(page.getByText("已导入 2 条，跳过 0 条已导入记录")).toBeVisible();
  await expect(page.locator(".portfolio-metric").filter({ hasText: "现金余额" })).toContainText(
    "20,000.00",
  );
  await page.getByRole("button", { name: "批量导入" }).click();
  await page.getByRole("button", { name: "验证并预览" }).click();
  await expect(page.getByText("完整回放通过：新增 0 条，已导入 2 条")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认导入 0 条" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "设置组合目标" }).click();
  await page.getByLabel("单股上限", { exact: true }).fill("25");
  await page.getByLabel("现金目标", { exact: true }).fill("40");
  await page.getByRole("button", { name: "添加股票目标" }).click();
  await page.getByLabel("目标股票1").fill("sh600519");
  await page.getByLabel("股票目标1").fill("50");
  await page.getByRole("button", { name: "保存组合目标" }).click();
  await expect(page.locator(".portfolio-risk-summary")).toContainText("未分配目标：10.00%");
  await expect(page.locator(".portfolio-risk-summary")).toContainText("现金偏离：+60.00");
  for (const width of [1440, 768, 375])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((value) => {
        localStorage.setItem("guanlan-theme", value);
      }, theme);
      await page.reload();
      await expect(page.locator(".portfolio-risk-summary")).toContainText("未分配目标：10.00%");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const size = await page.evaluate(() => ({
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
      await page.getByRole("button", { name: "设置组合目标" }).click();
      await expect(page.getByLabel("目标股票1")).toHaveValue("sh600519");
      await settlePortfolioDialog(page);
      const modal = await page.getByRole("dialog").boundingBox();
      expect(modal!.x).toBeGreaterThanOrEqual(0);
      expect(modal!.x + modal!.width).toBeLessThanOrEqual(width + 1);
      await expect
        .poll(async () => {
          const addTarget = await page.getByRole("button", { name: "添加股票目标" }).boundingBox();
          const saveTarget = await page.getByRole("button", { name: "保存组合目标" }).boundingBox();
          return saveTarget!.y - addTarget!.y - addTarget!.height;
        })
        .toBeGreaterThanOrEqual(23);
      await page.screenshot({
        path: `artifacts/phase3-qa/portfolio-risk-${width}-${theme}.png`,
        fullPage: false,
      });
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "批量导入" }).click();
      await page
        .getByLabel("选择 CSV 文件")
        .setInputFiles({ name: "test.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "验证并预览" }).click();
      await expect(page.getByText("完整回放通过：新增 0 条，已导入 2 条")).toBeVisible();
      await expect(page.getByRole("button", { name: "验证并预览" })).not.toHaveClass(
        /ant-btn-loading/,
      );
      await settlePortfolioDialog(page);
      await page.screenshot({
        path: `artifacts/phase3-qa/portfolio-import-${width}-${theme}.png`,
        fullPage: false,
      });
      const body = await page.getByRole("dialog").boundingBox();
      expect(body!.x + body!.width).toBeLessThanOrEqual(width + 1);
      const content = await page.locator(".portfolio-import-content").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          right: box.right,
          widest: Math.max(
            ...Array.from(element.children).map((child) => child.getBoundingClientRect().right),
          ),
        };
      });
      expect(content.widest).toBeLessThanOrEqual(body!.x + body!.width + 1);
      expect(content.right).toBeLessThanOrEqual(width + 1);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
    }
  expect(errors).toEqual([]);
});

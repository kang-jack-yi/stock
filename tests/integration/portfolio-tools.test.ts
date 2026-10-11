import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import {
  commitPortfolioImport,
  previewPortfolioImport,
  portfolioImportBody,
} from "../../src/lib/portfolio-import-store";
import {
  defaultPortfolioColumns,
  exportPortfolioCsv,
  parsePortfolioCsv,
} from "../../src/lib/portfolio-import";
import { portfolioTransactions, writePortfolio } from "../../src/lib/portfolio-store";
import { getPortfolioRisk, savePortfolioRisk } from "../../src/lib/portfolio-risk-store";
import { defaultPortfolioRisk } from "../../src/lib/portfolio-risk";

process.env.DATABASE_PATH = "./data/portfolio-integration.db";
/** 建立独立测试账号；完成后级联清理测试内容，不触及真实账本。 */
function user() {
  const id = randomUUID();
  db()
    .prepare("INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)")
    .run(id, `${id}@example.test`, "持仓集成夹具", "not-a-real-password", Date.now());
  return id;
}
/** 由文本推断列，走与实际 API 相同的 CSV 校验与事务路径。 */
function preview(id: string, csv: string) {
  return previewPortfolioImport(id, csv, defaultPortfolioColumns(parsePortfolioCsv(csv).headers));
}
/** 确认时携带预览版本，完整校验后才能写入。 */
function commit(id: string, csv: string) {
  const result = preview(id, csv);
  return commitPortfolioImport(
    id,
    csv,
    defaultPortfolioColumns(parsePortfolioCsv(csv).headers),
    result.version,
  );
}
const cash = "date,kind,amount\n2026-01-05,deposit,1000\n2026-01-05,deposit,1000";

test("同批相同合法行保留、重复批次不重入、导出回导跳过，删除后身份仍防重", () => {
  const id = user();
  try {
    assert.equal(preview(id, cash).added, 2);
    assert.equal(portfolioTransactions(id).length, 0);
    assert.deepEqual(commit(id, cash), { added: 2, skipped: 0 });
    assert.equal(portfolioTransactions(id).length, 2);
    assert.deepEqual(commit(id, cash), { added: 0, skipped: 2 });
    assert.deepEqual(commit(id, cash.replaceAll("\n", "\r\n") + "\r\n\r\n"), {
      added: 0,
      skipped: 2,
    });
    const exported = exportPortfolioCsv(portfolioTransactions(id));
    assert.equal(preview(id, exported).skipped, 2);
    const records = portfolioTransactions(id);
    writePortfolio(id, "delete", undefined, records[0].id);
    assert.match(preview(id, cash).rows[0].error, /已删除/);
    assert.throws(() => commit(id, cash), /错误行/);
  } finally {
    db().prepare("DELETE FROM users WHERE id=?").run(id);
  }
});

test("非法历史现金、来源冲突、预览后变更整笔拒绝且不写防重标记", () => {
  const id = user();
  try {
    const invalid =
      "date,kind,amount,reference\n2026-01-05,deposit,100,a\n2026-01-05,withdraw,200,b";
    assert.match(preview(id, invalid).error, /现金余额不足/);
    assert.throws(() => commit(id, invalid), /现金余额不足/);
    assert.equal(portfolioTransactions(id).length, 0);
    assert.equal(
      (
        db()
          .prepare("SELECT COUNT(*) AS count FROM portfolio_import_rows WHERE user_id=?")
          .get(id) as { count: number }
      ).count,
      0,
    );
    const text = "date,kind,amount,reference\n2026-01-05,deposit,100,a";
    commit(id, text);
    assert.match(preview(id, text.replace(",100,", ",200,")).rows[0].error, /内容已变化/);
    const version = preview(id, cash).version;
    commit(id, "date,kind,amount,reference\n2026-01-05,deposit,1,c");
    assert.throws(
      () =>
        commitPortfolioImport(
          id,
          cash,
          defaultPortfolioColumns(parsePortfolioCsv(cash).headers),
          version,
        ),
      /已变化/,
    );
    const existing = portfolioTransactions(id)[0];
    writePortfolio(id, "update", { ...existing, amount: 99 }, existing.id);
    assert.match(preview(id, text).rows[0].error, /已被编辑/);
  } finally {
    db().prepare("DELETE FROM users WHERE id=?").run(id);
  }
});

test("来源与目标按账号隔离；唯一编号不允许同文件重复", () => {
  const first = user(),
    second = user();
  try {
    commit(first, cash);
    assert.equal(preview(second, cash).added, 2);
    assert.equal(portfolioTransactions(second).length, 0);
    savePortfolioRisk(first, {
      ...defaultPortfolioRisk,
      stockLimit: 20,
      cashTarget: 30,
      targets: [{ symbol: "sh600519", weight: 40 }],
    });
    assert.equal(getPortfolioRisk(first).stockLimit, 20);
    assert.equal(getPortfolioRisk(second).stockLimit, null);
    const text = "date,kind,amount,reference\n2026-01-05,deposit,1,same\n2026-01-05,deposit,1,same";
    assert.match(preview(second, text).rows[1].error, /编号重复/);
  } finally {
    db().prepare("DELETE FROM users WHERE id IN (?,?)").run(first, second);
  }
});

test("导入请求流式限制字节，不读取无限JSON", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ csv: "中".repeat(800000) }),
  });
  await assert.rejects(() => portfolioImportBody(request), /2 MB/);
  await assert.rejects(
    () =>
      portfolioImportBody(new Request("https://example.test", { method: "POST", body: "{bad" })),
    /有效 UTF-8 JSON/,
  );
});

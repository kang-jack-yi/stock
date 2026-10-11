import test from "node:test";
import assert from "node:assert/strict";
import {
  intelligenceId,
  titleAssociation,
  pageIntelligence,
  safeIntelligenceUrl,
} from "../../src/lib/intelligence-parse";
import type { IntelligenceItem, IntelligenceQuery } from "../../src/lib/intelligence-types";

/** 只有完整代码或明确的长证券简称匹配标题，防止短名与代码子串误关联。 */
test("资讯标题代码、完整名称匹配及歧义边界", () => {
  assert.equal(
    titleAssociation("贵州茅台公布财报", "sh600519", "贵州茅台"),
    "标题名称匹配（请核对原文）",
  );
  assert.equal(titleAssociation("600519：公开公告", "sh600519", ""), "标题代码匹配");
  assert.equal(titleAssociation("16005190 的金额变化", "sh600519", ""), null);
  assert.equal(titleAssociation("项目支出600519元", "sh600519", ""), null);
  assert.equal(titleAssociation("金额600519", "sh600519", ""), null);
  assert.equal(titleAssociation("SH600519最新行情", "sh600519", ""), "标题代码匹配");
  assert.equal(titleAssociation("平安今天发布消息", "sz000001", "平安"), null);
  assert.equal(titleAssociation("市场整体走强", "sh600519", "贵州茅台"), null);
  assert.equal(titleAssociation("", "sh600519", ""), null);
});

/** 原文防脚本、伪域名、凭证和非固定公告路径，保留合法公开链接。 */
test("情报原文链接安全白名单", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://finance.sina.com.cn/a",
    "https://sina.com.cn.evil.test/a",
    "https://person@finance.sina.com.cn/a",
    "https://finance.sina.com.cn:8443/a",
    "https://example.test/a",
  ])
    assert.equal(safeIntelligenceUrl(url, "news"), null);
  assert.equal(
    safeIntelligenceUrl("https://finance.sina.com.cn/stock/a.shtml", "news"),
    "https://finance.sina.com.cn/stock/a.shtml",
  );
  assert.equal(
    safeIntelligenceUrl(
      "https://static.cninfo.com.cn/finalpage/2026-10-09/123456.PDF",
      "announcement",
    ),
    "https://static.cninfo.com.cn/finalpage/2026-10-09/123456.PDF",
  );
  assert.equal(
    safeIntelligenceUrl(
      "https://static.cninfo.com.cn/finalpage/2026-10-09/123456.PDF?redirect=1",
      "announcement",
    ),
    null,
  );
  assert.equal(
    safeIntelligenceUrl("https://static.cninfo.com.cn/other/123.PDF", "announcement"),
    null,
  );
});

/** 同一上游编号跨标题修订稳定，不同种类和证券不共享状态键。 */
test("情报稳定编号区分证券与来源种类", () => {
  assert.equal(
    intelligenceId("announcement", "sh600519", "123"),
    intelligenceId("announcement", "sh600519", "123"),
  );
  assert.notEqual(
    intelligenceId("announcement", "sh600519", "123"),
    intelligenceId("news", "sh600519", "123"),
  );
  assert.notEqual(
    intelligenceId("news", "sh600519", "123"),
    intelligenceId("news", "sz000001", "123"),
  );
});

/** 明确测试有限集合先过滤去重再分页，收藏、已读和证券筛选不会偏移页内数量。 */
test("情报筛选分页、去重及保留收藏", () => {
  const items: IntelligenceItem[] = Array.from({ length: 45 }, (_, index) => ({
    id: intelligenceId("announcement", "sh600519", String(index)),
    kind: "announcement",
    symbol: "sh600519",
    name: "测试证券",
    title: `公开标题${index}`,
    occurredAt: "2026-10-09",
    dateOnly: true,
    url: null,
    association: "测试夹具",
    read: index < 20,
    saved: index >= 20,
  }));
  const query: IntelligenceQuery = { symbol: "sh600519", kind: "all", state: "all", page: 2 };
  assert.equal(pageIntelligence([...items, items[0]], query).total, 45);
  assert.equal(pageIntelligence(items, query).items.length, 20);
  assert.equal(pageIntelligence(items, { ...query, page: 3 }).items.length, 5);
  assert.equal(pageIntelligence(items, { ...query, state: "unread", page: 1 }).total, 25);
  assert.equal(pageIntelligence(items, { ...query, state: "saved", page: 2 }).items.length, 5);
  assert.equal(pageIntelligence(items, { ...query, symbol: "sz000001" }).total, 0);
  assert.equal(pageIntelligence(items, { ...query, kind: "signal" }).total, 0);
});

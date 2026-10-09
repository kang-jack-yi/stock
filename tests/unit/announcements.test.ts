import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAnnouncement,
  defaultAnnouncementRange,
  filterAnnouncements,
  parseAnnouncementPage,
  parseAnnouncementQuery,
} from "../../src/lib/announcement-parse";

/** 上游示例只包含公开元数据，时间对应上海 2026-08-15 零点。 */
function row(id: string, title = "2026年半年度报告", overrides: Record<string, unknown> = {}) {
  return {
    secCode: "600519",
    secName: "贵州茅台",
    announcementId: id,
    announcementTitle: title,
    announcementTime: 1786723200000,
    adjunctUrl: `finalpage/2026-08-15/${id}.PDF`,
    ...overrides,
  };
}

test("公告查询校验真实日期、最长区间、索引代码与查询边界", () => {
  assert.deepEqual(defaultAnnouncementRange(new Date("2026-10-08T17:00:00Z")), {
    start: "2025-10-09",
    end: "2026-10-09",
  });
  const invalidQueries: Record<string, string>[] = [
    { symbol: "sh000001" },
    { symbol: "sz399001" },
    { symbol: "https://evil.com" },
    { symbol: "sh600519", start: "2026-02-30", end: "2026-03-01" },
    { symbol: "sh600519", start: "2025-01-01", end: "2026-10-09" },
    { symbol: "sh600519", page: "1.5" },
    { symbol: "sh600519", category: "toString" },
    { symbol: "sh600519", keyword: "a".repeat(41) },
  ];
  for (const params of invalidQueries)
    assert.throws(() => parseAnnouncementQuery(new URLSearchParams(params)));
  const query = parseAnnouncementQuery(
    new URLSearchParams({
      symbol: "bj920344",
      keyword: " 报告 ",
      start: "2026-01-01",
      end: "2026-10-09",
    }),
  );
  assert.equal(query.keyword, "报告");
  assert.equal(query.symbol, "bj920344");
});

test("公告拒绝跨股票和不可信地址，披露日期不伪造具体时间", () => {
  const parsed = parseAnnouncementPage(
    {
      totalAnnouncement: 6,
      announcements: [
        row("1", "<em>半年</em>年度报告"),
        row("2", "公告", { secCode: "000001" }),
        row("3", "公告", { adjunctUrl: "https://evil.com/file.PDF" }),
        row("4", "公告", { adjunctUrl: "finalpage/2026-08-15/../../file.PDF" }),
        row("5", "公告", { announcementTime: "not-a-date" }),
        row("6", "公告", { announcementTime: 1786726800000 }),
      ],
    },
    "sh600519",
  );
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].title, "半年年度报告");
  assert.equal(parsed.items[0].publishedDate, "2026-08-15");
  assert.equal(parsed.items[0].hasTime, false);
  assert.equal(parsed.items[1].hasTime, true);
  assert.equal(new URL(parsed.items[0].url).hostname, "static.cninfo.com.cn");
  assert.throws(() => parseAnnouncementPage("<script>evil</script>", "sh600519"));
});

test("标题分类处理回购、增减持、分红和财报且明确优先级", () => {
  for (const [title, category] of [
    ["回购股份实施结果暨股份变动公告", "repurchase"],
    ["关于回购并注销限制性股票的公告", "repurchase"],
    ["股东减持计划实施完毕公告", "holdings"],
    ["简式权益变动报告书", "holdings"],
    ["年度权益分派实施公告", "dividend"],
    ["第一季度报告", "financial"],
    ["年度业绩预告", "financial"],
    ["关于召开董事会的公告", "other"],
  ])
    assert.equal(classifyAnnouncement(title), category);
});

test("完整区间去重、倒序、标题过滤之后真实分页，不能用当前页估计总量", () => {
  const rows = Array.from({ length: 45 }, (_, index) =>
    row(String(100 + index), index % 2 ? "回购进展" : "年度报告"),
  );
  const items = parseAnnouncementPage(
    { totalAnnouncement: 46, announcements: [...rows, rows[0]] },
    "sh600519",
  ).items;
  const query = parseAnnouncementQuery(
    new URLSearchParams({ symbol: "sh600519", start: "2026-01-01", end: "2026-10-09", page: "2" }),
  );
  const all = filterAnnouncements(items, query);
  assert.equal(all.total, 45);
  assert.equal(all.items.length, 20);
  assert.equal(all.items[0].id, "124");
  const reports = filterAnnouncements(items, {
    ...query,
    category: "financial",
    keyword: "年度",
    page: 2,
  });
  assert.equal(reports.total, 23);
  assert.equal(reports.items.length, 3);
  assert.equal(reports.windowTotal, 45);
  assert.equal(filterAnnouncements(items, { ...query, start: "2026-08-16", page: 1 }).total, 0);
});

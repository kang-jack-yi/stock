import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { intelligenceId } from "../../src/lib/intelligence-parse";
import {
  intelligenceEntries,
  retainIntelligence,
  updateIntelligence,
} from "../../src/lib/intelligence-store";
import type { IntelligenceEntry } from "../../src/lib/intelligence-types";
import { getIntelligence } from "../../src/lib/intelligence";
import { portfolioToday } from "../../src/lib/portfolio-calculation";

process.env.DATABASE_PATH = "./data/intelligence-integration.db";

/** 只创建专用数据库测试账号与公开标题夹具，退出时完整清理本测试数据。 */
function accounts() {
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids)
    db()
      .prepare("INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)")
      .run(id, `${id}@example.test`, "情报集成夹具", "not-a-real-password", Date.now());
  return {
    ids,
    cleanup: () => {
      for (const id of ids) db().prepare("DELETE FROM users WHERE id=?").run(id);
    },
  };
}

/** 账号不能修改他人记录，同一公开标题可有各自的阅读和收藏状态。 */
test("SQLite情报阅读、收藏隔离以及标题更新保留状态", () => {
  const {
    ids: [first, second],
    cleanup,
  } = accounts();
  const entry: IntelligenceEntry = {
    id: intelligenceId("announcement", "sh600519", "fixture-123"),
    kind: "announcement",
    symbol: "sh600519",
    name: "测试证券",
    title: "测试标题",
    occurredAt: "2026-10-09",
    dateOnly: true,
    url: null,
    association: "集成测试夹具",
  };
  try {
    retainIntelligence(first, [entry]);
    assert.throws(() => updateIntelligence(second, entry.id, "saved", true), /不存在/);
    retainIntelligence(second, [entry]);
    updateIntelligence(first, entry.id, "read", true);
    updateIntelligence(first, entry.id, "saved", true);
    retainIntelligence(first, [{ ...entry, title: "官方修订标题" }]);
    assert.equal(intelligenceEntries(first)[0].read, true);
    assert.equal(intelligenceEntries(first)[0].saved, true);
    assert.equal(intelligenceEntries(first)[0].title, "官方修订标题");
    assert.equal(intelligenceEntries(second)[0].read, false);
    assert.equal(intelligenceEntries(second)[0].saved, false);
    retainIntelligence(first, []);
    assert.equal(intelligenceEntries(first)[0].saved, true);
    updateIntelligence(first, entry.id, "read", false);
    assert.equal(intelligenceEntries(first)[0].read, false);
  } finally {
    cleanup();
  }
});

/** 实际批量超过保留上限后，未收藏裁剪到3000，已收藏不随旧条目清理。 */
test("SQLite情报保留上限与收藏保护", () => {
  const {
    ids: [first],
    cleanup,
  } = accounts();
  const entries = Array.from({ length: 3010 }, (_, index): IntelligenceEntry => ({
    id: intelligenceId("news", "sz000001", `limit-${index}`),
    kind: "news",
    symbol: "sz000001",
    name: "测试证券",
    title: `夹具标题${index}`,
    occurredAt: "2026-10-09",
    dateOnly: true,
    url: null,
    association: "测试夹具",
  }));
  try {
    retainIntelligence(first, entries.slice(0, 1));
    updateIntelligence(first, entries[0].id, "saved", true);
    retainIntelligence(first, entries);
    const stored = intelligenceEntries(first);
    assert.equal(stored.filter((entry) => !entry.saved).length, 3000);
    assert.equal(stored.find((entry) => entry.id === entries[0].id)?.saved, true);
    for (const entry of stored.filter((entry) => !entry.saved).slice(0, 499))
      updateIntelligence(first, entry.id, "saved", true);
    assert.throws(
      () =>
        updateIntelligence(
          first,
          intelligenceEntries(first).find((entry) => !entry.saved)!.id,
          "saved",
          true,
        ),
      /最多收藏/,
    );
  } finally {
    cleanup();
  }
});

/** 网络夹具只拦截固定源，验证服务真实分支：公告失败不阻断资讯/提醒，恢复后新增公告不丢个人状态。 */
test("情报聚合局部源失败、重复新闻去重与恢复后保留收藏", async () => {
  const {
    ids: [first],
    cleanup,
  } = accounts();
  const originalFetch = globalThis.fetch;
  const symbol = "bj920999";
  const today = portfolioToday();
  let failing = true;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "hq.sinajs.cn") {
      const fields = [
        "情报集成银行",
        "10",
        "10",
        "11",
        "12",
        "9",
        "11",
        "11.1",
        "100000",
        "1100000",
        ...Array(20).fill("1"),
        today,
        "15:00:00",
        "00",
      ];
      return new Response(`var hq_str_${symbol}="${fields.join(",")}";`, {
        headers: { "Content-Type": "text/plain;charset=utf-8" },
      });
    }
    if (url.hostname === "www.cninfo.com.cn") {
      if (url.pathname.endsWith("topSearch/query"))
        return Response.json([{ code: symbol.slice(2), category: "A股", orgId: "fixture123" }]);
      if (failing) return new Response("source down", { status: 503 });
      return Response.json({
        totalAnnouncement: 1,
        announcements: [
          {
            secCode: symbol.slice(2),
            secName: "情报集成银行",
            announcementId: "987654321",
            announcementTitle: "集成测试公开公告",
            adjunctUrl: `finalpage/${today}/987654321.PDF`,
            announcementTime: Date.parse(`${today}T00:00:00+08:00`),
          },
        ],
      });
    }
    if (url.hostname === "feed.mix.sina.com.cn") {
      if (failing && url.searchParams.get("page") === "3")
        return new Response("page down", { status: 503 });
      return Response.json(
        {
          result: {
            status: { code: 0 },
            total: 1,
            data: [
              {
                docid: "fixture-dedup",
                title: "情报集成银行发布公开信息",
                url: "https://finance.sina.com.cn/stock/fixture.shtml",
                ctime: Math.floor(Date.parse(`${today}T01:00:00+08:00`) / 1000),
              },
            ],
          },
        },
        { headers: { "Content-Type": "application/json;charset=utf-8" } },
      );
    }
    throw new Error(`Unexpected test source: ${url.hostname}`);
  };
  try {
    db()
      .prepare("INSERT INTO watchlist(user_id,symbol,created_at) VALUES(?,?,?)")
      .run(first, symbol, Date.now());
    db()
      .prepare(
        "INSERT INTO alert_events(id,user_id,symbol,name,metric,direction,threshold,value,quote_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        first,
        symbol,
        "情报集成银行",
        "price",
        "above",
        10,
        11,
        new Date(`${today}T15:00:00+08:00`).toISOString(),
        Date.now(),
      );
    const query = { symbol, kind: "all", state: "all", page: 1 } as const;
    const before = await getIntelligence(first, query);
    assert.equal(before.total, 2);
    assert.equal(before.items.filter((item) => item.kind === "news").length, 1);
    assert.equal(before.coverage.find((item) => item.label === "公开公告")?.status, "error");
    assert.equal(before.coverage.find((item) => item.label === "公开股市资讯")?.status, "warning");
    assert.match(before.coverage.find((item) => item.label === "公开股市资讯")!.message, /失败1页/);
    assert.match(
      before.coverage.find((item) => item.label === "公开股市资讯")!.message,
      /中文名称至少4字.*短名仅匹配完整代码/,
    );
    updateIntelligence(first, before.items.find((item) => item.kind === "news")!.id, "saved", true);
    failing = false;
    const recovered = await getIntelligence(first, query);
    assert.equal(recovered.total, 3);
    assert.equal(recovered.coverage.find((item) => item.label === "公开公告")?.status, "ok");
    assert.equal(recovered.items.find((item) => item.kind === "news")?.saved, true);
    assert.equal(recovered.items.find((item) => item.kind === "announcement")?.dateOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

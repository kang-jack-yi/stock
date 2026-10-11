import "server-only";
import { db } from "./db";
import { announcements } from "./announcements";
import { getAlerts } from "./alerts";
import { getTechnicalEvents } from "./signals";
import { signalLabels } from "./signal-types";
import { portfolioTransactions } from "./portfolio-store";
import { replayPortfolio, portfolioToday } from "./portfolio-calculation";
import { cached, text, quotes } from "./sina/client";
import { parseNews } from "./news";
import { HttpError } from "./http";
import { number } from "./format";
import {
  intelligenceId,
  pageIntelligence,
  titleAssociation,
  safeIntelligenceUrl,
} from "./intelligence-parse";
import { intelligenceEntries, retainIntelligence } from "./intelligence-store";
import type {
  IntelligenceCoverage,
  IntelligenceEntry,
  IntelligenceQuery,
  IntelligenceResult,
} from "./intelligence-types";

/** 当前账号关注的A股和未清仓股票并集；不为已清仓证券发起源查询。 */
export function intelligenceSymbols(userId: string) {
  const watch = db()
    .prepare("SELECT symbol FROM watchlist WHERE user_id=?")
    .all(userId)
    .map((row) => String(row.symbol));
  const holdings = replayPortfolio(portfolioTransactions(userId))
    .positions.filter((position) => position.quantity > 0)
    .map((position) => position.symbol);
  return [...new Set([...watch, ...holdings])]
    .filter((symbol) => /^(sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj[489]\d{5})$/.test(symbol))
    .sort();
}

/** 新闻复用现有固定公开端点和缓存键；只检查最近5页，不宣称完整个股报道。 */
async function recentNews() {
  const results = [];
  for (let page = 1; page <= 5; page++) {
    try {
      results.push({
        result: await cached(`news:stocks:${page}`, 60000, async () =>
          parseNews(
            await text(
              `https://feed.mix.sina.com.cn/api/roll/get?pageid=384&lid=2671&num=20&page=${page}`,
            ),
            "stocks",
          ),
        ),
        error: false,
      });
    } catch {
      results.push({ result: null, error: true });
    }
  }
  return results;
}

/** 聚合单只关注证券最近30日来源，来源失败互不阻塞；收藏查询只读已保存公开标题。 */
export async function getIntelligence(
  userId: string,
  input: IntelligenceQuery,
): Promise<IntelligenceResult> {
  const symbols = intelligenceSymbols(userId);
  const query = {
    ...input,
    symbol: input.symbol || (input.state === "saved" ? "" : symbols[0] || ""),
  };
  const now = new Date();
  const end = portfolioToday(now);
  const start = portfolioToday(new Date(Date.parse(`${end}T00:00:00+08:00`) - 29 * 86400000));
  const coverage: IntelligenceCoverage[] = [];
  let selectedName: string | null = null;
  if (query.symbol && !symbols.includes(query.symbol) && query.state !== "saved")
    throw new HttpError("请选择当前自选或持仓中的股票");
  if (query.symbol && query.state !== "saved") {
    const symbol = query.symbol;
    let name = symbol;
    try {
      name = (await quotes([symbol])).data.find((item) => item.symbol === symbol)?.name || symbol;
      if (name !== symbol) selectedName = name;
    } catch {
      coverage.push({
        label: "证券名称",
        count: 0,
        status: "warning",
        message: "名称查询失败，资讯仅按完整代码关联",
      });
    }
    const collected: IntelligenceEntry[] = [];
    const results = await Promise.allSettled([
      announcements({ symbol, start, end, page: 1, category: "all", keyword: "" }),
      recentNews(),
    ]);
    const ann = results[0];
    if (ann.status === "fulfilled") {
      try {
        const pages = [ann.value];
        for (let page = 2; page <= Math.ceil(ann.value.data.total / 20); page++)
          pages.push(
            await announcements({ symbol, start, end, page, category: "all", keyword: "" }),
          );
        for (const result of pages)
          for (const item of result.data.items) {
            const url = safeIntelligenceUrl(item.url, "announcement");
            if (url)
              collected.push({
                id: intelligenceId("announcement", symbol, item.id),
                kind: "announcement",
                symbol,
                name: item.name || name,
                title: item.title,
                occurredAt: item.publishedAt,
                dateOnly: !item.hasTime,
                url,
                association: "公告证券代码关联；披露日不等于实施日",
              });
          }
        coverage.push({
          label: "公开公告",
          count: collected.length,
          status: ann.value.meta.stale ? "warning" : "ok",
          message: ann.value.meta.stale
            ? ann.value.meta.warning || "使用有界旧缓存"
            : `${start}至${end}完整公告窗口，最多600条`,
        });
      } catch {
        coverage.push({
          label: "公开公告",
          count: 0,
          status: "error",
          message: "公告分页加载失败，请重新加载",
        });
      }
    } else
      coverage.push({
        label: "公开公告",
        count: 0,
        status: "error",
        message: ann.reason instanceof Error ? ann.reason.message : "公告查询失败",
      });
    const news = results[1];
    if (news.status === "fulfilled") {
      let scanned = 0,
        matched = 0;
      const seen = new Set<string>();
      for (const page of news.value)
        if (page.result) {
          scanned += page.result.data.items.length;
          for (const item of page.result.data.items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            const association = titleAssociation(item.title, symbol, name);
            const url = safeIntelligenceUrl(item.url, "news");
            if (
              !association ||
              !url ||
              portfolioToday(new Date(item.publishedAt)) < start ||
              Date.parse(item.publishedAt) > now.getTime()
            )
              continue;
            matched++;
            collected.push({
              id: intelligenceId("news", symbol, item.id),
              kind: "news",
              symbol,
              name,
              title: item.title,
              occurredAt: item.publishedAt,
              dateOnly: false,
              url,
              association,
            });
          }
        }
      const failedPages = news.value.filter((page) => page.error).length;
      const stalePages = news.value.filter((page) => page.result?.meta.stale).length;
      coverage.push({
        label: "公开股市资讯",
        count: matched,
        status: failedPages === 5 ? "error" : failedPages || stalePages ? "warning" : "ok",
        message: `最近5页成功检查${scanned}条标题${failedPages ? `；失败${failedPages}页，请重新加载` : ""}${stalePages ? `；${stalePages}页使用有界旧缓存` : ""}；中文名称至少4字才进行标题匹配，短名仅匹配完整代码；名称匹配须核对原文，未匹配不代表没有报道`,
      });
    } else
      coverage.push({
        label: "公开股市资讯",
        count: 0,
        status: "error",
        message: "资讯查询失败，请重新加载",
      });
    const alerts = getAlerts(userId).events.filter(
      (event) => event.symbol === symbol && portfolioToday(new Date(event.quoteAt)) >= start,
    );
    for (const event of alerts)
      collected.push({
        id: intelligenceId("alert", symbol, event.id),
        kind: "alert",
        symbol,
        name: event.name,
        title: `${event.metric === "price" ? "价格" : "涨跌幅"}${event.direction === "above" ? "上穿" : "下穿"}${number(event.threshold)}${event.metric === "price" ? "元" : "%"}，实际${number(event.value)}${event.metric === "price" ? "元" : "%"}`,
        occurredAt: event.quoteAt,
        dateOnly: false,
        url: null,
        association: "本账号价格提醒触发记录",
      });
    coverage.push({
      label: "价格提醒",
      count: alerts.length,
      status: "ok",
      message: "最近100条账号记录中，本股最近30日触发结果",
    });
    const signals = getTechnicalEvents(userId).filter(
      (event) => event.symbol === symbol && event.date >= start,
    );
    for (const event of signals)
      collected.push({
        id: intelligenceId("signal", symbol, event.id),
        kind: "signal",
        symbol,
        name: event.name,
        title: `${signalLabels[event.kind]}，观测值${number(event.value)}${event.kind === "volumeSpike" ? "倍" : event.kind === "rsiOversold" ? "点" : "元"}`,
        occurredAt: event.date,
        dateOnly: true,
        url: null,
        association: "本账号技术规则；日期为收盘日",
      });
    coverage.push({
      label: "技术信号",
      count: signals.length,
      status: "ok",
      message: "最近100条账号记录中，本股最近30日收盘信号",
    });
    retainIntelligence(userId, collected);
  }
  const stored = intelligenceEntries(userId);
  if (query.state === "saved" && query.symbol)
    selectedName = stored.find((item) => item.symbol === query.symbol && item.saved)?.name || null;
  const scope =
    query.state === "saved"
      ? stored
      : stored.filter(
          (item) =>
            item.symbol === query.symbol &&
            (item.occurredAt.length === 10
              ? item.occurredAt
              : portfolioToday(new Date(item.occurredAt))) >= start,
        );
  const paged = pageIntelligence(scope, query);
  if (query.page > Math.max(1, Math.ceil(paged.total / 20)))
    throw new HttpError("情报页码已变化，请返回第一页");
  return {
    query,
    selectedName,
    symbols,
    savedSymbols: [
      ...new Set(stored.filter((item) => item.saved).map((item) => item.symbol)),
    ].sort(),
    ...paged,
    pageSize: 20,
    coverage,
    start,
    fetchedAt: now.toISOString(),
  };
}

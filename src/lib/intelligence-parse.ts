import { createHash } from "node:crypto";
import type { IntelligenceEntry, IntelligenceItem, IntelligenceQuery } from "./intelligence-types";

/** 类型、上游编号及证券构成稳定键，标题修改不会丢失账号阅读状态。 */
export function intelligenceId(kind: IntelligenceEntry["kind"], symbol: string, sourceId: string) {
  return createHash("sha256").update(`${kind}:${symbol}:${sourceId}`).digest("hex");
}

/** 资讯只按完整代码或至少四字的完整名称匹配标题；短名、空名及代码子串不关联。 */
export function titleAssociation(title: string, symbol: string, name: string): string | null {
  const code = symbol.slice(2);
  if (
    new RegExp(`(^|[^a-z0-9])${symbol}([^a-z0-9]|$)`, "i").test(title) ||
    new RegExp(`(^|[\\s（(【\\[])${code}(?=$|[\\s）)】\\]，,:：])`).test(title)
  )
    return "标题代码匹配";
  const normalized = name.replace(/^(?:\*?ST|N|C)/i, "").trim();
  if (/^[\u4e00-\u9fff]{4,20}$/.test(normalized) && title.includes(normalized))
    return "标题名称匹配（请核对原文）";
  return null;
}

/** 对已完整采集的有限范围先去重、过滤、排序，再分页；不更改原始时间。 */
export function pageIntelligence(items: IntelligenceItem[], query: IntelligenceQuery) {
  const filtered = [...new Map(items.map((item) => [item.id, item])).values()]
    .filter((item) => !query.symbol || item.symbol === query.symbol)
    .filter((item) => query.kind === "all" || item.kind === query.kind)
    .filter((item) => query.state !== "unread" || !item.read)
    .filter((item) => query.state !== "saved" || item.saved)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  return { items: filtered.slice((query.page - 1) * 20, query.page * 20), total: filtered.length };
}

/** 原文仅允许既有资讯域名或巨潮PDF；拒绝凭证、非常规端口和伪装主机。 */
export function safeIntelligenceUrl(value: string, kind: "news" | "announcement") {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (kind === "announcement")
      return url.hostname === "static.cninfo.com.cn" &&
        /^\/finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.PDF$/i.test(url.pathname) &&
        !url.search &&
        !url.hash
        ? url.href
        : null;
    return /(^|\.)sina\.com\.cn$|(^|\.)sina\.cn$/.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

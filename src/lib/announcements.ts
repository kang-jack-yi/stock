import "server-only";
import { cached } from "./sina/client";
import { HttpError } from "./http";
import { filterAnnouncements, parseAnnouncementPage } from "./announcement-parse";
import type { AnnouncementQuery } from "./announcement-types";

const origin = "https://www.cninfo.com.cn";

/** 仅 POST 固定巨潮公开查询路径；十秒超时，暂时性网络失败至多重试一次。 */
async function publicQuery(
  path: "/new/information/topSearch/query" | "/new/hisAnnouncement/query",
  params: URLSearchParams,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          Referer: `${origin}/`,
          "User-Agent": "Mozilla/5.0",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        if (attempt === 0 && response.status >= 500) continue;
        throw new Error("公告公开查询暂不可用，请稍后重试");
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof Error &&
        ["TypeError", "TimeoutError"].includes(error.name)
      )
        continue;
      throw new Error("公告公开查询暂不可用，请稍后重试");
    }
  }
  throw new Error("公告公开查询暂不可用，请稍后重试");
}

/** 动态解析官方证券机构 ID，避免旧代码、新北交所代码和硬编码机构映射失配。 */
async function organization(symbol: string) {
  const value = await publicQuery(
    "/new/information/topSearch/query",
    new URLSearchParams({ keyWord: symbol.slice(2), maxNum: "10" }),
  );
  if (!Array.isArray(value)) throw new Error("公告证券查询暂不可用");
  const stock = value.find(
    (item) =>
      item && typeof item === "object" && item.code === symbol.slice(2) && item.category === "A股",
  );
  if (!stock || typeof stock.orgId !== "string" || !/^[a-z0-9]+$/i.test(stock.orgId))
    throw new HttpError("暂无该证券的公开公告索引", 404);
  return stock.orgId;
}

/** 获取完整日期区间：最多 600 条、每次 30 条、最多三路请求，不截断后冒充完整结果。 */
async function announcementWindow(query: AnnouncementQuery) {
  const orgId = await organization(query.symbol);
  /** 页码由服务端产生；证券及机构 ID 通过 URLSearchParams 编码。 */
  async function page(number: number) {
    return parseAnnouncementPage(
      await publicQuery(
        "/new/hisAnnouncement/query",
        new URLSearchParams({
          pageNum: String(number),
          pageSize: "30",
          column: "",
          tabName: "fulltext",
          stock: `${query.symbol.slice(2)},${orgId}`,
          searchkey: "",
          seDate: `${query.start}~${query.end}`,
          sortName: "time",
          sortType: "desc",
          isHLtitle: "false",
        }),
      ),
      query.symbol,
    );
  }
  const first = await page(1);
  if (first.total > 600) throw new HttpError("该区间公告超过 600 条，请缩小日期范围后查询");
  const items = [...first.items];
  let rawCount = first.rawCount;
  const pages = Math.ceil(first.total / 30);
  for (let number = 2; number <= pages; number += 3) {
    const results = await Promise.all(
      Array.from({ length: Math.min(3, pages - number + 1) }, (_, index) => page(number + index)),
    );
    for (const result of results) {
      if (result.total !== first.total) throw new Error("公告列表正在更新，请稍后重新查询");
      items.push(...result.items);
      rawCount += result.rawCount;
    }
  }
  if (rawCount !== first.total || items.length !== rawCount)
    throw new Error("公告元数据未完整返回，请稍后重新查询");
  return items;
}

/** 复用有界并发缓存，五分钟有效、失败时最多展示五十分钟内旧记录并明确标记。 */
export async function announcements(query: AnnouncementQuery) {
  const result = await cached(
    `announcements:${query.symbol}:${query.start}:${query.end}`,
    300000,
    () => announcementWindow(query),
  );
  const data = filterAnnouncements(result.data, query);
  if (query.page > Math.max(1, Math.ceil(data.total / data.pageSize)))
    throw new HttpError("公告页码超出筛选结果范围");
  return { data, meta: { ...result.meta, source: "巨潮资讯公开公告" } };
}

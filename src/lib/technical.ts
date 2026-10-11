import "server-only";
import { cached } from "./sina/client";
import {
  calculateTechnical,
  parseTechnicalCandles,
  technicalSymbol,
} from "./technical-calculation";
import type { PriceAdjustment, TechnicalResult } from "./technical-types";
import type { ApiResult } from "./types";

/** 固定腾讯免费公开查询，纯 JSON 不执行 _var 脚本；合并请求和有界失败缓存。 */
export async function getTechnical(
  symbol: string,
  adjustment: PriceAdjustment = "qfq",
  now = new Date(),
): Promise<ApiResult<TechnicalResult>> {
  if (!technicalSymbol(symbol) || !["qfq", "none"].includes(adjustment))
    throw new Error("仅支持 A 股日线及前复权/未复权口径");
  const to = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  const from = start.toISOString().slice(0, 10);
  const result = await cached(`technical:${symbol}:${adjustment}:${to}`, 60000, async () => {
    const param = `${symbol},day,${from},${to},640,${adjustment === "qfq" ? "qfq" : ""}`;
    const response = await fetch(
      `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?${new URLSearchParams({ param })}`,
      {
        headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error(`日线查询暂不可用（${response.status}）`);
    const points = calculateTechnical(
      parseTechnicalCandles(await response.json(), symbol, adjustment, from, to),
    );
    if (!points.length) throw new Error("所选范围没有有效日线");
    return {
      symbol,
      adjustment,
      points,
      from,
      to,
      warning:
        "最多 640 个有效日线，指标从可得历史初始化，暖机不足显示缺失。前复权历史会随权益变动重算；成交量不复权，除科创板外源为整数手，换算股数有舍入差。当天日线盘中可能未完成。",
    };
  });
  return { ...result, meta: { ...result.meta, source: "腾讯公开行情" } };
}

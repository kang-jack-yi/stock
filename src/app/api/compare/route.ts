import { NextResponse } from "next/server";
import { quotes, candles } from "@/lib/sina/client";
import { validSymbol } from "@/lib/sina/parse";
import { compareCandles, type ComparisonResult } from "@/lib/compare";
import type { ApiResult } from "@/lib/types";
import { errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";
/** GET /api/compare：最多四只证券按共同交易日比较，原始报价不作为历史收盘价替代。 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const symbols = [...new Set((params.get("symbols") || "").split(","))];
    if (symbols.length < 1 || symbols.length > 4) throw new HttpError("请选择 1 至 4 只证券", 400);
    try {
      symbols.forEach(validSymbol);
    } catch {
      throw new HttpError("股票代码格式不正确", 400);
    }
    const days = Number(params.get("days") || "60");
    if (![20, 60, 120, 240].includes(days)) throw new HttpError("比较周期不正确", 400);
    const [current, history] = await Promise.all([
      quotes(symbols),
      Promise.all(symbols.map((symbol) => candles(symbol, "240"))),
    ]);
    if (current.data.length !== symbols.length)
      throw new HttpError("部分证券没有有效行情，请移除后重试", 404);
    const aligned = compareCandles(
      symbols.map((symbol, i) => ({
        symbol,
        name: current.data.find((row) => row.symbol === symbol)!.name,
        candles: history[i].data,
      })),
      days,
    );
    const responses = [current, ...history],
      stale = responses.some((response) => response.meta.stale);
    const result: ApiResult<ComparisonResult> = {
      data: {
        quotes: symbols.map((symbol) => current.data.find((row) => row.symbol === symbol)!),
        ...aligned,
        requestedDays: days,
      },
      meta: {
        source: "新浪财经",
        fetchedAt: responses.map((response) => response.meta.fetchedAt).sort()[0],
        stale,
        ...(stale ? { warning: "部分上游数据暂不可用，正在使用容许期限内的缓存" } : {}),
      },
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

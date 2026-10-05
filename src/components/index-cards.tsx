"use client";

import Link from "next/link";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { useMarketData } from "@/lib/api";
import type { Quote } from "@/lib/types";
import { direction, number, percent, signed } from "@/lib/format";
import { DataError, DataSkeleton } from "./data-state";

export const INDEX_SYMBOLS = ["sh000001", "sz399001", "sz399006", "sh000300"];
/** 四个指数卡片使用一条批量行情请求，数值和更新时间都来自上游。 */
export function IndexCards() {
  const { data, error, isLoading, mutate } = useMarketData<Quote[]>(
    `/api/market/quotes?symbols=${INDEX_SYMBOLS.join(",")}`,
  );
  if (error && !data) return <DataError error={error} retry={mutate} />;
  return (
    <div className="index-grid">
      {INDEX_SYMBOLS.map((symbol, i) => {
        const quote = data?.data.find((q) => q.symbol === symbol),
          tone = direction(quote?.change);
        return (
          <Link href={`/stock/${symbol}`} className="index-card" key={symbol}>
            {isLoading ? (
              <DataSkeleton rows={1} />
            ) : (
              <>
                <div className="index-card-title">
                  <strong>
                    {quote?.name || ["上证指数", "深证成指", "创业板指", "沪深300"][i]}
                  </strong>
                  <span>{symbol.startsWith("sh") ? "SSE" : "SZSE"}</span>
                </div>
                <div className={`index-value numeric ${tone}`}>{number(quote?.price)}</div>
                <div className="index-bottom">
                  <div className={`index-change ${tone}`}>
                    {tone === "up" ? (
                      <ArrowUpOutlined />
                    ) : tone === "down" ? (
                      <ArrowDownOutlined />
                    ) : null}
                    <span>{signed(quote?.change)}</span>
                    <strong>{percent(quote?.changePercent)}</strong>
                  </div>
                  <span>{quote?.time?.slice(0, 5) || "—"}</span>
                </div>
                <div className="index-range">
                  <span>低 {number(quote?.low)}</span>
                  <span>高 {number(quote?.high)}</span>
                </div>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMarketData } from "@/lib/api";
import type { MarketBreadth as Breadth } from "@/lib/screener";
import { compact } from "@/lib/format";
import { DataError, DataMeta, DataSkeleton } from "./data-state";
import "./research-tools.css";

/** 完整 A 股市场涨跌分布；获取失败展示重试，不用涨幅榜样本推算全市场。 */
export function MarketBreadth() {
  const { data, error, isLoading, mutate } = useMarketData<Breadth>("/api/breadth", false);
  const market = data?.data;
  return (
    <section className="panel breadth-panel">
      <div className="panel-heading">
        <div>
          <h2>市场温度</h2>
          <span className="panel-caption">全量 A 股 · 涨跌家数与成交额</span>
        </div>
        <Link href="/screener" className="text-link">
          条件选股 →
        </Link>
      </div>
      {isLoading ? (
        <DataSkeleton rows={2} />
      ) : error ? (
        <DataError error={error} retry={mutate} />
      ) : (
        market && (
          <>
            <div className="breadth-stats">
              <div>
                <span>上涨</span>
                <strong className="up numeric">{market.advancing.toLocaleString()}</strong>
              </div>
              <div>
                <span>下跌</span>
                <strong className="down numeric">{market.declining.toLocaleString()}</strong>
              </div>
              <div>
                <span>平盘</span>
                <strong className="numeric">{market.unchanged.toLocaleString()}</strong>
              </div>
              <div>
                <span>全市场成交额</span>
                <strong className="numeric">{compact(market.amount)}</strong>
              </div>
            </div>
            <div className="breadth-bar" aria-hidden="true">
              <span
                style={{
                  width: `${(market.advancing / market.total) * 100}%`,
                  background: "var(--up)",
                }}
              />
              <span
                style={{
                  width: `${(market.declining / market.total) * 100}%`,
                  background: "var(--down)",
                }}
              />
              <span
                style={{
                  width: `${(market.unchanged / market.total) * 100}%`,
                  background: "var(--muted)",
                }}
              />
            </div>
            <div className="breadth-legend">
              <span>
                覆盖 <b>{market.total.toLocaleString()}</b> 只
              </span>
              <span>
                无有效报价 <b>{market.unavailable}</b> 只
              </span>
              <span>完整分页快照 · 每 5 分钟更新</span>
            </div>
            <DataMeta meta={data?.meta} />
          </>
        )
      )}
    </section>
  );
}

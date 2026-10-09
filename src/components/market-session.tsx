"use client";
import useSWR from "swr";
import { fetchJson } from "@/lib/api";
import type { TradingSession } from "@/lib/trading-calendar";

/** 顶部交易状态按分钟刷新，服务端和首屏客户端不分别猜测当前时段。 */
export function MarketSession() {
  const { data } = useSWR<TradingSession>("/api/calendar", fetchJson, { refreshInterval: 60000 });
  return (
    <span
      className="market-source"
      title={data?.known ? "基于交易所年度休市日历" : "日历未覆盖当前年份，提醒检查暂停"}
    >
      <i />
      {data?.label ?? "行情数据"}
    </span>
  );
}

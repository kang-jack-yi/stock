"use client";

import { useMemo } from "react";
import { InfoCircleOutlined } from "@ant-design/icons";
import type { EChartsCoreOption } from "echarts/core";
import { useMarketData } from "@/lib/api";
import type { Funds } from "@/lib/types";
import { compact, direction, number } from "@/lib/format";
import { useApp } from "./providers";
import { chartColors } from "@/lib/chart-theme";
import { Chart } from "./chart";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";

/** 资金分类金额统一为元；前端仅格式化显示，不重新定义新浪的主力口径。 */
export function FundsPanel({ symbol }: { symbol: string }) {
  const { data, error, isLoading, mutate } = useMarketData<Funds>(
    `/api/market/funds?symbol=${symbol}`,
  );
  const { mode } = useApp(),
    funds = data?.data;
  const main = funds ? funds.categories.slice(0, 2).reduce((sum, row) => sum + row.net, 0) : null;
  const option = useMemo<EChartsCoreOption>(() => {
    const palette = chartColors(mode);
    return {
      animation: false,
      aria: { enabled: true },
      grid: { left: 62, right: 30, top: 25, bottom: 35 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        backgroundColor: palette.surface,
        textStyle: { color: palette.text },
        borderColor: palette.grid,
        valueFormatter: (value: unknown) => `${number(Number(value))}万元`,
      },
      xAxis: {
        type: "category",
        data: funds?.categories.map((row) => row.name) || [],
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: palette.muted },
      },
      yAxis: {
        type: "value",
        name: "万元",
        nameTextStyle: { color: palette.muted },
        axisLabel: { color: palette.muted },
        splitLine: {
          lineStyle: { color: palette.grid, type: "dashed" },
        },
      },
      series: [
        {
          name: "净流入",
          type: "bar",
          barMaxWidth: 55,
          data:
            funds?.categories.map((row) => ({
              value: row.net / 10000,
              itemStyle: {
                color: row.net >= 0 ? palette.up : palette.down,
                borderRadius: row.net >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
              },
            })) || [],
        },
      ],
    };
  }, [funds, mode]);
  if (isLoading) return <DataSkeleton rows={8} />;
  if (error) return <DataError error={error} retry={mutate} />;
  if (!funds) return <NoData />;
  return (
    <div className="funds-content">
      <div className="fund-summary">
        <div>
          <span>今日资金净流入</span>
          <strong className={`numeric ${direction(funds.net)}`}>
            {funds.net > 0 ? "+" : ""}
            {compact(funds.net)}
          </strong>
        </div>
        <div>
          <span>特大单 + 大单净流入</span>
          <strong className={`numeric ${direction(main)}`}>
            {main != null && main > 0 ? "+" : ""}
            {compact(main)}
          </strong>
        </div>
        <div>
          <span>统计时间</span>
          <strong className="fund-time">
            {funds.date}
            <small>{funds.time}</small>
          </strong>
        </div>
      </div>
      <div className="funds-grid">
        <div>
          <h3>分类资金净流入</h3>
          <Chart option={option} label="特大单、大单、小单、散单净流入金额对比" height={280} />
        </div>
        <div className="fund-breakdown">
          <div className="fund-row head">
            <span>分类</span>
            <span>流入 / 流出</span>
            <span>净流入</span>
          </div>
          {funds.categories.map((row) => (
            <div className="fund-row" key={row.name}>
              <strong>{row.name}</strong>
              <span>
                <b className="up">{compact(row.inflow)}</b>
                <b className="down">{compact(row.outflow)}</b>
              </span>
              <strong className={`numeric ${direction(row.net)}`}>
                {row.net > 0 ? "+" : ""}
                {compact(row.net)}
              </strong>
            </div>
          ))}
        </div>
      </div>
      <p className="metric-note">
        <InfoCircleOutlined />{" "}
        资金流向根据成交方向和单笔金额分类统计，不代表投资者账户的真实转账金额。不同数据商统计口径可能不同。
      </p>
      <DataMeta meta={data?.meta} date={`${funds.date} ${funds.time}`} />
    </div>
  );
}

"use client";

import { Input, Segmented, Table } from "antd";
import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { SearchOutlined } from "@ant-design/icons";
import { useMarketData } from "@/lib/api";
import type { FinancialRow, Financials } from "@/lib/types";
import { compact, direction, number, percent } from "@/lib/format";
import { Chart } from "./chart";
import { useApp } from "./providers";
import { chartColors } from "@/lib/chart-theme";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";

/** 财务报告日期使用年月日原值，不经过时区转换。 */
function reportDate(date: string) {
  return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date;
}
/** 金额按万元展示；百分比和每股字段保留接口原单位。 */
function financialValue(value: number | null, unit: string) {
  if (value == null) return "—";
  return unit === "元"
    ? number(value / 10000)
    : `${number(value, unit === "元/股" ? 4 : 2)}${unit === "%" ? "%" : ""}`;
}
/** 四类财务报表独立请求，支持按字段筛选和多报告期横向比较。 */
export function FinancialPanel({ symbol }: { symbol: string }) {
  const [source, setSource] = useState("gjzb"),
    [query, setQuery] = useState("");
  const { data, error, isLoading, mutate } = useMarketData<Financials>(
    `/api/market/financials?symbol=${symbol}&source=${source}`,
    false,
  );
  const { mode } = useApp(),
    financials = data?.data;
  const revenue = financials?.rows.find((row) => row.field.startsWith("BIZTOTINCO|"));
  const profit = financials?.rows.find((row) => row.field.startsWith("PARENETP|"));
  const eps = financials?.rows.find((row) => row.field.startsWith("EPSBASIC|"));
  const roe = financials?.rows.find((row) => row.field.startsWith("ROEWEIGHTED|"));
  const option = useMemo<EChartsCoreOption>(() => {
    const palette = chartColors(mode);
    return {
      animation: false,
      aria: { enabled: true },
      color: [palette.blue, palette.amber],
      legend: { top: 0, textStyle: { color: palette.muted } },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: palette.surface,
        textStyle: { color: palette.text },
        borderColor: palette.grid,
        valueFormatter: (value: unknown) => `${number(Number(value))}亿元`,
      },
      grid: { left: 62, right: 20, top: 48, bottom: 40 },
      xAxis: {
        type: "category",
        data: financials?.dates.slice().reverse().map(reportDate) || [],
        axisLabel: { color: palette.muted, hideOverlap: true },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "亿元",
        nameTextStyle: { color: palette.muted },
        axisLabel: { color: palette.muted },
        splitLine: {
          lineStyle: { color: palette.grid, type: "dashed" },
        },
      },
      series: [revenue, profit].filter(Boolean).map((row) => ({
        name: row!.title,
        type: "bar",
        barMaxWidth: 22,
        data: row!.values
          .slice()
          .reverse()
          .map((n) => (n == null ? null : n / 1e8)),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      })),
    };
  }, [financials, revenue, profit, mode]);
  const rows = financials?.rows.filter((row) => !query || row.title.includes(query)) || [];
  return (
    <div className="financial-content">
      <div className="financial-toolbar">
        <Segmented
          value={source}
          onChange={(value) => setSource(String(value))}
          options={[
            { label: "关键指标", value: "gjzb" },
            { label: "利润表", value: "lrb" },
            { label: "资产负债表", value: "fzb" },
            { label: "现金流量表", value: "llb" },
          ]}
        />
        <Input
          className="financial-search"
          prefix={<SearchOutlined />}
          placeholder="筛选财务指标"
          aria-label="筛选财务指标"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
      </div>
      {isLoading ? (
        <DataSkeleton rows={8} />
      ) : error ? (
        <DataError error={error} retry={mutate} />
      ) : !financials ? (
        <NoData />
      ) : (
        <>
          {source === "gjzb" && (
            <>
              <div className="finance-metrics">
                {[
                  { title: "营业总收入", row: revenue },
                  { title: "归母净利润", row: profit },
                  { title: "基本每股收益", row: eps },
                  { title: "净资产收益率", row: roe },
                ].map((metric) => (
                  <div key={metric.title}>
                    <span>{metric.title}</span>
                    <strong className="numeric">
                      {metric.row?.unit === "元"
                        ? compact(metric.row.values[0])
                        : metric.row?.unit === "%"
                          ? `${number(metric.row.values[0])}%`
                          : number(metric.row?.values[0], 4)}
                    </strong>
                    <small className={direction(metric.row?.yoy)}>
                      同比 {percent(metric.row?.yoy == null ? null : metric.row.yoy * 100)}
                    </small>
                  </div>
                ))}
              </div>
              {revenue && profit && (
                <div className="financial-trend">
                  <h3>营业收入与归母净利润</h3>
                  <span className="panel-caption">报告期累计值，不同季度的累计期间不同</span>
                  <Chart option={option} label="各报告期累计营业收入与归母净利润" height={250} />
                </div>
              )}
            </>
          )}
          <div className="financial-table-heading">
            <h3>报告期对比</h3>
            <span>金额：万元 · 每股指标：元/股 · 比率见单位列</span>
          </div>
          <Table<FinancialRow>
            size="small"
            rowKey="field"
            pagination={false}
            scroll={{ x: 1100, y: 480 }}
            dataSource={rows}
            rowClassName={(row) => (row.heading ? "financial-group" : "")}
            columns={[
              { title: "财务指标", dataIndex: "title", fixed: "left", width: 225 },
              {
                title: "单位",
                dataIndex: "unit",
                width: 80,
                render: (unit: string) => (unit === "元" ? "万元" : unit || "—"),
              },
              ...financials.dates.map((date, i) => ({
                title: reportDate(date),
                key: date,
                align: "right" as const,
                width: 135,
                render: (_: unknown, row: FinancialRow) =>
                  row.heading ? (
                    ""
                  ) : (
                    <span className="numeric">{financialValue(row.values[i], row.unit)}</span>
                  ),
              })),
            ]}
          />
        </>
      )}
      <DataMeta
        meta={data?.meta}
        date={
          financials
            ? `报告期 ${reportDate(financials.dates[0])} · 公告 ${reportDate(financials.publishedAt)}`
            : undefined
        }
      />
    </div>
  );
}

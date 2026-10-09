"use client";

import { Button, Input, Segmented, Table } from "antd";
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
import { analyzeFinancials, financialRow, type FinancialPeriod } from "@/lib/financial-analysis";
import styles from "./financial-analysis.module.css";

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
export function FinancialPanel({
  symbol,
}: {
  /** 用于获取四类财务报表的股票代码。 */
  symbol: string;
}) {
  const [source, setSource] = useState("gjzb"),
    [period, setPeriod] = useState<FinancialPeriod>("cumulative"),
    [query, setQuery] = useState("");
  const { data, error, isLoading, mutate } = useMarketData<Financials>(
    `/api/market/financials?symbol=${symbol}&source=${source}`,
    false,
  );
  const income = useMarketData<Financials>(
    source === "gjzb" && period === "quarter"
      ? `/api/market/financials?symbol=${symbol}&source=lrb`
      : null,
    false,
  );
  const { mode } = useApp(),
    financials = data?.data;
  const analysis = useMemo(
    () => financials && analyzeFinancials(financials, income.data?.data, period),
    [financials, income.data, period],
  );
  const eps = financialRow(financials, "EPSBASIC");
  const roe = financialRow(financials, "ROEWEIGHTED");
  const periodLabel = period === "quarter" ? "单季度" : "累计";
  const option = useMemo<EChartsCoreOption>(() => {
    const palette = chartColors(mode);
    return {
      animation: false,
      aria: { enabled: true },
      color: [palette.blue, palette.amber, palette.violet],
      legend: { top: 0, textStyle: { color: palette.muted } },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: palette.surface,
        textStyle: { color: palette.text },
        borderColor: palette.grid,
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? `${number(value)}亿元` : "—",
      },
      // 为窄屏换行后的三组图例留出空间，避免遮挡金额单位。
      grid: { left: 62, right: 20, top: 72, bottom: 40 },
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
      series: [
        { name: "营业总收入", values: analysis?.revenue },
        { name: "归母净利润", values: analysis?.profit },
        { name: "经营现金流净额", values: analysis?.cashFlow },
      ].map((metric) => ({
        name: metric.name,
        type: "bar",
        barMaxWidth: 22,
        data: (metric.values || [])
          .slice()
          .reverse()
          .map((n) => (n == null ? null : n / 1e8)),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      })),
    };
  }, [financials, analysis, mode]);
  const ratioOption = useMemo<EChartsCoreOption>(() => {
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
        valueFormatter: (value: unknown) => (typeof value === "number" ? `${number(value)}%` : "—"),
      },
      grid: { left: 54, right: 20, top: 48, bottom: 40 },
      xAxis: {
        type: "category",
        data: financials?.dates.slice().reverse().map(reportDate) || [],
        axisLabel: { color: palette.muted, hideOverlap: true },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "%",
        nameTextStyle: { color: palette.muted },
        axisLabel: { color: palette.muted },
        splitLine: { lineStyle: { color: palette.grid, type: "dashed" } },
      },
      series: [
        { name: `${periodLabel}净利率`, values: analysis?.netMargin },
        { name: "期末资产负债率", values: analysis?.debtRatio },
      ].map((metric) => ({
        name: metric.name,
        type: "line",
        connectNulls: false,
        data: (metric.values || []).slice().reverse(),
      })),
    };
  }, [financials, analysis, periodLabel, mode]);
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
              <div className={styles.periodToolbar}>
                <span>分析口径</span>
                <Segmented<FinancialPeriod>
                  value={period}
                  onChange={setPeriod}
                  options={[
                    { label: "累计", value: "cumulative" },
                    { label: "单季度", value: "quarter" },
                  ]}
                  aria-label="财务分析口径"
                />
              </div>
              <p className={styles.explanation}>
                {period === "quarter"
                  ? "单季度流量 = 本期累计 − 同年上一季度累计；一季度直接取值。缺少连续报告期时显示 —。"
                  : "累计流量自年初至报告期末；同比对比上年相同报告期。"}
                每股收益、ROE 与资产负债率保留报告期原值。同比基数为零或缺失时不计算。
              </p>
              <div className="finance-metrics">
                {[
                  {
                    title: `${periodLabel}营业总收入`,
                    value: analysis?.revenue[0],
                    unit: "元",
                    yoy: analysis?.revenueYoy[0],
                  },
                  {
                    title: `${periodLabel}归母净利润`,
                    value: analysis?.profit[0],
                    unit: "元",
                    yoy: analysis?.profitYoy[0],
                  },
                  {
                    title: "基本每股收益（报告期）",
                    value: eps?.values[0],
                    unit: "元/股",
                    yoy: eps?.yoy == null ? null : eps.yoy * 100,
                  },
                  {
                    title: "净资产收益率（报告期）",
                    value: roe?.values[0],
                    unit: "%",
                    yoy: roe?.yoy == null ? null : roe.yoy * 100,
                  },
                ].map((metric) => (
                  <div key={metric.title}>
                    <span>{metric.title}</span>
                    <strong className="numeric">
                      {metric.value == null
                        ? "—"
                        : metric.unit === "元"
                          ? compact(metric.value)
                          : metric.unit === "%"
                            ? `${number(metric.value)}%`
                            : number(metric.value, 4)}
                    </strong>
                    <small className={direction(metric.yoy)}>同期同比 {percent(metric.yoy)}</small>
                  </div>
                ))}
              </div>
              <div className={styles.additionalMetrics}>
                <div>
                  <span>{periodLabel}经营现金流净额</span>
                  <strong className="numeric">{compact(analysis?.cashFlow[0])}</strong>
                  <small className={direction(analysis?.cashFlowYoy[0])}>
                    同期同比 {percent(analysis?.cashFlowYoy[0])}
                  </small>
                </div>
                <div>
                  <span>{periodLabel}净利率</span>
                  <strong className="numeric">
                    {analysis?.netMargin[0] == null ? "—" : `${number(analysis.netMargin[0])}%`}
                  </strong>
                  <small>净利润 / 营业收入</small>
                </div>
                <div>
                  <span>期末资产负债率</span>
                  <strong className="numeric">
                    {analysis?.debtRatio[0] == null ? "—" : `${number(analysis.debtRatio[0])}%`}
                  </strong>
                  <small>报告期末存量比率</small>
                </div>
              </div>
              {period === "quarter" && (income.isLoading || income.error) && (
                <div className={styles.explanation} role="status">
                  {income.isLoading
                    ? "单季度净利率数据加载中…"
                    : "利润表暂不可用，单季度净利率显示 —。"}
                  {income.error && (
                    <Button size="small" type="link" onClick={() => income.mutate()}>
                      重试净利率数据
                    </Button>
                  )}
                </div>
              )}
              <div className="financial-trend">
                <h3>{periodLabel}收入、利润与经营现金流</h3>
                <span className="panel-caption">
                  金额：亿元 · 空缺表示数据不足，现金流负值表示净流出
                </span>
                <Chart
                  option={option}
                  label={`各报告期${periodLabel}营业总收入、归母净利润与经营现金流`}
                  height={270}
                />
              </div>
              <div className="financial-trend">
                <h3>净利率与资产负债率趋势</h3>
                <span className="panel-caption">
                  净利率随分析口径变化；资产负债率始终为报告期末原值 · 缺失不连接
                </span>
                <Chart
                  option={ratioOption}
                  label={`${periodLabel}净利率与报告期末资产负债率趋势`}
                  height={250}
                />
              </div>
            </>
          )}
          <div className="financial-table-heading">
            <h3>原始报告期对比</h3>
            <span>不随分析口径切换 · 金额：万元 · 每股指标：元/股 · 比率见单位列</span>
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

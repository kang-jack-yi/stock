"use client";

import { useMemo, useState } from "react";
import { Segmented, Table } from "antd";
import type { EChartsCoreOption } from "echarts/core";
import { useMarketData } from "@/lib/api";
import type { Candle, MinuteDay, MinutePoint } from "@/lib/types";
import { compact, number } from "@/lib/format";
import { Chart } from "./chart";
import { useApp } from "./providers";
import { chartColors } from "@/lib/chart-theme";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";

/** 从未复权日线聚合周/月 OHLC；成交量相加，不修改源数据。 */
export function aggregateCandles(rows: Candle[], period: "week" | "month") {
  const result = new Map<string, Candle>();
  for (const row of rows) {
    const date = new Date(`${row.date.slice(0, 10)}T00:00:00Z`);
    if (period === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = period === "week" ? date.toISOString().slice(0, 10) : row.date.slice(0, 7);
    const current = result.get(key);
    if (!current) result.set(key, { ...row });
    else {
      current.close = row.close;
      current.high = Math.max(current.high, row.high);
      current.low = Math.min(current.low, row.low);
      current.volume += row.volume;
      current.date = row.date;
    }
  }
  return [...result.values()];
}
/** MA 使用完整窗口，前面不足窗口的点返回空值而非虚构均线。 */
function movingAverage(rows: Candle[], days: number) {
  return rows.map((_, i) =>
    i < days - 1
      ? null
      : rows.slice(i - days + 1, i + 1).reduce((total, row) => total + row.close, 0) / days,
  );
}
/** 分时与 K 线共用容器，数据按当前周期请求，保留失败和空数据状态。 */
export function StockChart({
  symbol,
  title = "行情走势",
  overview = false,
}: {
  symbol: string;
  title?: string;
  overview?: boolean;
}) {
  const { mode } = useApp();
  const [period, setPeriod] = useState("minute");
  const minute = period === "minute" || period === "five";
  const scale = ["5", "15", "30", "60"].includes(period) ? period : "240";
  const { data, error, isLoading, mutate } = useMarketData<MinuteDay[] | Candle[]>(
    `/api/market/${minute ? "minutes" : "candles"}?symbol=${symbol}${minute ? "" : `&scale=${scale}`}`,
  );
  const minuteDays = minute ? (data?.data as MinuteDay[] | undefined) : undefined;
  const selectedDays = useMemo(
    () => (period === "five" ? minuteDays : minuteDays?.slice(-1)),
    [period, minuteDays],
  );
  const minuteRows =
    selectedDays?.flatMap((day) =>
      day.points.map((point) => ({
        ...point,
        label: period === "five" ? `${day.date.slice(5)} ${point.time}` : point.time,
      })),
    ) || [];
  const candles = useMemo(
    () =>
      minute
        ? []
        : period === "week" || period === "month"
          ? aggregateCandles((data?.data as Candle[]) || [], period)
          : (data?.data as Candle[]) || [],
    [minute, period, data],
  );
  const latest = minute ? minuteRows.at(-1) : candles.at(-1);
  const option = useMemo<EChartsCoreOption>(() => {
    const palette = chartColors(mode);
    const { muted, grid, text: foreground } = palette;
    const axis = {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: grid, type: "dashed" as const } },
    };
    const points = selectedDays?.flatMap((day) => day.points) || [];
    const labels = minute
      ? selectedDays?.flatMap((day) =>
          day.points.map((p) => (period === "five" ? `${day.date.slice(5)} ${p.time}` : p.time)),
        ) || []
      : candles.map((row) => row.date);
    return {
      animation: false,
      aria: { enabled: true },
      color: [palette.blue, palette.amber, palette.violet],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", label: { precision: 2 } },
        confine: true,
        backgroundColor: palette.surface,
        textStyle: { color: foreground },
        borderColor: grid,
        // 仅格式化显示；空多维值保留为空，避免在 K 线标题后生成多余的缺失值行。
        valueFormatter: (value: unknown) =>
          Array.isArray(value)
            ? value.map((item) => number(typeof item === "number" ? item : null))
            : number(typeof value === "number" ? value : null),
      },
      legend: {
        data: minute ? ["价格", "均价"] : ["MA5", "MA10", "MA20"],
        top: 0,
        left: 8,
        textStyle: { color: muted, fontSize: 11 },
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 3,
      },
      grid: [
        { left: 62, right: 20, top: 40, height: "58%" },
        { left: 62, right: 20, top: "76%", height: "14%" },
      ],
      xAxis: [
        {
          ...axis,
          type: "category",
          data: labels,
          boundaryGap: !minute,
          axisLabel: { color: muted, show: false },
          splitLine: { show: false },
        },
        {
          ...axis,
          type: "category",
          gridIndex: 1,
          data: labels,
          boundaryGap: !minute,
          splitLine: { show: false },
          axisLabel: { color: muted, fontSize: 10, hideOverlap: true },
        },
      ],
      yAxis: [
        {
          ...axis,
          type: "value",
          scale: true,
          splitNumber: 4,
          axisLabel: { ...axis.axisLabel, formatter: (value: number) => number(value) },
        },
        {
          ...axis,
          type: "value",
          gridIndex: 1,
          splitNumber: 2,
          axisLabel: { color: muted, fontSize: 10, formatter: (n: number) => compact(n) },
        },
      ],
      dataZoom: minute ? [] : [{ type: "inside", xAxisIndex: [0, 1], start: 75, end: 100 }],
      series: minute
        ? [
            {
              name: "价格",
              type: "line",
              data: points.map((p) => p.price),
              showSymbol: false,
              lineStyle: { width: 1.6 },
              areaStyle: { color: palette.blue, opacity: 0.07 },
            },
            {
              name: "均价",
              type: "line",
              data: points.map((p) => p.average),
              showSymbol: false,
              lineStyle: { width: 1.3 },
            },
            {
              name: "成交量（股）",
              type: "bar",
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: points.map((p, i) => ({
                value: p.volume,
                itemStyle: {
                  color: i > 0 && p.price < points[i - 1].price ? palette.down : palette.up,
                  opacity: 0.65,
                },
              })),
            },
          ]
        : [
            {
              name: "K线",
              type: "candlestick",
              // K 线会自动添加首个时间维度；保留内部字段名，仅替换提示名称。
              dimensions: [
                { name: "base", displayName: "时间" },
                { name: "open", displayName: "开盘" },
                { name: "close", displayName: "收盘" },
                { name: "lowest", displayName: "最低" },
                { name: "highest", displayName: "最高" },
              ],
              encode: { tooltip: ["open", "close", "lowest", "highest"] },
              data: candles.map((c) => [c.open, c.close, c.low, c.high]),
              itemStyle: {
                color: palette.up,
                color0: palette.down,
                borderColor: palette.up,
                borderColor0: palette.down,
              },
            },
            ...[5, 10, 20].map((days) => ({
              name: `MA${days}`,
              type: "line",
              showSymbol: false,
              data: movingAverage(candles, days),
              lineStyle: { width: 1.1 },
            })),
            {
              name: "成交量（股）",
              type: "bar",
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: candles.map((c) => ({
                value: c.volume,
                itemStyle: { color: c.close >= c.open ? palette.up : palette.down, opacity: 0.65 },
              })),
            },
          ],
    };
  }, [mode, minute, period, selectedDays, candles]);
  const date = minute ? minuteDays?.at(-1)?.date : candles.at(-1)?.date;
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <span className="panel-caption">
            {minute ? "价格 · 均价 · 成交量" : "未复权价格 · 均线 · 成交量"}
          </span>
        </div>
        <div className="chart-controls">
          <Segmented
            value={period}
            onChange={(value) => setPeriod(String(value))}
            options={
              overview
                ? [
                    { label: "分时", value: "minute" },
                    { label: "日 K", value: "day" },
                  ]
                : [
                    { label: "分时", value: "minute" },
                    { label: "五日", value: "five" },
                    { label: "日 K", value: "day" },
                    { label: "周 K", value: "week" },
                    { label: "月 K", value: "month" },
                    { label: "5分", value: "5" },
                    { label: "15分", value: "15" },
                    { label: "30分", value: "30" },
                    { label: "60分", value: "60" },
                  ]
            }
          />
        </div>
      </div>
      {isLoading ? (
        <DataSkeleton rows={7} />
      ) : error ? (
        <DataError error={error} retry={mutate} />
      ) : !latest ? (
        <NoData />
      ) : (
        <>
          <Chart
            option={option}
            label={`${symbol} ${title}，最新价格 ${number(minute ? (latest as MinutePoint).price : (latest as Candle).close)}`}
            height={overview ? 330 : 390}
          />
          <details className="chart-table">
            <summary>查看图表数据</summary>
            <Table<Candle | (MinutePoint & { label: string })>
              size="small"
              rowKey={minute ? "label" : "date"}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 460 }}
              dataSource={minute ? [...minuteRows].reverse() : [...candles].reverse()}
              columns={
                minute
                  ? [
                      { title: "时间", dataIndex: "label" },
                      { title: "价格", dataIndex: "price", render: (n: number) => number(n) },
                      { title: "均价", dataIndex: "average", render: (n: number) => number(n) },
                      {
                        title: "成交量（股）",
                        dataIndex: "volume",
                        render: (n: number) => compact(n),
                      },
                    ]
                  : [
                      { title: "时间", dataIndex: "date" },
                      ...["open", "high", "low", "close"].map((key, i) => ({
                        title: ["开盘", "最高", "最低", "收盘"][i],
                        dataIndex: key,
                        render: (n: number) => number(n),
                      })),
                      {
                        title: "成交量（股）",
                        dataIndex: "volume",
                        render: (n: number) => compact(n),
                      },
                    ]
              }
            />
          </details>
        </>
      )}
      <DataMeta meta={data?.meta} date={date} />
    </section>
  );
}

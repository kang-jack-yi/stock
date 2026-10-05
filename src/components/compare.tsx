"use client";

import { AutoComplete, Button, Input, Segmented, Table, Tooltip } from "antd";
import { CloseOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { useMarketData } from "@/lib/api";
import type { ComparisonResult } from "@/lib/compare";
import type { SearchStock } from "@/lib/types";
import { compact, direction, exchange, number, percent } from "@/lib/format";
import { useApp } from "./providers";
import { chartColors } from "@/lib/chart-theme";
import { Chart } from "./chart";
import { DataError, DataMeta, DataSkeleton } from "./data-state";
import "./research-tools.css";

/** 比较工作台最多四条曲线，窗口与股票集合保存在 URL 中以便分享和回退。 */
export function Compare({ symbols, days }: { symbols: string[]; days: number }) {
  const router = useRouter(),
    { mode } = useApp();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const suggestions = useMarketData<SearchStock[]>(
    search ? `/api/market/search?q=${encodeURIComponent(search)}` : null,
    false,
  );
  const { data, error, isLoading, isValidating, mutate } = useMarketData<ComparisonResult>(
    `/api/compare?symbols=${symbols.join(",")}&days=${days}`,
    false,
  );
  /** 用经过验证的证券代码与枚举窗口更新站内比较路由。 */
  function update(next: string[], period = days) {
    router.replace(`/compare?symbols=${next.join(",")}&days=${period}`, { scroll: false });
    setQuery("");
    setSearch("");
  }
  const result = data?.data;
  const option = useMemo<EChartsCoreOption>(() => {
    const palette = chartColors(mode),
      { muted, grid: border } = palette;
    return {
      animation: false,
      aria: { enabled: true },
      color: [palette.blue, palette.amber, palette.violet, palette.down],
      tooltip: {
        trigger: "axis",
        confine: true,
        valueFormatter: (value: unknown) => `${number(Number(value))}%`,
        backgroundColor: palette.surface,
        borderColor: border,
        textStyle: { color: palette.text },
      },
      legend: {
        data: result?.series.map((series) => series.name),
        top: 0,
        textStyle: { color: muted },
        icon: "roundRect",
        itemHeight: 3,
      },
      grid: { left: 65, right: 24, top: 45, bottom: 40 },
      xAxis: {
        type: "category",
        data: result?.dates || [],
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: muted, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: muted, formatter: "{value}%" },
        splitLine: { lineStyle: { color: border, type: "dashed" } },
      },
      series:
        result?.series.map((series) => ({
          name: series.name,
          type: "line",
          showSymbol: false,
          data: series.returns,
          lineStyle: { width: 2 },
          emphasis: { focus: "series" },
        })) || [],
    };
  }, [result, mode]);
  const metrics = result
    ? [
        { title: "最新价", values: result.quotes.map((quote) => number(quote.price)) },
        { title: "今日涨跌幅", values: result.quotes.map((quote) => percent(quote.changePercent)) },
        { title: "总市值（元）", values: result.quotes.map((quote) => compact(quote.marketCap)) },
        { title: "PE TTM（倍）", values: result.quotes.map((quote) => number(quote.pe)) },
        { title: "市净率（倍）", values: result.quotes.map((quote) => number(quote.pb)) },
        {
          title: "换手率",
          values: result.quotes.map((quote) =>
            quote.turnover == null ? "—" : `${number(quote.turnover)}%`,
          ),
        },
        { title: "区间涨跌幅", values: result.series.map((series) => percent(series.totalReturn)) },
        {
          title: "区间最大回撤",
          values: result.series.map((series) => percent(series.maxDrawdown)),
        },
        {
          title: "区间日均成交量（股）",
          values: result.series.map((series) => compact(series.averageVolume)),
        },
      ]
    : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMPARE WORKSPACE</div>
          <h1>股票比较</h1>
          <p>相同的时间起点，看见不同公司的表现。</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()}>
          刷新数据
        </Button>
      </div>
      <div className="compare-toolbar">
        <AutoComplete
          virtual={false}
          className="compare-search"
          value={query}
          onChange={setQuery}
          onSelect={(symbol) => update([...symbols, symbol])}
          disabled={symbols.length >= 4}
          options={(suggestions.data?.data || [])
            .filter((stock) => !symbols.includes(stock.symbol))
            .map((stock) => ({ value: stock.symbol, label: `${stock.name} ${stock.code}` }))}
          notFoundContent={
            suggestions.isLoading
              ? "正在搜索…"
              : suggestions.error
                ? "搜索暂不可用"
                : "没有匹配证券"
          }
        >
          <Input
            prefix={<SearchOutlined />}
            aria-label="添加比较股票"
            placeholder={symbols.length >= 4 ? "最多同时比较 4 只" : "搜索并添加比较股票"}
            maxLength={40}
            allowClear
          />
        </AutoComplete>
        <Segmented
          value={days}
          onChange={(value) => update(symbols, Number(value))}
          options={[
            { label: "近 20 日", value: 20 },
            { label: "近 60 日", value: 60 },
            { label: "近 120 日", value: 120 },
            { label: "近 240 日", value: 240 },
          ]}
        />
      </div>
      {isLoading ? (
        <DataSkeleton rows={8} />
      ) : error ? (
        <DataError error={error} retry={mutate} />
      ) : (
        result && (
          <>
            <div className="compare-cards">
              {result.quotes.map((quote) => (
                <div className="panel compare-card" key={quote.symbol}>
                  <Tooltip title={symbols.length === 1 ? "至少保留一只股票" : "移除比较"}>
                    <Button
                      type="text"
                      size="small"
                      className="compare-remove"
                      aria-label={`移除比较 ${quote.symbol}`}
                      disabled={symbols.length === 1}
                      icon={<CloseOutlined />}
                      onClick={() => update(symbols.filter((symbol) => symbol !== quote.symbol))}
                    />
                  </Tooltip>
                  <Link href={`/stock/${quote.symbol}`}>{quote.name}</Link>
                  <span className="compare-symbol">
                    {quote.symbol.slice(2)}.{exchange(quote.symbol)}
                  </span>
                  <strong className={`numeric compare-price ${direction(quote.change)}`}>
                    {number(quote.price)}
                  </strong>
                  <span className={direction(quote.changePercent)}>
                    {percent(quote.changePercent)}
                  </span>
                  <p className="compare-date">
                    {quote.date} {quote.time}
                  </p>
                </div>
              ))}
              {symbols.length < 4 && (
                <button
                  className="panel compare-card compare-add"
                  onClick={() =>
                    document.querySelector<HTMLInputElement>('[aria-label="添加比较股票"]')?.focus()
                  }
                >
                  <PlusOutlined />
                  <span>添加比较</span>
                </button>
              )}
            </div>
            <section className="panel compare-panel">
              <div className="panel-heading">
                <div>
                  <h2>共同交易日走势</h2>
                  <span className="panel-caption">
                    以 {result.dates[0]} 收盘价为起点 0% · {result.dates.length} 个共同交易日
                  </span>
                </div>
              </div>
              <Chart
                option={option}
                label={`比较 ${result.series.map((series) => series.name).join("、")} 的共同交易日涨跌幅`}
                height={380}
              />
              <p className="table-note">
                未复权收盘价比较，除权除息会影响曲线。只使用所有证券均有有效报价的日期，不填补缺失交易日。
              </p>
              <details className="chart-table">
                <summary>查看比较图表数据</summary>
                <Table
                  rowKey="date"
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: 140 + 160 * result.series.length }}
                  dataSource={result.dates.map((date, i) => ({ date, index: i })).reverse()}
                  columns={[
                    { title: "日期", dataIndex: "date", width: 140, fixed: "left" },
                    ...result.series.map((series) => ({
                      title: series.name,
                      key: series.symbol,
                      width: 160,
                      align: "right" as const,
                      render: (_: unknown, row: { index: number }) => (
                        <span className="numeric">
                          {number(series.closes[row.index])} / {percent(series.returns[row.index])}
                        </span>
                      ),
                    })),
                  ]}
                />
              </details>
              <DataMeta meta={data?.meta} date={result.dates.at(-1)} />
            </section>
            <section className="panel compare-panel compare-metrics">
              <div className="panel-heading">
                <div>
                  <h2>指标对照</h2>
                  <span className="panel-caption">最新行情估值与所选区间表现分别列示</span>
                </div>
              </div>
              <Table
                rowKey="title"
                pagination={false}
                scroll={{ x: 140 + 150 * result.quotes.length }}
                dataSource={metrics}
                columns={[
                  { title: "指标", dataIndex: "title", width: 140, fixed: "left" },
                  ...result.quotes.map((quote, i) => ({
                    title: quote.name,
                    key: quote.symbol,
                    align: "right" as const,
                    width: 150,
                    render: (_: unknown, row: { values: string[] }) => (
                      <span className="numeric">{row.values[i]}</span>
                    ),
                  })),
                ]}
                size="small"
              />
              <p className="table-note">
                最大回撤按共同日期的收盘价计算，日均量按相同区间平均；指数没有市值与公司估值指标。
              </p>
            </section>
          </>
        )
      )}
    </>
  );
}

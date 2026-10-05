"use client";

import Link from "next/link";
import { Tabs, Button } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, SwapOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useMarketData } from "@/lib/api";
import type { Quote } from "@/lib/types";
import { compact, direction, exchange, isIndex, number, percent, signed } from "@/lib/format";
import { StockChart } from "./stock-chart";
import { FundsPanel } from "./funds-panel";
import { FinancialPanel } from "./financial-panel";
import { WatchButton } from "./watch-button";
import { DataError, DataMeta, DataSkeleton } from "./data-state";

/** 买卖各五档数量从股转换为手，条形长度表示同一盘口内相对数量。 */
function OrderBook({ quote }: { quote: Quote }) {
  const maximum = Math.max(
    ...quote.asks.map((level) => level.volume),
    ...quote.bids.map((level) => level.volume),
    1,
  );
  const buy = quote.bids.reduce((sum, row) => sum + row.volume, 0),
    sell = quote.asks.reduce((sum, row) => sum + row.volume, 0);
  const ratio = buy + sell > 0 ? ((buy - sell) / (buy + sell)) * 100 : null;
  const rows = [
    ...quote.asks
      .map((level, i) => ({ ...level, name: `卖${["一", "二", "三", "四", "五"][i]}`, sell: true }))
      .reverse(),
    ...quote.bids.map((level, i) => ({
      ...level,
      name: `买${["一", "二", "三", "四", "五"][i]}`,
      sell: false,
    })),
  ];
  return (
    <section className="panel order-book">
      <div className="panel-heading">
        <div>
          <h2>五档盘口</h2>
          <span className="panel-caption">买卖各五档 · 数量单位：手</span>
        </div>
        <span className="small-muted">1 手 = 100 股</span>
      </div>
      <div className="book-head">
        <span>档位</span>
        <span>价格（元）</span>
        <span>数量（手）</span>
      </div>
      {rows.map((row, i) => (
        <div key={row.name} className={`book-row ${i === 5 ? "buy-start" : ""}`}>
          <span className={row.sell ? "down" : "up"}>{row.name}</span>
          <strong className={`numeric ${direction((row.price || 0) - (quote.previousClose || 0))}`}>
            {number(row.price)}
          </strong>
          <span className="book-volume numeric">
            <i
              className={row.sell ? "ask" : "bid"}
              style={{ width: `${(row.volume / maximum) * 100}%` }}
            />
            <b>{number(row.volume / 100)}</b>
          </span>
        </div>
      ))}
      <div className="book-footer">
        <span>委比</span>
        <strong className={direction(ratio)}>{percent(ratio)}</strong>
        <span>委差</span>
        <strong className="numeric">{signed((buy - sell) / 100)} 手</strong>
      </div>
      <DataMeta
        date={`${quote.date} ${quote.time}`}
        meta={{ source: "新浪财经", fetchedAt: "", stale: false }}
      />
    </section>
  );
}
/** 详情页面通过 URL 保存当前标签，使资金和财务视图可以直接分享。 */
export function StockDetail({ symbol, view }: { symbol: string; view: string }) {
  const { data, error, isLoading, isValidating, mutate } = useMarketData<Quote[]>(
    `/api/market/quotes?symbols=${symbol}`,
  );
  const router = useRouter(),
    quote = data?.data[0],
    index = isIndex(symbol);
  if (isLoading) return <DataSkeleton rows={10} />;
  if (error || !quote)
    return <DataError error={error || new Error("未找到该股票行情")} retry={mutate} />;
  const metrics = [
    { label: "今开", value: number(quote.open) },
    { label: "最高", value: number(quote.high) },
    { label: "最低", value: number(quote.low) },
    { label: "昨收", value: number(quote.previousClose) },
    { label: "成交量", value: compact(quote.volume / 100, "手") },
    { label: "成交额", value: compact(quote.amount) },
    { label: "振幅", value: quote.amplitude == null ? "—" : `${number(quote.amplitude)}%` },
    { label: "换手率", value: quote.turnover == null ? "—" : `${number(quote.turnover)}%` },
    ...(!index
      ? [
          { label: "总市值", value: compact(quote.marketCap) },
          { label: "流通市值", value: compact(quote.floatCap) },
          { label: "PE TTM", value: number(quote.pe) },
          { label: "市净率", value: number(quote.pb) },
        ]
      : []),
  ];
  const tabs = [
    {
      key: "overview",
      label: "行情走势",
      children: (
        <div className={`detail-grid ${index ? "index-detail" : ""}`}>
          <StockChart symbol={symbol} />
          {!index && <OrderBook quote={quote} />}
        </div>
      ),
    },
    ...(!index
      ? [
          {
            key: "funds",
            label: "资金流向",
            children: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>资金流向分析</h2>
                  <span className="panel-caption">关注成交结构与资金变化</span>
                </div>
                <FundsPanel symbol={symbol} />
              </section>
            ),
          },
          {
            key: "financials",
            label: "财务报表",
            children: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>公司财务研究</h2>
                  <span className="panel-caption">三大报表与关键指标</span>
                </div>
                <FinancialPanel symbol={symbol} />
              </section>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <div className="breadcrumb">
        <Link href="/market">
          <ArrowLeftOutlined /> 股票排行
        </Link>
        <span>/</span>
        <span>{quote.name}</span>
      </div>
      <section className="panel quote-panel">
        <div className="quote-top">
          <div>
            <div className="quote-name">
              <h1>{quote.name}</h1>
              <span className="symbol-tag">
                {symbol.slice(2)}.{exchange(symbol)}
              </span>
              <span className="exchange-badge">{index ? "指数" : "A 股"}</span>
            </div>
            <div className="quote-time">
              {quote.date} {quote.time} · 行情快照
            </div>
          </div>
          <div className="heading-buttons">
            {!index && <WatchButton symbol={symbol} />}
            <Link href={`/compare?symbols=${symbol}${symbol === "sh000300" ? "" : ",sh000300"}`}>
              <Button
                aria-label="与沪深300比较走势"
                icon={<SwapOutlined />}
                title="与沪深300比较走势"
              />
            </Link>
            <Button
              icon={<ReloadOutlined />}
              loading={isValidating}
              onClick={() => mutate()}
              aria-label="刷新股票行情"
            />
          </div>
        </div>
        <div className="quote-price-row">
          <strong className={`quote-price numeric ${direction(quote.change)}`}>
            {number(quote.price)}
          </strong>
          <span className={`quote-change ${direction(quote.change)}`}>
            <b>{signed(quote.change)}</b>
            <b>{percent(quote.changePercent)}</b>
          </span>
          <span className="quote-currency">{index ? "点" : "CNY / 元"}</span>
        </div>
        <div className="quote-metrics">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong className="numeric">{metric.value}</strong>
            </div>
          ))}
        </div>
        <DataMeta meta={data?.meta} />
      </section>
      <Tabs
        className="detail-tabs"
        activeKey={view}
        onChange={(value) => router.replace(`/stock/${symbol}?view=${value}`, { scroll: false })}
        items={tabs}
        destroyOnHidden
      />
    </>
  );
}

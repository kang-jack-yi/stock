"use client";

import Link from "next/link";
import { Button, Segmented } from "antd";
import { ArrowRightOutlined, StarOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useMarketData } from "@/lib/api";
import { useWatchlist } from "@/lib/use-watchlist";
import type { MarketList, Quote } from "@/lib/types";
import { compact, direction, number, percent } from "@/lib/format";
import { useApp } from "./providers";
import { IndexCards } from "./index-cards";
import { StockChart } from "./stock-chart";
import { StockTable } from "./stock-table";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";
import { WatchButton } from "./watch-button";
import { MarketBreadth } from "./market-breadth";
import { News } from "./news";

/** 未登录时展示明确标注的热门公司；已登录时读取当前账号的自选。 */
function WatchPreview() {
  const { user } = useApp();
  const { data: watch } = useWatchlist(user?.id);
  const symbols = user
    ? watch?.symbols.slice(0, 5)
    : ["sh600519", "sz300750", "sh601318", "sz000001"];
  const { data, isLoading, error, mutate } = useMarketData<Quote[]>(
    symbols?.length ? `/api/market/quotes?symbols=${symbols.join(",")}` : null,
  );
  return (
    <section className="panel watch-preview">
      <div className="panel-heading">
        <div>
          <h2>{user ? "我的自选" : "关注热门公司"}</h2>
          <span className="panel-caption">
            {user ? "与你的账号保持同步" : "从熟悉的公司开始探索"}
          </span>
        </div>
        <StarOutlined className="panel-heading-icon" />
      </div>
      {isLoading || (user && !watch) ? (
        <DataSkeleton rows={4} />
      ) : error ? (
        <DataError error={error} retry={mutate} />
      ) : !symbols?.length ? (
        <NoData text="还没有自选股，搜索股票后点击加入自选" />
      ) : (
        <div className="watch-list">
          {data?.data.map((row) => (
            <div className="watch-row" key={row.symbol}>
              <Link href={`/stock/${row.symbol}`} className="stock-name">
                <strong>{row.name}</strong>
                <span>{row.symbol.slice(2)}</span>
              </Link>
              <div className="watch-price">
                <strong className={`numeric ${direction(row.change)}`}>{number(row.price)}</strong>
                <span className={direction(row.change)}>{percent(row.changePercent)}</span>
              </div>
              <WatchButton symbol={row.symbol} compact />
            </div>
          ))}
        </div>
      )}
      <div className="watch-preview-footer">
        <Link href={user ? "/watchlist" : "/login?next=/watchlist"}>
          <Button block type="default">
            {user ? "查看全部自选" : "登录创建你的自选"}
            <ArrowRightOutlined />
          </Button>
        </Link>
      </div>
    </section>
  );
}
/** 市场总览将指数、走势图、关注公司和涨跌榜组合为独立数据模块。 */
export function Overview() {
  const [ranking, setRanking] = useState("up");
  const { data, error, isLoading, mutate } = useMarketData<MarketList>(
    `/api/market/list?node=hs_a&sort=${ranking === "active" ? "amount" : "changepercent"}&asc=${ranking === "down" ? "1" : "0"}&page=1`,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MARKET OVERVIEW</div>
          <h1>
            市场总览
            <span className="heading-dot" />
          </h1>
          <p>每一次波动，都值得更清晰地看见。</p>
        </div>
        <div className="page-heading-extra">
          <span className="snapshot-label">A 股市场</span>
          <span className="small-muted">价格以行情数据时间为准</span>
        </div>
      </div>
      <IndexCards />
      <MarketBreadth />
      <div className="overview-grid">
        <StockChart symbol="sh000001" title="上证指数走势" overview />
        <WatchPreview />
      </div>
      <News compact />
      <section className="panel ranking-panel">
        <div className="panel-heading">
          <div>
            <h2>市场风向</h2>
            <span className="panel-caption">
              {data
                ? `${data.data.total.toLocaleString()} 只 A 股 · ${compact(data.data.stocks.slice(0, 8).reduce((sum, row) => sum + row.amount, 0))}榜单成交额`
                : "发现市场的活跃力量"}
            </span>
          </div>
          <div className="ranking-actions">
            <Segmented
              value={ranking}
              onChange={(value) => setRanking(String(value))}
              options={[
                { label: "涨幅榜", value: "up" },
                { label: "跌幅榜", value: "down" },
                { label: "成交额", value: "active" },
              ]}
            />
            <Link href="/market" className="text-link">
              全部股票 <ArrowRightOutlined />
            </Link>
          </div>
        </div>
        {error && !data ? (
          <DataError error={error} retry={mutate} />
        ) : (
          <StockTable rows={data?.data.stocks.slice(0, 8) || []} loading={isLoading} />
        )}
        <DataMeta meta={data?.meta} date={data?.data.stocks[0]?.time} />
      </section>
    </>
  );
}

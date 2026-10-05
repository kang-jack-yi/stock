"use client";

import { Button, App } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMarketData } from "@/lib/api";
import { useWatchlist } from "@/lib/use-watchlist";
import { useApp } from "./providers";
import type { Quote } from "@/lib/types";
import { StockSearch } from "./search";
import { StockTable } from "./stock-table";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";

/** 自选页面只请求账号持有的股票代码，缓存按账号切换时重新验证。 */
export function Watchlist() {
  const { user } = useApp();
  const { data: watch, error: watchError, mutate: refreshWatch } = useWatchlist(user?.id);
  const { data, error, isLoading, isValidating, mutate } = useMarketData<Quote[]>(
    watch?.symbols.length ? `/api/market/quotes?symbols=${watch.symbols.join(",")}` : null,
  );
  const { message } = App.useApp();
  const rows =
    watch?.symbols.flatMap((symbol) => data?.data.filter((row) => row.symbol === symbol) || []) ||
    [];
  /** CSV 来自当前真实行情；股票名称加引号并防止电子表格公式注入。 */
  function exportCsv() {
    if (!rows.length) {
      message.info("暂无可导出的自选行情");
      return;
    }
    const safe = (value: unknown) =>
      `"${String(value ?? "")
        .replace(/^[=+\-@]/, "'$&")
        .replace(/"/g, '""')}"`;
    const csv = [
      "代码,名称,最新价,涨跌幅(%),成交量(股),成交额(元),行情时间",
      ...rows.map((row) =>
        [
          row.symbol,
          row.name,
          row.price,
          row.changePercent,
          row.volume,
          row.amount,
          `${row.date} ${row.time}`,
        ]
          .map(safe)
          .join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "观澜-自选行情.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WATCHLIST</div>
          <h1>
            我的自选<span className="count-badge">{watch?.symbols.length || 0}</span>
          </h1>
          <p>关注的公司，在这里与你保持同步。</p>
        </div>
        <div className="heading-buttons">
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>
            导出行情
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={isValidating}
            onClick={() => {
              refreshWatch();
              mutate();
            }}
          >
            刷新
          </Button>
        </div>
      </div>
      <div className="watchlist-search panel">
        <div>
          <h2>下一家值得关注的公司</h2>
          <p>搜索股票，在详情页点击「加入自选」。</p>
        </div>
        <StockSearch large />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>自选行情</h2>
          <span className="panel-caption">红涨绿跌 · 每个账号独立保存</span>
        </div>
        {watchError ? (
          <DataError error={watchError} retry={refreshWatch} />
        ) : !watch ? (
          <DataSkeleton />
        ) : watch.symbols.length === 0 ? (
          <NoData text="自选列表还是空的，搜索你关注的第一只股票吧" />
        ) : error ? (
          <DataError error={error} retry={mutate} />
        ) : (
          <StockTable rows={rows} loading={isLoading} sortLocal />
        )}
        <DataMeta
          meta={data?.meta}
          date={data?.data[0] ? `${data.data[0].date} ${data.data[0].time}` : undefined}
        />
      </section>
    </>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Alert, App, Button, Collapse, Select, Table, Tabs, Tag } from "antd";
import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useApp } from "./providers";
import { fetchJson } from "@/lib/api";
import { compact, direction, number, percent, signed } from "@/lib/format";
import type { MarketStock } from "@/lib/types";
import type { ReviewSecurity, ReviewSectorChange, ReviewsResult } from "@/lib/review-types";
import { DataError, DataSkeleton, NoData } from "./data-state";
import "./daily-review.css";

/** 保存和源数据获取时间统一显示中国标准时间。 */
function reviewTime(value: string | number) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

/** 完整证券集合独立分页，分页不会缩小新增和退出的统计范围。 */
function SecurityList({
  stocks,
}: {
  /** 完整符合条件、新增或退出的证券。 */
  stocks: ReviewSecurity[];
}) {
  return stocks.length ? (
    <Table<ReviewSecurity>
      size="small"
      rowKey="symbol"
      dataSource={stocks}
      pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
      columns={[
        {
          title: "股票名称",
          dataIndex: "name",
          render: (name: string, stock) => <Link href={`/stock/${stock.symbol}`}>{name}</Link>,
        },
        { title: "证券代码", dataIndex: "symbol" },
      ]}
    />
  ) : (
    <NoData text="此集合暂无证券" />
  );
}

/** 切换会话账号时重建工作台，清除前一个账号的日期选择和保存状态。 */
export function DailyReview() {
  const { user } = useApp();
  return user ? (
    <ReviewWorkspace key={user.id} userId={user.id} />
  ) : (
    <section className="panel review-history">
      <div className="panel-heading">
        <div>
          <h1>每日复盘</h1>
          <span className="panel-caption">个人历史仅当前账号可见</span>
        </div>
      </div>
      <p className="review-summary">
        <Link className="text-link" href="/login?next=%2Freview">
          登录账号
        </Link>
        后查看已保存的收盘复盘。
      </p>
    </section>
  );
}

/** 账户复盘工作台，真实空状态、日终冻结内容与相邻可用快照对比。 */
function ReviewWorkspace({
  userId,
}: {
  /** 当前会话账号编号，仅用于隔离前端缓存，不向接口传递账号身份。 */
  userId: string;
}) {
  const { message } = App.useApp();
  const [date, setDate] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const url = `/api/reviews${date ? `?date=${date}` : ""}`;
  const { data, error, mutate } = useSWR<ReviewsResult>(
    [url, userId],
    ([requestUrl]: [string, string]) => fetchJson(requestUrl),
    { refreshInterval: 30000, revalidateOnFocus: false },
  );
  /** 客户端只发送采集意图，由服务端验证交易日和完整数据后入库。 */
  async function capture() {
    setSaving(true);
    try {
      const result = await fetchJson<{ date: string; message: string }>("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setDate(undefined);
      await mutate();
      message.success(result.message);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const review = data?.review;
  const market = data?.market;
  const watchColumns = [
    {
      title: "股票",
      dataIndex: "name",
      render: (name: string, stock: MarketStock) => (
        <Link href={`/stock/${stock.symbol}`}>
          {name}
          <small className="review-stock-code">{stock.symbol}</small>
        </Link>
      ),
    },
    {
      title: "收盘价",
      dataIndex: "price",
      align: "right" as const,
      render: (value: number | null) => number(value),
    },
    {
      title: "当日涨跌",
      dataIndex: "changePercent",
      align: "right" as const,
      render: (value: number | null) => <span className={direction(value)}>{percent(value)}</span>,
    },
    {
      title: "成交额",
      dataIndex: "amount",
      align: "right" as const,
      render: (value: number) => compact(value),
    },
  ];
  const sectorColumns = [
    {
      title: "板块",
      dataIndex: "name",
      render: (name: string, row: ReviewSectorChange) => (
        <span>
          {name}
          <small className="review-stock-code">{row.kind === "industry" ? "行业" : "概念"}</small>
        </span>
      ),
    },
    {
      title: "当日样本涨幅",
      dataIndex: "changePercent",
      align: "right" as const,
      render: (value: number | null) => <span className={direction(value)}>{percent(value)}</span>,
    },
    {
      title: "基线样本涨幅",
      dataIndex: "previousChangePercent",
      align: "right" as const,
      render: (value: number | null) => percent(value),
    },
    {
      title: "差值（百分点）",
      dataIndex: "difference",
      align: "right" as const,
      render: (value: number | null) => <span className={direction(value)}>{signed(value)}</span>,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DAILY REVIEW</div>
          <h1>每日复盘</h1>
          <p>保存真实收盘，回看关注列表与研究条件的变化。</p>
        </div>
        <div className="review-heading-actions">
          <Button icon={<ReloadOutlined />} onClick={() => mutate()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!data?.canCapture || saving}
            onClick={capture}
          >
            保存当日收盘
          </Button>
        </div>
      </div>
      {error ? (
        <DataError error={error} retry={mutate} />
      ) : !data ? (
        <DataSkeleton />
      ) : (
        <>
          <Alert
            showIcon
            type={data.workerRunning ? "info" : "warning"}
            title={`${data.captureLabel} · ${data.workerRunning ? "自动采集运行中" : "自动采集未运行"}`}
            description={
              data.workerRunning
                ? data.workerMessage
                : "收盘采集需要每日后台进程保持运行，也可在交易日 15:05 后手动保存。仅保留最近 120 个已采集交易日，不补造启动前历史。"
            }
          />
          <section className="panel review-history">
            <div className="panel-heading">
              <div>
                <h2>已保存的复盘</h2>
                <span className="panel-caption">每账号独立 · 关注列表与方案在采集时冻结</span>
              </div>
              <Select
                aria-label="复盘日期"
                className="review-date"
                value={data.selectedDate ?? undefined}
                placeholder="暂无已保存日期"
                disabled={!data.dates.length}
                options={data.dates.map((value) => ({ value, label: value }))}
                onChange={setDate}
              />
            </div>
            {!review || !market ? (
              <NoData text="暂无收盘快照，从今天开始积累" />
            ) : (
              <div className="review-summary">
                <div className="review-comparison">
                  {data.previousDate
                    ? `对比相邻可用快照 ${data.previousDate} → ${review.date}；未采集日期不作为连续交易日历史。`
                    : "暂无基线，从这份快照开始积累变化。"}
                </div>
                <div className="review-stats">
                  <div>
                    <span>当日自选</span>
                    <strong>{review.watchlist.length}</strong>
                    <small>{review.unavailable.length} 只未参与统计</small>
                  </div>
                  <div>
                    <span>市场上涨 / 下跌</span>
                    <strong>
                      <span className="up">{market.breadth.advancing}</span> /{" "}
                      <span className="down">{market.breadth.declining}</span>
                    </strong>
                    <small>当日验证证券 {market.verifiedTotal} 只</small>
                  </div>
                  <div>
                    <span>已保存方案</span>
                    <strong>{review.screeners.length}</strong>
                    <small>记录全部匹配证券</small>
                  </div>
                  <div>
                    <span>当日提醒</span>
                    <strong>{review.alerts.length}</strong>
                    <small>按实际行情日期归档</small>
                  </div>
                </div>
                <p className="small-muted">
                  源 A 股目录 {market.sourceTotal} 只；逐股验证有效 {market.verifiedTotal}{" "}
                  只，无法确认日期、停牌或缺失 {market.excludedTotal} 只。筛选仅覆盖当日验证集合。
                </p>
                <p className="small-muted">
                  实际交易日 {market.date} · 排行获取 {reviewTime(market.marketFetchedAt)} ·
                  全部验证完成 {reviewTime(market.fetchedAt)} · 个人内容冻结{" "}
                  {reviewTime(review.savedAt)}
                </p>
              </div>
            )}
          </section>
          {review && market && (
            <>
              <section className="panel review-watchlist">
                <div className="panel-heading">
                  <div>
                    <h2>自选收盘表现</h2>
                    <span className="panel-caption">采集时的关注列表；缺失行情不会当成零涨跌</span>
                  </div>
                </div>
                <div className="review-body">
                  {review.watchlist.length ? (
                    <Table<MarketStock>
                      size="small"
                      rowKey="symbol"
                      columns={watchColumns}
                      dataSource={review.watchlist}
                      scroll={{ x: 540 }}
                      pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                    />
                  ) : (
                    <NoData text="这份快照没有可验证收盘的自选股" />
                  )}
                  {!!review.unavailable.length && (
                    <Collapse
                      items={[
                        {
                          key: "unavailable",
                          label: `未参与统计的关注证券（${review.unavailable.length}）`,
                          children: (
                            <ul className="review-excluded">
                              {review.unavailable.map((stock) => (
                                <li key={stock.symbol}>
                                  <Link href={`/stock/${stock.symbol}`}>{stock.name}</Link> ·{" "}
                                  {stock.reason}
                                </li>
                              ))}
                            </ul>
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              </section>
              <section className="panel review-screeners">
                <div className="panel-heading">
                  <div>
                    <h2>选股结果变化</h2>
                    <span className="panel-caption">
                      同方案、同条件才比较；排序和分页不影响结果集合
                    </span>
                  </div>
                </div>
                <div className="review-body">
                  {!data.screeners.length ? (
                    <NoData text="采集时没有保存的选股方案" />
                  ) : (
                    <Collapse
                      items={data.screeners.map((scheme) => ({
                        key: scheme.id,
                        label: (
                          <div className="review-scheme-label">
                            <strong>{scheme.name}</strong>
                            <Tag>{scheme.matches.length} 只符合</Tag>
                            {scheme.hasBaseline && (
                              <>
                                <Tag color="green">新增 {scheme.added.length}</Tag>
                                <Tag color="orange">退出 {scheme.removed.length}</Tag>
                              </>
                            )}
                          </div>
                        ),
                        children: (
                          <>
                            <p className="review-baseline">{scheme.baselineLabel}</p>
                            {!!scheme.unverifiable.length && (
                              <p className="review-baseline">
                                {scheme.unverifiable.length}{" "}
                                只证券任一日期行情不可验证，单列待核实，不计为新增或退出。
                              </p>
                            )}
                            <Tabs
                              items={[
                                {
                                  key: "all",
                                  label: `当日全部 ${scheme.matches.length}`,
                                  children: <SecurityList stocks={scheme.matches} />,
                                },
                                ...(scheme.hasBaseline
                                  ? [
                                      {
                                        key: "added",
                                        label: `新增 ${scheme.added.length}`,
                                        children: <SecurityList stocks={scheme.added} />,
                                      },
                                      {
                                        key: "removed",
                                        label: `退出 ${scheme.removed.length}`,
                                        children: <SecurityList stocks={scheme.removed} />,
                                      },
                                    ]
                                  : []),
                                ...(scheme.unverifiable.length
                                  ? [
                                      {
                                        key: "unverifiable",
                                        label: `待核实 ${scheme.unverifiable.length}`,
                                        children: <SecurityList stocks={scheme.unverifiable} />,
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </>
                        ),
                      }))}
                    />
                  )}
                </div>
              </section>
              <section className="panel review-sectors">
                <div className="panel-heading">
                  <div>
                    <h2>板块样本变化</h2>
                    <span className="panel-caption">
                      收盘后采集的源汇总样本 · 部分概念最多 100 只 · 非交易所全量指数
                    </span>
                  </div>
                </div>
                <div className="review-body">
                  <p className="review-baseline">
                    行业获取 {reviewTime(market.sectorFetchedAt[0])} · 概念获取{" "}
                    {reviewTime(market.sectorFetchedAt[1])}
                    。源汇总无逐板块交易日期，归属本次收盘采集时点。
                  </p>
                  <Table<ReviewSectorChange>
                    size="small"
                    rowKey={(row) => `${row.kind}:${row.id}`}
                    columns={sectorColumns}
                    dataSource={data.sectors}
                    scroll={{ x: 650 }}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                  />
                </div>
              </section>
              <section className="panel review-alerts">
                <div className="panel-heading">
                  <div>
                    <h2>当日提醒记录</h2>
                    <span className="panel-caption">归档记录；之后删除规则不会改变这份复盘</span>
                  </div>
                </div>
                <div className="review-body">
                  {!review.alerts.length ? (
                    <NoData text="当日没有触发的提醒" />
                  ) : (
                    <div className="review-alert-list">
                      {review.alerts.map((event) => (
                        <article key={event.id}>
                          <Link href={`/stock/${event.symbol}`}>{event.name}</Link>
                          <p>
                            {event.metric === "price" ? "价格" : "涨跌幅"}
                            {event.direction === "above" ? "上穿" : "下穿"}{" "}
                            {number(event.threshold)}
                            {event.metric === "price" ? " 元/点" : "%"}，实际 {number(event.value)}
                            {event.metric === "price" ? " 元/点" : "%"}
                          </p>
                          <span className="small-muted">{reviewTime(event.quoteAt)}</span>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

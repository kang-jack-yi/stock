"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, App, Button, Pagination, Select, Tag } from "antd";
import {
  CheckOutlined,
  ExportOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/lib/api";
import {
  intelligenceKinds,
  type IntelligenceItem,
  type IntelligenceQuery,
  type IntelligenceResult,
} from "@/lib/intelligence-types";
import { useApp } from "./providers";
import { DataError, DataSkeleton, NoData } from "./data-state";
import "./intelligence.css";

/** 切换账号重建筛选及操作状态，登录前不读取旧账号情报缓存。 */
export function Intelligence() {
  const { user } = useApp();
  return user ? (
    <IntelligenceWorkspace key={user.id} userId={user.id} />
  ) : (
    <section className="panel">
      <NoData text="请登录后查看关注情报" />
      <Link href="/login?next=%2Fintelligence">登录账号</Link>
    </section>
  );
}

/** 日期精度不足时只显示披露/收盘日期，其余按中国标准时间展示。 */
function entryTime(item: IntelligenceItem) {
  if (item.occurredAt.length === 10) return `${item.occurredAt}（收盘日）`;
  const date = new Date(item.occurredAt);
  return item.dateOnly
    ? date.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

/** 一次聚合一只股票，已读与收藏写入服务端；局部故障始终展示来源覆盖信息。 */
function IntelligenceWorkspace({
  userId,
}: {
  /** 会话账号编号，仅用于隔离前端缓存，不传给个人数据接口。 */
  userId: string;
}) {
  const { message } = App.useApp();
  const [query, setQuery] = useState<IntelligenceQuery>({
    symbol: "",
    kind: "all",
    state: "all",
    page: 1,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const params = new URLSearchParams({ ...query, page: String(query.page) });
  const { data, error, isLoading, isValidating, mutate } = useSWR<IntelligenceResult>(
    [`/api/intelligence?${params}`, userId],
    ([url]: [string, string]) => fetchJson(url),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  /** 改变筛选先回第一页，避免原页码超出新筛选集合。 */
  function filter(change: Partial<IntelligenceQuery>) {
    setQuery((previous) => ({ ...previous, ...change, page: 1 }));
  }

  /** 仅传稳定编号与个人状态；操作成功后按新筛选重读，删掉末页最后一条时回第一页。 */
  async function update(item: IntelligenceItem, action: "read" | "saved", value: boolean) {
    setBusy(item.id);
    try {
      await fetchJson("/api/intelligence", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, action, value }),
      });
      if (
        query.page > 1 &&
        ((query.state === "unread" && action === "read" && value) ||
          (query.state === "saved" && action === "saved" && !value))
      )
        filter({});
      else await mutate();
      message.success(
        action === "read" ? (value ? "已标为已读" : "已标为未读") : value ? "已收藏" : "已取消收藏",
      );
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "情报状态修改失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FOLLOWED INTELLIGENCE</div>
          <h1>关注情报</h1>
          <p>把关注股票的公告、标题关联资讯与个人触发记录放在一起。</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()}>
          重新加载
        </Button>
      </div>
      <section className="panel intelligence-panel">
        <div className="intelligence-filters">
          <Select
            aria-label="情报股票"
            value={query.symbol || (query.state === "saved" ? "" : data?.query.symbol || "")}
            placeholder="选择关注股票"
            showSearch
            optionFilterProp="label"
            onChange={(symbol) => filter({ symbol })}
            options={[
              { value: "", label: query.state === "saved" ? "全部收藏股票" : "自动选择关注股票" },
              ...[
                ...new Set([
                  ...(data?.symbols || []),
                  ...(query.state === "saved" ? data?.savedSymbols || [] : []),
                ]),
              ].map((symbol) => ({
                value: symbol,
                label:
                  symbol === data?.query.symbol && data.selectedName
                    ? `${data.selectedName} · ${symbol}`
                    : symbol,
              })),
            ]}
          />
          <Select
            aria-label="情报类型"
            value={query.kind}
            onChange={(kind) => filter({ kind })}
            options={Object.entries(intelligenceKinds).map(([value, label]) => ({ value, label }))}
          />
          <Select
            aria-label="阅读收藏状态"
            value={query.state}
            onChange={(state) =>
              filter({
                state,
                symbol:
                  state === "saved" || !data?.symbols.includes(query.symbol) ? "" : query.symbol,
              })
            }
            options={[
              { value: "all", label: "全部状态" },
              { value: "unread", label: "仅未读" },
              { value: "saved", label: "我的收藏" },
            ]}
          />
        </div>
        <p className="intelligence-scope">
          每次只加载一只自选或现持仓股票的最近30日公告及触发记录，资讯最多检查最近100条股市标题。列表包含此前保留的公开标题；本次源覆盖与失败见下方。收藏不受30日限制，最多500条，不保存原文全文。情报阅读状态独立于原提醒模块。
        </p>
        {data?.query.symbol && (
          <div className="intelligence-security">
            <h2>{data.selectedName || "证券名称暂缺"}</h2>
            <Link href={`/stock/${data.query.symbol}`}>{data.query.symbol} · 行情详情</Link>
          </div>
        )}
        {error ? (
          <div>
            <DataError error={error} retry={() => mutate()} />
            {query.page > 1 && <Button onClick={() => filter({})}>返回第一页</Button>}
          </div>
        ) : isLoading ? (
          <DataSkeleton rows={6} />
        ) : data ? (
          <>
            {data.coverage.length > 0 && (
              <div className="intelligence-coverage">
                {data.coverage.map((source) => (
                  <Alert
                    key={source.label}
                    type={source.status === "ok" ? "info" : "warning"}
                    showIcon
                    title={`${source.label} · ${source.count}条`}
                    description={source.message}
                  />
                ))}
              </div>
            )}
            {query.state === "saved" && (
              <Alert
                className="intelligence-archive"
                type="info"
                showIcon
                title="收藏保留公开标题与原文链接"
                description="移出自选、清仓或来源移除后仍保留收藏快照；上游原文可能失效，请自行核对。"
              />
            )}
            {!data.items.length ? (
              <NoData
                text={
                  !data.symbols.length && query.state !== "saved"
                    ? "添加自选股或记录持仓后，再查看关注情报"
                    : "当前筛选下没有情报"
                }
              />
            ) : (
              <div className="intelligence-list">
                {data.items.map((item) => (
                  <article
                    className={`intelligence-item${item.read ? " is-read" : ""}`}
                    key={item.id}
                  >
                    <div className="intelligence-item-meta">
                      <Tag>{intelligenceKinds[item.kind]}</Tag>
                      <Link href={`/stock/${item.symbol}`}>
                        {item.name} · {item.symbol}
                      </Link>
                      <time>{entryTime(item)}</time>
                      {!item.read && <Tag color="blue">未读</Tag>}
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.association}</p>
                    <div className="intelligence-item-actions">
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <Button icon={<ExportOutlined />}>查看原文</Button>
                        </a>
                      )}
                      <Button
                        icon={<CheckOutlined />}
                        loading={busy === item.id}
                        disabled={busy !== null && busy !== item.id}
                        onClick={() => update(item, "read", !item.read)}
                      >
                        {item.read ? "标为未读" : "标为已读"}
                      </Button>
                      <Button
                        icon={item.saved ? <StarFilled /> : <StarOutlined />}
                        disabled={busy !== null}
                        onClick={() => update(item, "saved", !item.saved)}
                      >
                        {item.saved ? "取消收藏" : "收藏"}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {data.total > 0 && (
              <Pagination
                className="intelligence-pagination"
                current={query.page}
                total={data.total}
                pageSize={20}
                showSizeChanger={false}
                showTotal={(total) => `共${total}条`}
                onChange={(page) => setQuery((previous) => ({ ...previous, page }))}
              />
            )}
          </>
        ) : null}
      </section>
    </>
  );
}

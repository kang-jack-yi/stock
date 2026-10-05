"use client";

import { Button, Grid, Pagination, Segmented, Tag } from "antd";
import { ArrowUpOutlined, ReloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMarketData } from "@/lib/api";
import type { NewsResult } from "@/lib/news";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";
import "./research-tools.css";

/** 新闻时间使用上海时区，跨日记录明确显示日期而不只显示小时。 */
function newsTime(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));
}

/** 新浪财经资讯列表，分类分页可分享，原文在新标签打开。 */
export function News({
  category = "stocks",
  page = 1,
  compact = false,
}: {
  category?: string;
  page?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const { data, error, isLoading, isValidating, mutate } = useMarketData<NewsResult>(
    `/api/news?category=${category}&page=${page}`,
  );
  /** 分类切换回到第一页，分页保留原来的分类。 */
  function navigate(kind: string, next = 1) {
    router.replace(`/news?category=${kind}&page=${next}`, { scroll: false });
  }
  const items = compact ? data?.data.items.slice(0, 5) : data?.data.items;
  return (
    <>
      {!compact && (
        <div className="page-heading">
          <div>
            <div className="eyebrow">MARKET NEWS</div>
            <h1>财经资讯</h1>
            <p>市场变化之外，关注正在发生的事。</p>
          </div>
          <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()}>
            刷新资讯
          </Button>
        </div>
      )}
      <section className="panel news-panel">
        <div className="panel-heading">
          <div>
            <h2>{compact ? "市场资讯" : "滚动资讯"}</h2>
            <span className="panel-caption">标题与原文 · 中国标准时间</span>
          </div>
          {compact ? (
            <Link href="/news" className="text-link">
              全部资讯 →
            </Link>
          ) : (
            <Segmented
              aria-label="资讯分类"
              value={category}
              onChange={(value) => navigate(String(value))}
              options={[
                { label: "股市", value: "stocks" },
                { label: "财经", value: "finance" },
                { label: "环球", value: "world" },
              ]}
            />
          )}
        </div>
        {isLoading ? (
          <DataSkeleton rows={compact ? 3 : 8} />
        ) : error ? (
          <DataError error={error} retry={mutate} />
        ) : !items?.length ? (
          <NoData text="暂无可展示的资讯" />
        ) : (
          <div className="news-list">
            {items.map((item) => (
              <a
                href={item.url}
                key={item.id}
                className="news-row"
                target="_blank"
                rel="noreferrer"
              >
                <time dateTime={item.publishedAt}>{newsTime(item.publishedAt)}</time>
                <div>
                  <strong>{item.title}</strong>
                  {!item.source.includes("新浪") && <span>{item.source}</span>}
                </div>
                <ArrowUpOutlined rotate={45} aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
        {!compact && (
          <div className="news-pagination">
            <Tag>仅展示标题，阅读全文前往原文</Tag>
            <Pagination
              simple={!screens.sm ? { readOnly: true } : false}
              current={page}
              total={Math.min(data?.data.total || 0, 2000)}
              pageSize={20}
              showSizeChanger={false}
              onChange={(value) => navigate(category, value)}
            />
          </div>
        )}
        <DataMeta meta={data?.meta} />
      </section>
    </>
  );
}

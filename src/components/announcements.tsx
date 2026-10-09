"use client";

import { useState } from "react";
import { Button, Form, Grid, Input, Pagination, Select, Tag } from "antd";
import { ArrowUpOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMarketData } from "@/lib/api";
import { defaultAnnouncementRange } from "@/lib/announcement-parse";
import {
  announcementCategories,
  type AnnouncementQuery,
  type AnnouncementResult,
} from "@/lib/announcement-types";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";
import "./announcements.css";

/** 公告只具备披露日期时不虚构时刻；有真实时刻时展示中国标准时间。 */
function announcementTime(item: AnnouncementResult["items"][number]) {
  return item.hasTime
    ? `${item.publishedDate} ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(item.publishedAt))}`
    : item.publishedDate;
}

/** 个股公告和事件时间线，按标题归类并只链接公开 PDF 原文。 */
export function Announcements({ symbol }: { symbol: string }) {
  const [query, setQuery] = useState<AnnouncementQuery>(() => ({
    symbol,
    keyword: "",
    category: "all",
    ...defaultAnnouncementRange(),
    page: 1,
  }));
  const screens = Grid.useBreakpoint();
  const params = new URLSearchParams({ ...query, symbol, page: String(query.page) });
  const { data, error, isLoading, isValidating, mutate } = useMarketData<AnnouncementResult>(
    `/api/announcements?${params}`,
    false,
  );
  /** 提交查询时重置页码；输入中不自动覆盖当前筛选结果。 */
  function apply(values: Omit<AnnouncementQuery, "symbol" | "page">) {
    setQuery({ ...values, keyword: values.keyword?.trim() || "", symbol, page: 1 });
  }
  return (
    <section className="panel announcements-panel">
      <div className="panel-heading">
        <div>
          <h2>公告与事件</h2>
          <span className="panel-caption">公开披露 · 中国标准时间 · 按标题分类</span>
        </div>
        <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()}>
          刷新公告
        </Button>
      </div>
      <Form
        className="announcements-filter"
        layout="vertical"
        initialValues={query}
        onFinish={apply}
      >
        <Form.Item name="keyword" label="标题关键词">
          <Input
            aria-label="公告标题关键词"
            maxLength={40}
            allowClear
            placeholder="如：年度报告、权益分派"
          />
        </Form.Item>
        <Form.Item name="category" label="事件分类">
          <Select
            aria-label="公告事件分类"
            options={Object.entries(announcementCategories).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="start"
          label="开始日期"
          rules={[{ required: true, message: "请选择开始日期" }]}
        >
          <Input aria-label="公告开始日期" type="date" />
        </Form.Item>
        <Form.Item
          name="end"
          label="结束日期"
          rules={[{ required: true, message: "请选择结束日期" }]}
        >
          <Input aria-label="公告结束日期" type="date" />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          查询公告
        </Button>
      </Form>
      <p className="announcements-note">
        分类依据标题推断；披露日期不等于分红、回购等事件的执行日期。仅展示标题和元数据，详情请查看原文。每次最多查询
        366 天。
      </p>
      {isLoading ? (
        <DataSkeleton rows={6} />
      ) : error ? (
        <DataError error={error} retry={mutate} />
      ) : !data?.data.items.length ? (
        <NoData text="该日期及筛选条件下暂无公开公告" />
      ) : (
        <div className="announcements-list">
          {data.data.items.map((item) => (
            <a
              key={item.id}
              href={item.url}
              className="announcement-row"
              target="_blank"
              rel="noreferrer"
            >
              <time dateTime={item.publishedAt}>{announcementTime(item)}</time>
              <div className="announcement-content">
                <Tag>{announcementCategories[item.category]}</Tag>
                <strong>{item.title}</strong>
              </div>
              <ArrowUpOutlined rotate={45} aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
      {data && !error && (
        <div className="announcements-pagination">
          <span>
            匹配 {data.data.total} 条 · 区间共 {data.data.windowTotal} 条
          </span>
          <Pagination
            aria-label="公告分页"
            simple={!screens.sm ? { readOnly: true } : false}
            current={query.page}
            total={data.data.total}
            pageSize={20}
            showSizeChanger={false}
            onChange={(page) => setQuery((previous) => ({ ...previous, page }))}
          />
        </div>
      )}
      <DataMeta meta={data?.meta} />
    </section>
  );
}

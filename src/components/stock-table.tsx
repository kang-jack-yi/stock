"use client";

import Link from "next/link";
import { Table } from "antd";
import type { TableProps } from "antd";
import type { MarketStock, Quote } from "@/lib/types";
import { compact, direction, exchange, number, percent } from "@/lib/format";
import { WatchButton } from "./watch-button";

type StockRow = MarketStock | Quote;
/** 展示前端统一字段；排行排序交给上游接口，自选列表允许本地排序。 */
export function StockTable({
  rows,
  loading = false,
  pagination = false,
  sortLocal = false,
}: {
  rows: StockRow[];
  loading?: boolean;
  pagination?: TableProps<StockRow>["pagination"];
  sortLocal?: boolean;
}) {
  const columns: TableProps<StockRow>["columns"] = [
    {
      title: "股票名称 / 代码",
      key: "name",
      width: 175,
      fixed: "left",
      render: (_, row) => (
        <Link className="stock-name" href={`/stock/${row.symbol}`}>
          <strong>{row.name}</strong>
          <span>
            {row.symbol.slice(2)}
            <small>{exchange(row.symbol)}</small>
          </span>
        </Link>
      ),
    },
    {
      title: "最新价",
      dataIndex: "price",
      align: "right",
      width: 105,
      render: (n, row) => (
        <span className={`numeric ${direction(row.changePercent)}`}>{number(n)}</span>
      ),
    },
    {
      title: "涨跌幅",
      dataIndex: "changePercent",
      align: "right",
      width: 112,
      sorter: sortLocal ? (a, b) => (a.changePercent || 0) - (b.changePercent || 0) : undefined,
      render: (n) => <span className={`change-pill ${direction(n)}`}>{percent(n)}</span>,
    },
    {
      title: "成交额",
      dataIndex: "amount",
      align: "right",
      width: 112,
      sorter: sortLocal ? (a, b) => a.amount - b.amount : undefined,
      render: (n) => <span className="numeric">{compact(n)}</span>,
    },
    {
      title: "换手率",
      dataIndex: "turnover",
      align: "right",
      width: 100,
      render: (n) => <span className="numeric">{n == null ? "—" : `${number(n)}%`}</span>,
    },
    {
      title: "总市值",
      dataIndex: "marketCap",
      align: "right",
      width: 118,
      render: (n) => <span className="numeric">{compact(n)}</span>,
    },
    {
      title: "市盈率",
      dataIndex: "pe",
      align: "right",
      width: 95,
      render: (n) => <span className="numeric">{number(n)}</span>,
    },
    {
      title: "自选",
      key: "watch",
      align: "center",
      width: 65,
      render: (_, row) => <WatchButton symbol={row.symbol} compact />,
    },
  ];
  return (
    <Table<StockRow>
      rowKey="symbol"
      columns={columns}
      dataSource={rows}
      loading={loading}
      pagination={pagination}
      scroll={{ x: 900 }}
      size="middle"
    />
  );
}

"use client";

import { Button, Segmented, Select } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useMarketData } from "@/lib/api";
import type { MarketList } from "@/lib/types";
import { IndexCards } from "./index-cards";
import { StockTable } from "./stock-table";
import { DataError, DataMeta } from "./data-state";

/** 排行分页和排序在接口侧完成，切换筛选条件时回到第一页。 */
export function Market() {
  const [node, setNode] = useState("hs_a"),
    [sort, setSort] = useState("changepercent"),
    [asc, setAsc] = useState("0"),
    [page, setPage] = useState(1);
  const { data, error, isLoading, isValidating, mutate } = useMarketData<MarketList>(
    `/api/market/list?node=${node}&sort=${sort}&asc=${asc}&page=${page}`,
  );
  /** 市场切换清空旧分页，避免新市场不存在旧页码。 */
  function changeNode(value: string | number) {
    setNode(String(value));
    setPage(1);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MARKET EXPLORER</div>
          <h1>股票排行</h1>
          <p>在市场的不同切面，发现值得关注的公司。</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()}>
          刷新行情
        </Button>
      </div>
      <IndexCards />
      <section className="panel">
        <div className="market-toolbar">
          <Segmented
            value={node}
            onChange={changeNode}
            options={[
              { label: "全部 A 股", value: "hs_a" },
              { label: "沪市", value: "sh_a" },
              { label: "深市", value: "sz_a" },
              { label: "创业板", value: "cyb" },
              { label: "科创板", value: "kcb" },
            ]}
          />
          <div className="market-sort">
            <Select
              aria-label="排序指标"
              value={sort}
              onChange={(value) => {
                setSort(value);
                setPage(1);
              }}
              options={[
                { label: "涨跌幅", value: "changepercent" },
                { label: "成交额", value: "amount" },
                { label: "换手率", value: "turnoverratio" },
                { label: "总市值", value: "mktcap" },
                { label: "股票代码", value: "symbol" },
              ]}
            />
            <Select
              aria-label="排序方向"
              value={asc}
              onChange={(value) => {
                setAsc(value);
                setPage(1);
              }}
              options={[
                { label: "从高到低", value: "0" },
                { label: "从低到高", value: "1" },
              ]}
            />
          </div>
        </div>
        {error ? (
          <DataError error={error} retry={mutate} />
        ) : (
          <StockTable
            rows={data?.data.stocks || []}
            loading={isLoading}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.data.total || 0,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total.toLocaleString()} 只股票`,
            }}
          />
        )}
        <p className="table-note">
          市盈率按数据源口径展示；个股详情的 PE TTM 使用最近四季每股收益计算。
        </p>
        <DataMeta meta={data?.meta} date={data?.data.stocks[0]?.time} />
      </section>
    </>
  );
}

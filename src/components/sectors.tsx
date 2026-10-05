"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Input, Pagination, Segmented, Select, Table } from "antd";
import type { TableProps } from "antd";
import {
  ArrowRightOutlined,
  AppstoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useMarketData } from "@/lib/api";
import type { SectorConstituents, SectorKind, SectorList, SectorSummary } from "@/lib/sector-types";
import { compact, direction, number, percent, signed } from "@/lib/format";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";
import { StockTable } from "./stock-table";
import "./sectors.css";

/** 板块榜可用的数字排序字段，均为源指标，不能混用价格与指数。 */
type SectorSort = "changePercent" | "change" | "amount" | "volume" | "reportedStockCount";

/** 板块图谱按钮呈现涨跌强弱，缺失和零值使用中性颜色；键盘也可打开成分行情。 */
function SectorTile({
  sector,
  active,
  open,
}: {
  /** 单个板块的汇总数据。 */
  sector: SectorSummary;
  /** 当前是否为已选板块。 */
  active: boolean;
  /** 点击或键盘激活后选中当前板块。 */
  open: (node: string) => void;
}) {
  const magnitude = Math.abs(sector.changePercent ?? 0);
  const tone = direction(sector.changePercent);
  return (
    <button
      type="button"
      className={`sector-tile sector-${tone} sector-tone-${magnitude >= 2 ? "strong" : magnitude >= 0.8 ? "medium" : "soft"} ${active ? "sector-active" : ""}`}
      aria-pressed={active}
      aria-label={`${sector.name} ${percent(sector.changePercent)}，查看成分股`}
      onClick={() => open(sector.id)}
    >
      <span className="sector-tile-heading">
        <strong>{sector.name}</strong>
        <ArrowRightOutlined />
      </span>
      <span className={`sector-tile-change numeric ${tone}`}>{percent(sector.changePercent)}</span>
      <span className="sector-tile-footer">
        <span>源成交 {compact(sector.amount)}</span>
        <span>{sector.reportedStockCount ?? "—"} 只</span>
      </span>
    </button>
  );
}

/** 完整行业与概念板块榜支持搜索、排序、两种视图，以及真实成分股分页和行情跳转。 */
export function Sectors({
  kind,
  node,
}: {
  /** 服务端校验后的板块分类，由 URL 驱动。 */
  kind: SectorKind;
  /** 可分享的已选板块节点；未选时默认展示涨幅最高的真实板块。 */
  node?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SectorSort>("changePercent");
  const [asc, setAsc] = useState(false);
  const [view, setView] = useState("map");
  const [listPage, setListPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [stockSort, setStockSort] = useState("changepercent");
  const [stockAsc, setStockAsc] = useState("0");
  const catalog = useMarketData<SectorList>(`/api/sectors?type=${kind}`);
  const rows = useMemo(() => {
    const result = (catalog.data?.data.sectors || []).filter((row) =>
      row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
    return result.toSorted((a, b) => {
      const left = a[sort],
        right = b[sort];
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return (asc ? 1 : -1) * (left - right) || a.name.localeCompare(b.name, "zh-CN");
    });
  }, [catalog.data, query, sort, asc]);
  const active = node
    ? catalog.data?.data.sectors.find((row) => row.id === node)
    : (catalog.data?.data.sectors || []).toSorted(
        (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
      )[0];
  const constituents = useMarketData<SectorConstituents>(
    active
      ? `/api/sectors?type=${kind}&node=${encodeURIComponent(active.id)}&sort=${stockSort}&asc=${stockAsc}&page=${stockPage}`
      : null,
  );
  const pageSize = view === "map" ? 24 : 20;
  const page = Math.min(listPage, Math.max(1, Math.ceil(rows.length / pageSize)));
  const gainers = catalog.data?.data.sectors.filter(
    (row) => row.changePercent != null && row.changePercent > 0,
  ).length;
  const losers = catalog.data?.data.sectors.filter(
    (row) => row.changePercent != null && row.changePercent < 0,
  ).length;
  const missingNode = !!node && !!catalog.data && !active;

  /** 板块切换同步站内 URL，并从第一页重新查询成分，保留可分享的板块选择。 */
  function open(node: string) {
    setStockPage(1);
    router.replace(`/sectors?type=${kind}&node=${encodeURIComponent(node)}`, { scroll: false });
  }

  /** 分类切换清空搜索与旧页码，避免行业页码和节点被带入概念分类。 */
  function changeKind(value: string | number) {
    setQuery("");
    setListPage(1);
    setStockPage(1);
    router.replace(`/sectors?type=${value}`, { scroll: false });
  }

  /** 手动刷新汇总榜和当前成分行情，独立模块失败可各自重试。 */
  function refresh() {
    void catalog.mutate();
    if (active) void constituents.mutate();
  }

  const columns: TableProps<SectorSummary>["columns"] = [
    {
      title: "板块名称",
      key: "name",
      width: 155,
      fixed: "left",
      render: (_, row) => (
        <button
          type="button"
          className="sector-name-button"
          onClick={() => open(row.id)}
          aria-label={`${row.name}，查看成分股`}
          aria-pressed={active?.id === row.id}
        >
          {row.name}
          <ArrowRightOutlined aria-hidden />
        </button>
      ),
    },
    {
      title: "源涨跌幅",
      dataIndex: "changePercent",
      width: 112,
      align: "right",
      render: (value) => (
        <span className={`change-pill ${direction(value)}`}>{percent(value)}</span>
      ),
    },
    {
      title: "均价涨跌额 / 元",
      dataIndex: "change",
      width: 145,
      align: "right",
      render: (value) => <span className={`numeric ${direction(value)}`}>{signed(value)}</span>,
    },
    {
      title: "源成交额 / 元",
      dataIndex: "amount",
      width: 125,
      align: "right",
      render: (value) => <span className="numeric">{compact(value)}</span>,
    },
    {
      title: "源成交量 / 股",
      dataIndex: "volume",
      width: 125,
      align: "right",
      render: (value) => <span className="numeric">{compact(value)}</span>,
    },
    {
      title: "汇总股数",
      dataIndex: "reportedStockCount",
      width: 95,
      align: "right",
      render: (value) => value ?? "—",
    },
    {
      title: "源领涨股",
      key: "leader",
      width: 165,
      render: (_, row) =>
        row.leaderSymbol ? (
          <Link className="stock-name" href={`/stock/${row.leaderSymbol}`}>
            <strong>{row.leaderName || row.leaderSymbol}</strong>
            <span className={direction(row.leaderChangePercent)}>
              {percent(row.leaderChangePercent)}
            </span>
          </Link>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SECTOR EXPLORER</div>
          <h1>板块行情</h1>
          <p>从行业趋势到概念热度，沿着市场脉络发现公司。</p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={catalog.isValidating || constituents.isValidating}
          onClick={refresh}
        >
          刷新行情
        </Button>
      </div>
      <div className="sector-metrics">
        <div className="panel sector-metric">
          <span>{kind === "industry" ? "行业" : "概念"}板块</span>
          <strong className="numeric">
            {catalog.data?.data.total ?? "—"}
            <small>个板块</small>
          </strong>
        </div>
        <div className="panel sector-metric">
          <span>上涨板块</span>
          <strong className="numeric up">
            {gainers ?? "—"}
            <small>个</small>
          </strong>
        </div>
        <div className="panel sector-metric">
          <span>下跌板块</span>
          <strong className="numeric down">
            {losers ?? "—"}
            <small>个</small>
          </strong>
        </div>
        <div className="panel sector-metric">
          <span>当前筛选</span>
          <strong className="numeric">
            {catalog.data ? rows.length : "—"}
            <small>个结果</small>
          </strong>
        </div>
      </div>
      <section className="panel sector-board" aria-label="板块汇总行情">
        <div className="sector-toolbar">
          <Segmented
            aria-label="板块分类"
            value={kind}
            onChange={changeKind}
            options={[
              { label: "行业板块", value: "industry" },
              { label: "概念板块", value: "concept" },
            ]}
          />
          <Input
            className="sector-search"
            aria-label="搜索板块名称"
            placeholder="搜索板块名称"
            prefix={<SearchOutlined />}
            allowClear
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setListPage(1);
            }}
          />
          <Segmented
            aria-label="板块视图"
            value={view}
            onChange={(value) => {
              setView(String(value));
              setListPage(1);
            }}
            options={[
              {
                label: (
                  <>
                    <AppstoreOutlined aria-hidden />
                    <span className="sector-sr-only">板块图谱</span>
                  </>
                ),
                value: "map",
                title: "板块图谱",
              },
              {
                label: (
                  <>
                    <UnorderedListOutlined aria-hidden />
                    <span className="sector-sr-only">数据列表</span>
                  </>
                ),
                value: "table",
                title: "数据列表",
              },
            ]}
          />
        </div>
        <div className="sector-toolbar sector-order">
          <span className="small-muted">
            {catalog.data
              ? `完整${kind === "industry" ? "行业" : "概念"}榜 · ${catalog.data.data.total} 个板块`
              : "正在获取完整板块榜"}
          </span>
          <div>
            <Select
              aria-label="板块排序指标"
              value={sort}
              onChange={(value) => {
                setSort(value);
                setListPage(1);
              }}
              options={[
                { label: "涨跌幅", value: "changePercent" },
                { label: "均价涨跌额", value: "change" },
                { label: "成交额", value: "amount" },
                { label: "成交量", value: "volume" },
                { label: "汇总股数", value: "reportedStockCount" },
              ]}
            />
            <Select
              aria-label="板块排序方向"
              value={asc ? "1" : "0"}
              onChange={(value) => {
                setAsc(value === "1");
                setListPage(1);
              }}
              options={[
                { label: "从高到低", value: "0" },
                { label: "从低到高", value: "1" },
              ]}
            />
          </div>
        </div>
        {catalog.error ? (
          <DataError error={catalog.error} retry={catalog.mutate} />
        ) : catalog.isLoading ? (
          <DataSkeleton rows={5} />
        ) : !rows.length ? (
          <NoData text="没有匹配的板块，请尝试其他名称" />
        ) : view === "map" ? (
          <div className="sector-grid">
            {rows.slice((page - 1) * pageSize, page * pageSize).map((sector) => (
              <SectorTile
                key={sector.id}
                sector={sector}
                active={sector.id === active?.id}
                open={open}
              />
            ))}
          </div>
        ) : (
          <Table<SectorSummary>
            rowKey="id"
            dataSource={rows.slice((page - 1) * pageSize, page * pageSize)}
            columns={columns}
            scroll={{ x: 920 }}
            pagination={false}
            size="middle"
          />
        )}
        {!!rows.length && (
          <div className="sector-pagination">
            <Pagination
              aria-label="板块列表分页"
              current={page}
              total={rows.length}
              pageSize={pageSize}
              showSizeChanger={false}
              onChange={setListPage}
              showTotal={(total) => `共 ${total} 个板块`}
            />
          </div>
        )}
        <p className="table-note">
          图谱按汇总榜涨跌幅着色，大小一致；源均价不是可交易指数。
          {kind === "concept"
            ? "部分概念汇总只统计最多 100 只样本，源涨跌幅、成交额和领涨股不保证覆盖完整成分。"
            : "行业板块沿用数据源分类，汇总榜和数量接口计数可能与实际成分不同。"}
          下方面板的成交额、成交量和领涨股按完整成分快照计算，概念之间的重叠证券不可重复合计为全市场统计。
        </p>
        <DataMeta meta={catalog.data?.meta} />
      </section>
      <section className="panel sector-constituents" aria-label="板块成分股行情">
        <div className="sector-detail-heading">
          <div>
            <div className="eyebrow">CONSTITUENTS</div>
            <h2>{active?.name || (missingNode ? "板块未找到" : "成分股行情")}</h2>
            <p className="small-muted">
              {active
                ? `实时成分 ${constituents.data?.data.total ?? "—"} 只 · 汇总榜 ${active.reportedStockCount ?? "—"} 只${constituents.data && constituents.data.data.sourceStockCount !== constituents.data.data.total ? ` · 数量接口 ${constituents.data.data.sourceStockCount} 只` : ""}`
                : "选择一个板块查看完整成分股行情"}
            </p>
          </div>
          {active && (
            <div className="sector-source-change">
              <span>汇总榜涨跌幅</span>
              <span
                className={`change-pill sector-detail-change ${direction(active.changePercent)}`}
              >
                {percent(active.changePercent)}
              </span>
            </div>
          )}
        </div>
        {missingNode ? (
          <NoData text="该节点不属于当前板块分类，请在上方选择有效板块" />
        ) : active ? (
          <>
            <div className="sector-detail-stats">
              <div>
                <span>源平均股价</span>
                <strong className="numeric">
                  {number(active.averagePrice)}
                  <small>元</small>
                </strong>
              </div>
              <div>
                <span>完整成分成交额</span>
                <strong className="numeric">
                  {compact(constituents.data?.data.amount)}
                  <small>元</small>
                </strong>
              </div>
              <div>
                <span>完整成分成交量</span>
                <strong className="numeric">
                  {compact(constituents.data?.data.volume)}
                  <small>股</small>
                </strong>
              </div>
              <div>
                <span>完整成分领涨股</span>
                {constituents.data?.data.leader ? (
                  <Link href={`/stock/${constituents.data.data.leader.symbol}`}>
                    <strong>{constituents.data.data.leader.name}</strong>
                    <small className={direction(constituents.data.data.leader.changePercent)}>
                      {percent(constituents.data.data.leader.changePercent)}
                    </small>
                  </Link>
                ) : (
                  <strong>—</strong>
                )}
              </div>
            </div>
            <div className="sector-constituent-sort">
              <span className="small-muted">完整成分快照先排序再分页，约每 60 秒更新</span>
              <div>
                <Select
                  aria-label="成分股排序指标"
                  value={stockSort}
                  onChange={(value) => {
                    setStockSort(value);
                    setStockPage(1);
                  }}
                  options={[
                    { label: "涨跌幅", value: "changepercent" },
                    { label: "成交额", value: "amount" },
                    { label: "换手率", value: "turnoverratio" },
                    { label: "总市值", value: "mktcap" },
                    { label: "最新价", value: "trade" },
                  ]}
                />
                <Select
                  aria-label="成分股排序方向"
                  value={stockAsc}
                  onChange={(value) => {
                    setStockAsc(value);
                    setStockPage(1);
                  }}
                  options={[
                    { label: "从高到低", value: "0" },
                    { label: "从低到高", value: "1" },
                  ]}
                />
              </div>
            </div>
            {constituents.error ? (
              <DataError error={constituents.error} retry={constituents.mutate} />
            ) : (
              <StockTable
                rows={constituents.data?.data.stocks || []}
                loading={constituents.isLoading}
                pagination={{
                  current: stockPage,
                  pageSize: 20,
                  total: constituents.data?.data.total || 0,
                  showSizeChanger: false,
                  onChange: setStockPage,
                  showTotal: (total) => `共 ${total} 只实时成分股`,
                }}
              />
            )}
            <DataMeta
              meta={constituents.data?.meta}
              date={constituents.data?.data.stocks[0]?.time}
            />
          </>
        ) : catalog.isLoading ? (
          <DataSkeleton rows={3} />
        ) : (
          <NoData text="选择板块后查看成分股" />
        )}
      </section>
    </>
  );
}

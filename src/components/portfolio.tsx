"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { EChartsCoreOption } from "echarts/core";
import type { ColumnsType } from "antd/es/table";
import type {
  PortfolioInput,
  PortfolioHolding,
  PortfolioResult,
  PortfolioTransaction,
  TransactionKind,
} from "@/lib/portfolio-types";
import type { SearchStock } from "@/lib/types";
import { portfolioToday } from "@/lib/portfolio-calculation";
import { fetchJson, useMarketData } from "@/lib/api";
import { chartColors } from "@/lib/chart-theme";
import { direction, number, signed } from "@/lib/format";
import { useApp } from "./providers";
import { Chart } from "./chart";
import { DataError, DataSkeleton } from "./data-state";
import { PortfolioImport } from "./portfolio-import";
import { PortfolioRisk } from "./portfolio-risk";
import "./portfolio.css";

const kinds: Record<TransactionKind, string> = {
  deposit: "入金",
  withdraw: "出金",
  buy: "买入",
  sell: "卖出",
  dividend: "现金分红",
  bonus: "送转股",
};

/** 按账号重建持仓工作台，切换会话或退出时清除前一账号的弹窗与草稿。 */
export function Portfolio({
  initialSymbol,
}: {
  /** 详情页带入的股票代码，默认新建买入记录。 */ initialSymbol: string;
}) {
  const { user } = useApp();
  return user ? (
    <PortfolioWorkspace
      key={`${user.id}:${initialSymbol}`}
      userId={user.id}
      initialSymbol={initialSymbol}
    />
  ) : (
    <div className="page-heading">
      <div>
        <div className="eyebrow">PERSONAL PORTFOLIO</div>
        <h1>持仓与组合</h1>
        <p>
          <Link
            href={`/login?next=${encodeURIComponent(`/portfolio${initialSymbol ? `?symbol=${initialSymbol}` : ""}`)}`}
          >
            登录账号
          </Link>
          后管理手工账本与持仓。
        </p>
      </div>
    </div>
  );
}

/** 账号独立手工账本，显示加权成本与真实报价的当前组合估值。 */
function PortfolioWorkspace({
  userId,
  initialSymbol,
}: {
  /** 当前会话账号，仅用于隔离前端缓存及组件生命周期。 */
  userId: string;
  /** 详情页传入的初始股票代码。 */
  initialSymbol: string;
}) {
  const { mode } = useApp();
  const { message } = App.useApp();
  const [form] = Form.useForm<PortfolioInput>();
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<PortfolioTransaction | null>(null),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const kind = Form.useWatch("kind", form) as TransactionKind | undefined;
  const { data, error, mutate, isValidating } = useSWR<PortfolioResult>(
    ["/api/portfolio", userId],
    ([url]: [string, string]) => fetchJson(url),
    { refreshInterval: 60000, refreshWhenHidden: false },
  );
  const suggestions = useMarketData<SearchStock[]>(
    search ? `/api/market/search?q=${encodeURIComponent(search)}` : null,
    false,
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  /** 新建或编辑时显式设置表单；行情轮询不会覆盖正在输入的内容。 */
  function showForm(record?: PortfolioTransaction) {
    setEditing(record || null);
    form.resetFields();
    form.setFieldsValue(
      record || {
        date: portfolioToday(),
        kind: initialSymbol ? "buy" : "deposit",
        symbol: initialSymbol,
        quantity: 0,
        price: 0,
        amount: 0,
        fee: 0,
        note: "",
      },
    );
    setQuery(record?.symbol || initialSymbol);
    setSearch("");
    setOpen(true);
  }

  /** 向同源账号接口提交操作，错误时保留用户编辑内容。 */
  async function change(method: string, input: object) {
    setBusy(true);
    try {
      await fetchJson("/api/portfolio", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await mutate();
      message.success("账本已更新");
      return true;
    } catch (error) {
      message.error((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** 按记录种类清空无关字段，金额两位、整数股数在服务端再次验证。 */
  async function save(values: PortfolioInput) {
    const cash = values.kind === "deposit" || values.kind === "withdraw";
    const trade = values.kind === "buy" || values.kind === "sell";
    const record: PortfolioInput = {
      date: values.date,
      kind: values.kind,
      symbol: cash ? "" : values.symbol.trim().toLowerCase(),
      quantity: trade || values.kind === "bonus" ? values.quantity : 0,
      price: trade ? values.price : 0,
      amount: cash || values.kind === "dividend" ? values.amount : 0,
      fee: trade ? values.fee || 0 : 0,
      note: values.note?.trim() || "",
    };
    if (await change(editing ? "PATCH" : "POST", editing ? { id: editing.id, record } : record))
      setOpen(false);
  }

  const holdingColumns: ColumnsType<PortfolioHolding> = [
    {
      title: "股票",
      dataIndex: "name",
      fixed: "left",
      width: 140,
      render: (name, holding) => (
        <Link href={`/stock/${holding.symbol}`}>
          {name}
          <small className="portfolio-symbol">{holding.symbol}</small>
        </Link>
      ),
    },
    {
      title: "持仓（股）",
      dataIndex: "quantity",
      align: "right",
      render: (value) => number(value, 0),
    },
    {
      title: "成本单价",
      dataIndex: "averageCost",
      align: "right",
      render: (value) => number(value),
    },
    { title: "最新价", dataIndex: "price", align: "right", render: (value) => number(value) },
    {
      title: "市值（元）",
      dataIndex: "marketValue",
      align: "right",
      render: (value) => number(value),
    },
    {
      title: "浮动盈亏",
      dataIndex: "unrealized",
      align: "right",
      render: (value) => <span className={direction(value)}>{signed(value)}</span>,
    },
    {
      title: "已实现收益",
      dataIndex: "realized",
      align: "right",
      render: (value) => <span className={direction(value)}>{signed(value)}</span>,
    },
    {
      title: "盈亏贡献（元）",
      dataIndex: "contribution",
      align: "right",
      render: (value) => <span className={direction(value)}>{signed(value)}</span>,
    },
    {
      title: "个股集中度",
      dataIndex: "concentration",
      align: "right",
      render: (value) => (value == null ? "—" : `${number(value)}%`),
    },
    {
      title: "实际行情时间",
      dataIndex: "quoteAt",
      width: 180,
      render: (value, holding) => (holding.quantity ? value || "暂无有效报价" : "已清仓，无需估值"),
    },
  ];
  const recordColumns: ColumnsType<PortfolioTransaction> = [
    {
      title: "日期 / 顺序",
      dataIndex: "date",
      width: 125,
      render: (date, record) => (
        <>
          {date}
          <small className="portfolio-symbol">序号 {record.sequence}</small>
        </>
      ),
    },
    {
      title: "类型",
      dataIndex: "kind",
      render: (value: TransactionKind) => <Tag>{kinds[value]}</Tag>,
    },
    {
      title: "股票",
      dataIndex: "symbol",
      width: 110,
      render: (value) => (value ? <Link href={`/stock/${value}`}>{value}</Link> : "—"),
    },
    {
      title: "股数",
      dataIndex: "quantity",
      align: "right",
      render: (value) => (value ? number(value, 0) : "—"),
    },
    {
      title: "单价（元）",
      dataIndex: "price",
      align: "right",
      render: (value) => (value ? number(value) : "—"),
    },
    {
      title: "金额（元）",
      align: "right",
      render: (_, record) => number(record.amount || record.quantity * record.price),
    },
    { title: "费用（元）", dataIndex: "fee", align: "right", render: (value) => number(value) },
    {
      title: "备注",
      dataIndex: "note",
      width: 180,
      render: (value) => <span className="portfolio-note">{value || "—"}</span>,
    },
    {
      title: "操作",
      width: 130,
      render: (_, record) => (
        <div className="portfolio-actions">
          <Button size="small" disabled={busy} onClick={() => showForm(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除这条手工记录？"
            description="删除后会验证全部后续记录，非法账本会被拒绝。"
            onConfirm={() => change("DELETE", { id: record.id })}
          >
            <Button size="small" danger disabled={busy}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];
  const option = useMemo<EChartsCoreOption>(() => {
    const palette = chartColors(mode);
    const positions = (data?.holdings || [])
      .filter((holding) => holding.quantity > 0)
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
      .slice(0, 10)
      .reverse();
    return {
      animation: false,
      aria: { enabled: true },
      tooltip: {
        trigger: "axis",
        confine: true,
        valueFormatter: (value: unknown) => `${number(Number(value))}%`,
        backgroundColor: palette.surface,
        borderColor: palette.grid,
        textStyle: { color: palette.text },
      },
      grid: { left: 110, right: 45, top: 15, bottom: 35 },
      xAxis: {
        type: "value",
        axisLabel: { color: palette.muted, formatter: "{value}%" },
        splitLine: { lineStyle: { color: palette.grid } },
      },
      yAxis: {
        type: "category",
        data: positions.map((holding) => holding.name),
        axisLabel: { color: palette.text, width: 95, overflow: "truncate" },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          name: "个股集中度",
          type: "bar",
          barMaxWidth: 22,
          itemStyle: { color: palette.blue },
          data: positions.map((holding) => holding.concentration),
        },
      ],
    };
  }, [data, mode]);
  const metrics = [
    { title: "总资产（元）", value: data?.totalAssets },
    { title: "现金余额（元）", value: data?.cash },
    { title: "股票市值（元）", value: data?.marketValue },
    { title: "股票仓位", value: data?.exposure, suffix: "%" },
    { title: "浮动盈亏（元）", value: data?.unrealized, profit: true },
    { title: "已实现收益（元）", value: data?.realized, profit: true },
    { title: "累计总盈亏（元）", value: data?.totalProfit, profit: true },
    { title: "净入金（元）", value: data?.netDeposits },
  ];
  const trade = kind === "buy" || kind === "sell",
    cash = kind === "deposit" || kind === "withdraw";
  return (
    <>
      <div className="page-heading portfolio-heading">
        <div>
          <div className="eyebrow">PERSONAL PORTFOLIO</div>
          <h1>持仓与组合</h1>
          <p>记录真实发生的交易，查看成本、仓位与盈亏贡献。</p>
        </div>
        <div className="portfolio-actions">
          <PortfolioImport onImported={mutate} />
          <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()}>
            刷新估值
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => showForm()}>
            新增记录
          </Button>
        </div>
      </div>
      <Alert
        type="info"
        showIcon
        title="手工账本，不自动同步券商"
        description="先录入入金，再按日期登记交易、实际费用、税后现金分红和新增送转股。采用移动加权成本；同日按创建序号回放，编辑保留原序号。不用未复权 K 线推算历史收益。现金分红计入已实现收益，不冲减剩余成本。"
      />
      {error ? (
        <DataError error={error} retry={mutate} />
      ) : !data ? (
        <DataSkeleton />
      ) : (
        <>
          {data.warning && (
            <Alert
              className="portfolio-warning"
              type="warning"
              showIcon
              title={data.warning}
              description={`已定价持仓市值小计 ${number(data.knownMarketValue)} 元${data.missingSymbols.length ? `；无法估值：${data.missingSymbols.join("、")}` : ""}`}
            />
          )}
          <div className="portfolio-metrics">
            {metrics.map((metric) => (
              <section className="panel portfolio-metric" key={metric.title}>
                <span>{metric.title}</span>
                <strong className={metric.profit ? direction(metric.value) : undefined}>
                  {metric.profit ? signed(metric.value) : number(metric.value)}
                  {metric.value != null ? metric.suffix : ""}
                </strong>
              </section>
            ))}
          </div>
          <section className="panel portfolio-holdings">
            <div className="panel-heading">
              <div>
                <h2>持仓与盈亏贡献</h2>
                <span className="panel-caption">
                  金额单位元 · 已实现收益包含税后现金分红 · 清仓证券保留收益
                </span>
              </div>
              <span className="panel-caption">
                估值获取时间{" "}
                {new Date(data.fetchedAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  hour12: false,
                })}
              </span>
            </div>
            <Table
              rowKey="symbol"
              columns={holdingColumns}
              dataSource={data.holdings}
              scroll={{ x: 1320 }}
              pagination={false}
              locale={{ emptyText: "尚无证券记录，先入金再登记买入" }}
            />
          </section>
          {data.holdings.some((holding) => holding.quantity > 0) && (
            <section className="panel portfolio-concentration">
              <div className="panel-heading">
                <div>
                  <h2>持仓集中度</h2>
                  <span className="panel-caption">
                    按股票市值占比排序展示前 10 名，不含现金；缺少任一报价时不绘制
                  </span>
                </div>
              </div>
              {data.missingSymbols.length ? (
                <p className="portfolio-empty">等待完整报价后展示集中度</p>
              ) : (
                <Chart
                  option={option}
                  label="前十个股持仓集中度百分比"
                  height={Math.max(
                    180,
                    Math.min(data.holdings.filter((holding) => holding.quantity).length, 10) * 36 +
                      60,
                  )}
                />
              )}
            </section>
          )}
          <PortfolioRisk portfolio={data} userId={userId} />
          <section className="panel portfolio-records">
            <div className="panel-heading">
              <div>
                <h2>手工记录</h2>
                <span className="panel-caption">
                  日期倒序展示，同日序号越小越先回放 · 最多 1000 条 / 60 个证券
                </span>
              </div>
              <Tag>{data.transactions.length} 条</Tag>
            </div>
            <Table
              rowKey="id"
              columns={recordColumns}
              dataSource={[...data.transactions].reverse()}
              scroll={{ x: 1130 }}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              locale={{ emptyText: "暂无记录，点击新增记录登记入金" }}
            />
          </section>
        </>
      )}
      <Modal
        title={editing ? "编辑手工记录" : "新增手工记录"}
        open={open}
        onCancel={() => !busy && setOpen(false)}
        footer={null}
        width={620}
        closable={!busy}
        mask={{ closable: !busy }}
      >
        <Form form={form} layout="vertical" onFinish={save} className="portfolio-form">
          <div className="portfolio-fields">
            <Form.Item label="记录类型" name="kind" rules={[{ required: true }]}>
              <Select
                aria-label="记录类型"
                options={Object.entries(kinds).map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
            <Form.Item
              label="发生日期"
              name="date"
              rules={[{ required: true, message: "请选择发生日期" }]}
            >
              <Input aria-label="发生日期" type="date" max={portfolioToday()} />
            </Form.Item>
          </div>
          {!cash && (
            <Form.Item
              label="股票代码"
              name="symbol"
              rules={[{ required: true, message: "请输入带交易所前缀的 A 股代码" }]}
            >
              <AutoComplete
                options={suggestions.data?.data
                  .filter((stock) =>
                    /^(sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj[489]\d{5})$/.test(stock.symbol),
                  )
                  .map((stock) => ({
                    value: stock.symbol,
                    label: `${stock.name} ${stock.symbol}`,
                  }))}
                onSearch={setQuery}
              >
                <Input aria-label="股票代码" placeholder="名称 / 代码，例如 sh600519" />
              </AutoComplete>
            </Form.Item>
          )}
          <div className="portfolio-fields">
            {(trade || kind === "bonus") && (
              <Form.Item
                label={kind === "bonus" ? "新增送转股数（股）" : "成交股数（股）"}
                name="quantity"
                rules={[{ required: true, type: "number", min: 1, message: "股数须大于零" }]}
              >
                <InputNumber aria-label="股数" min={1} precision={0} />
              </Form.Item>
            )}
            {trade && (
              <Form.Item
                label="成交单价（元）"
                name="price"
                rules={[{ required: true, type: "number", min: 0.01, message: "单价须大于零" }]}
              >
                <InputNumber aria-label="成交单价" min={0.01} precision={2} />
              </Form.Item>
            )}
            {(cash || kind === "dividend") && (
              <Form.Item
                label={kind === "dividend" ? "实际税后到账金额（元）" : "金额（元）"}
                name="amount"
                rules={[{ required: true, type: "number", min: 0.01, message: "金额须大于零" }]}
              >
                <InputNumber aria-label="现金金额" min={0.01} precision={2} />
              </Form.Item>
            )}
            {trade && (
              <Form.Item label="实际交易费用（元）" name="fee">
                <InputNumber aria-label="交易费用" min={0} precision={2} />
              </Form.Item>
            )}
          </div>
          <Form.Item label="备注" name="note">
            <Input.TextArea aria-label="账本备注" maxLength={200} showCount rows={2} />
          </Form.Item>
          <p className="panel-caption">
            历史编辑和删除会检查全部记录。若导致超卖或任一时点负现金，将拒绝保存。
          </p>
          <div className="portfolio-actions">
            <Button onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              保存记录
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}

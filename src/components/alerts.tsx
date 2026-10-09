"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Switch,
  Tag,
} from "antd";
import { BellOutlined, ReloadOutlined } from "@ant-design/icons";
import { useApp } from "./providers";
import { fetchJson, useMarketData } from "@/lib/api";
import type { AlertsResult, AlertRule, AlertCheckResult } from "@/lib/alert-types";
import type { Quote, SearchStock } from "@/lib/types";
import type { TradingSession } from "@/lib/trading-calendar";
import { number } from "@/lib/format";
import { DataError, DataSkeleton, NoData } from "./data-state";
import "./alerts.css";

/** 创建提醒表单，服务器再次验证全部条件。 */
interface AlertForm {
  /** 证券代码，来自明确选择的搜索建议。 */
  symbol: string;
  /** 价格或涨跌幅。 */
  metric: AlertRule["metric"];
  /** 上穿或下穿。 */
  direction: AlertRule["direction"];
  /** 元/点或百分比数值。 */
  threshold: number;
}
/** 提醒规则的中文说明，价格与百分比保留两位。 */
function ruleLabel(rule: Pick<AlertRule, "metric" | "direction" | "threshold">) {
  return `${rule.metric === "price" ? "价格" : "涨跌幅"}${rule.direction === "above" ? "上穿" : "下穿"} ${number(rule.threshold)}${rule.metric === "price" ? " 元/点" : "%"}`;
}
/** ISO 行情时间按中国标准时间展示。 */
function localTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
/** 账号隔离的提醒工作台，使用现有请求工具与 Ant Design 表单。 */
export function Alerts({
  initialSymbol,
}: {
  /** 从股票详情传入的合法证券代码，未指定时为空。 */
  initialSymbol: string;
}) {
  const { user } = useApp();
  const { message } = App.useApp();
  const [form] = Form.useForm<AlertForm>();
  const [query, setQuery] = useState(initialSymbol),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false);
  const { data, error, mutate } = useSWR<AlertsResult>(
    user ? ["/api/alerts", user.id] : null,
    ([url]: [string, string]) => fetchJson(url),
    { refreshInterval: 30000 },
  );
  const { data: session } = useSWR<TradingSession>("/api/calendar", fetchJson, {
    refreshInterval: 60000,
  });
  const suggestions = useMarketData<SearchStock[]>(
    search ? `/api/market/search?q=${encodeURIComponent(search)}` : null,
    false,
  );
  const symbols = [
    ...new Set([initialSymbol, ...(data?.rules.map((rule) => rule.symbol) || [])].filter(Boolean)),
  ];
  const prices = useMarketData<Quote[]>(
    symbols.length ? `/api/market/quotes?symbols=${symbols.join(",")}` : null,
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  /** 根据账号会话提交规则操作；操作完成重新验证个人数据。 */
  async function change(method: string, input: object) {
    setBusy(true);
    try {
      const result = await fetchJson<Partial<AlertCheckResult>>("/api/alerts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await mutate();
      if (result.message) message.info(result.message);
      return true;
    } catch (error) {
      message.error((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  /** 首次有效采样只建立基准，创建时不根据旧快照立即触发。 */
  async function create(values: AlertForm) {
    if (await change("POST", values)) {
      message.success("提醒已创建，等待有效行情建立基准");
      form.resetFields(["threshold"]);
    }
  }
  const workerAlive = data?.workerRunning ?? false;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MARKET ALERTS</div>
          <h1>提醒中心</h1>
          <p>把关注条件留在这里，让变化有迹可循。</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => mutate()}>
          刷新
        </Button>
      </div>
      <Alert
        type={workerAlive ? "info" : "warning"}
        showIcon
        title={`${session?.label ?? "正在获取交易状态"} · ${workerAlive ? "后台检查运行中" : "后台检查未运行"}`}
        description={
          workerAlive
            ? data?.workerMessage
            : "后台检查未连接，可以先使用下方的手动检查。关闭页面后持续检查需要后台服务保持运行。"
        }
      />
      <section className="panel alerts-create">
        <div className="panel-heading">
          <div>
            <h2>创建提醒</h2>
            <span className="panel-caption">
              首次采样建立基准 · 穿越后自动暂停 · 仅接受当日有效行情
            </span>
          </div>
          <BellOutlined />
        </div>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ symbol: initialSymbol, metric: "price", direction: "above" }}
          onFinish={create}
          requiredMark={false}
          disabled={busy}
        >
          <div className="alerts-fields">
            <Form.Item
              name="symbol"
              label="股票 / 指数"
              rules={[
                { required: true, message: "请选择股票或输入带前缀代码" },
                { pattern: /^(sh|sz|bj)\d{6}$/, message: "请从建议选择，或输入如 sh600519" },
              ]}
            >
              <AutoComplete
                options={suggestions.data?.data.map((stock) => ({
                  value: stock.symbol,
                  label: `${stock.name} ${stock.symbol}`,
                }))}
                onSearch={setQuery}
              >
                <Input aria-label="提醒证券代码" placeholder="搜索名称，或输入 sh600519" />
              </AutoComplete>
            </Form.Item>
            <Form.Item name="metric" label="指标">
              <Select
                options={[
                  { value: "price", label: "价格（元/点）" },
                  { value: "changePercent", label: "涨跌幅（%）" },
                ]}
              />
            </Form.Item>
            <Form.Item name="direction" label="方向">
              <Select
                options={[
                  { value: "above", label: "上穿阈值" },
                  { value: "below", label: "下穿阈值" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="threshold"
              label="阈值"
              rules={[{ required: true, message: "请输入阈值" }]}
            >
              <InputNumber aria-label="提醒阈值" precision={2} min={-100} max={1e9} />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit" loading={busy}>
            创建提醒
          </Button>
        </Form>
      </section>
      <section className="panel alerts-rules">
        <div className="panel-heading">
          <div>
            <h2>
              我的规则 <span className="count-badge">{data?.rules.length ?? 0}</span>
            </h2>
            <span className="panel-caption">重新启用会重建基准；每个账号最多 50 条</span>
          </div>
          <Button onClick={() => change("POST", { action: "check" })} loading={busy}>
            检查我的提醒
          </Button>
        </div>
        {error ? (
          <DataError error={error} retry={mutate} />
        ) : !data ? (
          <DataSkeleton />
        ) : !data.rules.length ? (
          <NoData text="还没有提醒规则" />
        ) : (
          <div className="alerts-list">
            {data.rules.map((rule) => {
              const quote = prices.data?.data.find((row) => row.symbol === rule.symbol);
              return (
                <article className="alert-rule" key={rule.id}>
                  <div>
                    <Link href={`/stock/${rule.symbol}`}>{quote?.name || rule.symbol}</Link>
                    <p>{ruleLabel(rule)}</p>
                    <span className="small-muted">
                      {rule.previousAt
                        ? `上次有效行情 ${localTime(rule.previousAt)}`
                        : "等待首次有效行情"}
                    </span>
                  </div>
                  <div className="alert-actions">
                    <Switch
                      checked={rule.enabled}
                      disabled={busy}
                      aria-label={`启用提醒 ${rule.symbol}`}
                      onChange={(enabled) =>
                        change("PATCH", { action: "enabled", id: rule.id, enabled })
                      }
                    />
                    <Tag>{rule.enabled ? "检查中" : "已暂停"}</Tag>
                    <Popconfirm
                      title="删除这条规则？触发历史会保留。"
                      onConfirm={() => change("DELETE", { id: rule.id })}
                    >
                      <Button danger disabled={busy}>
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel alerts-history">
        <div className="panel-heading">
          <div>
            <h2>触发记录</h2>
            <span className="panel-caption">最近 100 条 · 行情时间为中国标准时间</span>
          </div>
          <Button
            disabled={busy || !data?.events.some((event) => !event.read)}
            onClick={() => change("PATCH", { action: "read" })}
          >
            全部标为已读
          </Button>
        </div>
        {!data ? (
          <DataSkeleton />
        ) : !data.events.length ? (
          <NoData text="暂无触发记录" />
        ) : (
          <div className="alerts-list">
            {data.events.map((event) => (
              <article className="alert-rule" key={event.id}>
                <div>
                  <Link href={`/stock/${event.symbol}`}>{event.name}</Link>{" "}
                  {!event.read && <Tag color="blue">未读</Tag>}
                  <p>
                    {ruleLabel(event)}，实际值 {number(event.value)}
                    {event.metric === "price" ? " 元/点" : "%"}
                  </p>
                  <span className="small-muted">{localTime(event.quoteAt)}</span>
                </div>
                {!event.read && (
                  <Button
                    disabled={busy}
                    onClick={() => change("PATCH", { action: "read", id: event.id })}
                  >
                    标为已读
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

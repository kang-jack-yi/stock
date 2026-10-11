"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Alert, App, Button, Form, Input, Popconfirm, Select, Switch, Table } from "antd";
import { fetchJson, useMarketData } from "@/lib/api";
import {
  signalLabels,
  type SignalKind,
  type SignalRule,
  type SignalEvent,
  type SignalsResult,
  type SignalCheckResult,
} from "@/lib/signal-types";
import type { TechnicalResult } from "@/lib/technical-types";
import { number } from "@/lib/format";
import { useApp } from "./providers";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";
import { StockChart } from "./stock-chart";
import "./technical.css";

/** 登录账号变更时重建工作区，防止共享浏览器显示上一账号草稿和记录。 */
export function TechnicalPanel({
  symbol,
}: {
  /** 带交易所前缀的 A 股代码，用于图表及个人条件筛选。 */
  symbol: string;
}) {
  const { user } = useApp();
  return (
    <>
      <StockChart symbol={symbol} initialPeriod="day" title="日线技术指标" />
      {user ? (
        <SignalWorkspace key={`${user.id}:${symbol}`} userId={user.id} symbol={symbol} />
      ) : (
        <section className="panel technical-login">
          <NoData text="登录后可订阅自选或持仓的收盘技术条件" />
          <Link href={`/login?next=${encodeURIComponent(`/stock/${symbol}?view=technical`)}`}>
            <Button type="primary">登录后订阅</Button>
          </Link>
        </section>
      )}
    </>
  );
}
/** 独立工作台管理所有关注股票的规则；账号切换清空证券与条件草稿。 */
export function SignalManager() {
  const { user } = useApp();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TECHNICAL SIGNALS</div>
          <h1>技术信号</h1>
          <p>记录关注股票收盘时的指标变化，关联个人情报流。</p>
        </div>
      </div>
      {user ? (
        <SignalWorkspace key={user.id} userId={user.id} symbol="" />
      ) : (
        <section className="panel technical-login">
          <NoData text="登录后管理个人技术条件和记录" />
          <Link href="/login?next=%2Fsignals">
            <Button type="primary">登录账号</Button>
          </Link>
        </section>
      )}
    </>
  );
}
/** 展示指标快照和账号独立条件，所有检查均由服务端核实实际交易日。 */
function SignalWorkspace({
  userId,
  symbol,
}: {
  /** 会话账号编号，仅用于隔离客户端缓存，不发送给接口。 */
  userId: string;
  /** 固定股票代码；空字符串表示展示账号全部规则和记录。 */
  symbol: string;
}) {
  const { message } = App.useApp();
  const { data, error, mutate } = useSWR<SignalsResult>(
    ["/api/signals", userId],
    () => fetchJson("/api/signals"),
    { revalidateOnFocus: false, refreshInterval: 30000 },
  );
  const history = useMarketData<TechnicalResult>(
    symbol ? `/api/technical?symbol=${symbol}&adjustment=qfq` : null,
    false,
  );
  const [kind, setKind] = useState<SignalKind>("ma20Above"),
    [target, setTarget] = useState(symbol),
    [busy, setBusy] = useState(false);
  const latest = history.data?.data.points.at(-1);
  /** 服务端回报成功后刷新个人记录；失败沿用中文消息，不提前伪造行。 */
  async function action(method: string, input: object) {
    setBusy(true);
    try {
      const result = await fetchJson<
        | SignalCheckResult
        | {
            /** 服务端完成规则或已读状态写入的确认标记。 */
            ok: true;
          }
      >("/api/signals", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      message.success("message" in result ? result.message : "技术条件已更新");
      await mutate();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {symbol && (
        <section className="panel technical-summary">
          <div className="panel-heading">
            <div>
              <h2>前复权指标快照</h2>
              <span className="panel-caption">日线 MACD(12,26,9) · RSI14 · BOLL(20,2)</span>
            </div>
            <span className="small-muted">{latest?.date || "等待数据"}</span>
          </div>
          {history.error ? (
            <DataError error={history.error} retry={history.mutate} />
          ) : !latest ? (
            <DataSkeleton rows={3} />
          ) : (
            <div className="technical-metrics">
              {[
                { title: "MA20", value: latest.ma20 },
                { title: "DIF", value: latest.dif },
                { title: "DEA", value: latest.dea },
                { title: "RSI14", value: latest.rsi },
                { title: "布林上轨", value: latest.upper },
                { title: "布林下轨", value: latest.lower },
                { title: "相对前五日均量（倍）", value: latest.volumeRatio },
              ].map((item) => (
                <div key={item.title}>
                  <span>{item.title}</span>
                  <strong className="numeric">{number(item.value)}</strong>
                </div>
              ))}
            </div>
          )}
          <DataMeta meta={history.data?.meta} date={latest?.date} />
        </section>
      )}
      <section className="panel technical-rules">
        <div className="panel-heading">
          <div>
            <h2>收盘技术条件</h2>
            <span className="panel-caption">
              仅检查自选与当前持仓 · 前复权有效日线 · 每规则每日一次
            </span>
          </div>
          <Button loading={busy} onClick={() => action("POST", { action: "check" })}>
            检查我的条件
          </Button>
        </div>
        <Alert
          type={data?.workerRunning ? "info" : "warning"}
          showIcon
          title={data?.workerMessage || "正在读取技术信号后台状态"}
          description="15:05 后核实当日收盘报价才记录；休市不补造历史。条件描述价格和指标事实，不表示交易建议。MACD 从完整窗口均值初始化，有限历史可能与其他软件有细微差异。"
        />
        <Form
          className="technical-create"
          layout="inline"
          onFinish={() => action("POST", { symbol: target, kind })}
        >
          {!symbol && (
            <Form.Item label="自选 / 持仓股票">
              <Input
                aria-label="技术订阅股票代码"
                value={target}
                placeholder="如 sh600519"
                maxLength={8}
                onChange={(event) => setTarget(event.target.value)}
              />
            </Form.Item>
          )}
          <Form.Item label="技术条件">
            <Select
              aria-label="技术条件"
              value={kind}
              onChange={setKind}
              options={Object.entries(signalLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              {symbol ? "订阅此股票" : "订阅技术条件"}
            </Button>
          </Form.Item>
        </Form>
        {error ? (
          <DataError error={error} retry={mutate} />
        ) : !data ? (
          <DataSkeleton />
        ) : (
          <Table<SignalRule>
            rowKey="id"
            size="small"
            scroll={{ x: 650 }}
            pagination={symbol ? false : { pageSize: 10, showSizeChanger: false }}
            dataSource={symbol ? data.rules.filter((rule) => rule.symbol === symbol) : data.rules}
            locale={{ emptyText: symbol ? "尚未订阅此股票的条件" : "尚未订阅技术条件" }}
            columns={[
              ...(!symbol
                ? [
                    {
                      title: "股票",
                      dataIndex: "symbol",
                      render: (value: string) => (
                        <Link href={`/stock/${value}?view=technical`}>{value}</Link>
                      ),
                    },
                  ]
                : []),
              {
                title: "条件",
                dataIndex: "kind",
                render: (value: SignalKind) => signalLabels[value],
              },
              {
                title: "最近检查",
                dataIndex: "checkedDate",
                render: (value: string | null) => value || "尚未有效采样",
              },
              {
                title: "启用",
                render: (_, row) => (
                  <Switch
                    aria-label={`启用${signalLabels[row.kind]}`}
                    checked={row.enabled}
                    disabled={busy}
                    onChange={(enabled) =>
                      action("PATCH", { action: "enabled", id: row.id, enabled })
                    }
                  />
                ),
              },
              {
                title: "操作",
                render: (_, row) => (
                  <Popconfirm
                    title="删除此技术条件？已触发记录会保留。"
                    onConfirm={() => action("DELETE", { id: row.id })}
                  >
                    <Button type="text" danger disabled={busy}>
                      删除
                    </Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        )}
      </section>
      <section className="panel technical-events">
        <div className="panel-heading">
          <h2>{symbol ? "此股票的信号记录" : "我的信号记录"}</h2>
          <Button
            disabled={busy || !data?.events.some((event) => !event.read)}
            onClick={() => action("PATCH", { action: "read" })}
          >
            此账号全部标为已读
          </Button>
        </div>
        {!data ? (
          <DataSkeleton />
        ) : (
          <Table<SignalEvent>
            rowKey="id"
            size="small"
            scroll={{ x: 650 }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            dataSource={
              symbol ? data.events.filter((event) => event.symbol === symbol) : data.events
            }
            locale={{ emptyText: "暂无有效收盘条件触发" }}
            columns={[
              ...(!symbol
                ? [
                    {
                      title: "股票",
                      render: (_: unknown, row: SignalEvent) => (
                        <Link href={`/stock/${row.symbol}?view=technical`}>
                          {row.name} {row.symbol}
                        </Link>
                      ),
                    },
                  ]
                : []),
              { title: "收盘日期", dataIndex: "date" },
              {
                title: "条件",
                dataIndex: "kind",
                render: (value: SignalKind) => signalLabels[value],
              },
              { title: "事实值", dataIndex: "value", render: (value: number) => number(value) },
              {
                title: "状态",
                render: (_, row) =>
                  row.read ? (
                    "已读"
                  ) : (
                    <Button
                      type="link"
                      disabled={busy}
                      onClick={() => action("PATCH", { action: "read", id: row.id })}
                    >
                      标为已读
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}

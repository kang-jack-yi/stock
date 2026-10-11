"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Table, Tag } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { fetchJson } from "@/lib/api";
import { calculatePortfolioRisk, validatePortfolioRisk } from "@/lib/portfolio-risk";
import type { PortfolioRiskSettings } from "@/lib/portfolio-risk";
import type { PortfolioResult } from "@/lib/portfolio-types";
import { number, signed } from "@/lib/format";
import { DataError, DataSkeleton } from "./data-state";
import "./portfolio-tools.css";

/** 用户自定义目标与假设损失，以完整总资产计算，不提供自动交易。 */
export function PortfolioRisk({
  portfolio,
  userId,
}: {
  /** 当前账本真实报价估值。 */ portfolio: PortfolioResult;
  /** 只用于隔离前端缓存，不传给 API。 */ userId: string;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PortfolioRiskSettings>();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const { data, error, mutate } = useSWR<PortfolioRiskSettings>(
    ["/api/portfolio/risk", userId],
    ([url]: [string, string]) => fetchJson(url),
    // 焦点切换先由 Providers 核实会话，避免旧账号键请求新会话设置。
    { revalidateOnFocus: false },
  );
  const risk = data ? calculatePortfolioRisk(portfolio, data) : null;
  /** 打开编辑时取当前设置，行情轮询不会覆盖用户草稿。 */
  function edit() {
    if (!data) return;
    form.resetFields();
    form.setFieldsValue(data);
    setOpen(true);
  }
  /** 空目标保持未设置，完整验证目标合计后同源保存。 */
  async function save(values: PortfolioRiskSettings) {
    setBusy(true);
    try {
      const settings = {
        stockLimit: values.stockLimit ?? null,
        cashTarget: values.cashTarget ?? null,
        assumedDrop: values.assumedDrop,
        targets: (values.targets || []).map((target) => ({
          symbol: target.symbol.trim().toLowerCase(),
          weight: target.weight,
        })),
      };
      validatePortfolioRisk(settings);
      await fetchJson("/api/portfolio/risk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      await mutate();
      setOpen(false);
      message.success("组合目标已保存");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel portfolio-risk">
      <div className="panel-heading">
        <div>
          <h2>组合风险与目标仓位</h2>
          <span className="panel-caption">以含现金的总资产为分母 · 目标由你设置 · 不自动交易</span>
        </div>
        <Button disabled={!data} onClick={edit}>
          设置组合目标
        </Button>
      </div>
      {error ? (
        <DataError error={error} retry={mutate} />
      ) : !data || !risk ? (
        <DataSkeleton />
      ) : (
        <>
          <div className="portfolio-risk-summary">
            <span>
              单股上限：{data.stockLimit == null ? "未设置" : `${number(data.stockLimit)}%`}
            </span>
            <span>
              现金：{risk.cashWeight == null ? "—" : `${number(risk.cashWeight)}%`} / 目标{" "}
              {data.cashTarget == null ? "未设置" : `${number(data.cashTarget)}%`}
            </span>
            <span>
              现金偏离：
              {risk.cashWeight != null && data.cashTarget != null
                ? `${signed(risk.cashWeight - data.cashTarget)} 个百分点`
                : "—"}
            </span>
            <span>未分配目标：{number(risk.unallocated)}%</span>
          </div>
          {!risk.complete && (
            <Alert
              className="portfolio-risk-notice"
              type="warning"
              showIcon
              title={
                portfolio.missingSymbols.length
                  ? "行情不完整，暂不计算完整仓位比例和场景损失"
                  : "总资产为零，暂不计算仓位比例和场景损失"
              }
            />
          )}
          <Table
            rowKey="symbol"
            dataSource={risk.rows}
            scroll={{ x: 760 }}
            pagination={false}
            locale={{ emptyText: "暂无持仓或目标，点击设置组合目标" }}
            columns={[
              {
                title: "股票",
                dataIndex: "name",
                width: 150,
                render: (value, row) => (
                  <>
                    {value}
                    <small className="portfolio-symbol">{row.symbol}</small>
                  </>
                ),
              },
              {
                title: "实际仓位",
                dataIndex: "weight",
                render: (value) => (value == null ? "—" : `${number(value)}%`),
              },
              {
                title: "目标仓位",
                dataIndex: "target",
                render: (value) => (value == null ? "未设置" : `${number(value)}%`),
              },
              { title: "偏离（百分点）", dataIndex: "deviation", render: (value) => signed(value) },
              {
                title: "单股上限检查",
                dataIndex: "overLimit",
                render: (value) =>
                  value == null ? (
                    "待设置或估值"
                  ) : (
                    <Tag color={value ? "warning" : "success"}>{value ? "超过上限" : "上限内"}</Tag>
                  ),
              },
            ]}
          />
          <div className="portfolio-risk-scenario">
            <strong>假设所有股票同时下跌 {number(data.assumedDrop)}%</strong>
            <span>
              组合减少 {number(risk.loss)} 元 · 场景后总资产 {number(risk.afterDrop)} 元
            </span>
            <p>
              现金保持不变，仅按当前持仓市值进行静态测算。不是走势预测，不包含未来交易、费用或分红。
            </p>
          </div>
        </>
      )}
      <Modal
        title="设置组合目标与风险假设"
        open={open}
        onCancel={() => !busy && setOpen(false)}
        footer={null}
        width={640}
        closable={!busy}
        mask={{ closable: !busy }}
      >
        <Form form={form} layout="vertical" onFinish={save} className="portfolio-form">
          <div className="portfolio-fields">
            <Form.Item name="stockLimit" label="单股上限（占总资产 %）">
              <InputNumber
                aria-label="单股上限"
                min={0}
                max={100}
                precision={2}
                placeholder="留空不限制"
              />
            </Form.Item>
            <Form.Item name="cashTarget" label="现金目标（%）">
              <InputNumber
                aria-label="现金目标"
                min={0}
                max={100}
                precision={2}
                placeholder="留空不设置"
              />
            </Form.Item>
          </div>
          <Form.Item
            name="assumedDrop"
            label="假设所有股票下跌（%）"
            rules={[{ required: true, message: "请填写假设跌幅" }]}
          >
            <InputNumber aria-label="假设跌幅" min={0} max={100} precision={2} />
          </Form.Item>
          <Form.List name="targets">
            {(fields, { add, remove }) => (
              <>
                <p className="panel-caption">股票与现金目标合计最多 100%，其余显示未分配。</p>
                {fields.map(({ key, name, ...rest }) => (
                  <div className="portfolio-target-row" key={key}>
                    <Form.Item
                      {...rest}
                      name={[name, "symbol"]}
                      label="股票代码"
                      rules={[{ required: true, message: "填写带前缀的股票代码" }]}
                    >
                      <Input aria-label={`目标股票${name + 1}`} placeholder="sh600519" />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, "weight"]}
                      label="目标（%）"
                      rules={[{ required: true, message: "填写目标比重" }]}
                    >
                      <InputNumber
                        aria-label={`股票目标${name + 1}`}
                        min={0}
                        max={100}
                        precision={2}
                      />
                    </Form.Item>
                    <Button
                      aria-label={`删除目标${name + 1}`}
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(name)}
                    />
                  </div>
                ))}
                <Button
                  disabled={fields.length >= 60}
                  icon={<PlusOutlined />}
                  onClick={() => add({ symbol: "", weight: 0 })}
                >
                  添加股票目标
                </Button>
              </>
            )}
          </Form.List>
          <Button className="portfolio-save-target" type="primary" htmlType="submit" loading={busy}>
            保存组合目标
          </Button>
        </Form>
      </Modal>
    </section>
  );
}

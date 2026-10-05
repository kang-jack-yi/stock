"use client";

import { Button, Checkbox, Form, Input, InputNumber, Select, Tag } from "antd";
import { FilterOutlined, ReloadOutlined, UndoOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useMarketData } from "@/lib/api";
import type { ScreenerResult } from "@/lib/screener";
import { compact } from "@/lib/format";
import { StockTable } from "./stock-table";
import { DataError, DataMeta, DataSkeleton } from "./data-state";
import "./research-tools.css";

/** 表单单位与 API 一致，市值和成交额输入项在提交时从亿元转换为元。 */
interface FilterForm {
  /** 股票名称或代码查询。 */
  query?: string;
  /** 市场或交易板块标识。 */
  market?: string;
  /** 最低价，元。 */
  minPrice?: number;
  /** 最高价，元。 */
  maxPrice?: number;
  /** 涨跌幅下限，百分比数值。 */
  minChange?: number;
  /** 涨跌幅上限，百分比数值。 */
  maxChange?: number;
  /** PE 下限，倍。 */
  minPe?: number;
  /** PE 上限，倍。 */
  maxPe?: number;
  /** PB 上限，倍。 */
  maxPb?: number;
  /** 换手率下限，百分比数值。 */
  minTurnover?: number;
  /** 换手率上限，百分比数值。 */
  maxTurnover?: number;
  /** 总市值下限，亿元。 */
  minCap?: number;
  /** 总市值上限，亿元。 */
  maxCap?: number;
  /** 成交额下限，亿元。 */
  minAmount?: number;
  /** 仅展示正 PE 的证券。 */
  profitable?: boolean;
  /** 排除 ST 风险警示股票。 */
  excludeSt?: boolean;
  /** API 排序字段。 */
  sort?: string;
  /** asc 或 desc。 */
  order?: string;
}

const numberFields = [
  "minPrice",
  "maxPrice",
  "minChange",
  "maxChange",
  "minPe",
  "maxPe",
  "maxPb",
  "minTurnover",
  "maxTurnover",
  "minCap",
  "maxCap",
  "minAmount",
];
const moneyFields = ["minCap", "maxCap", "minAmount"];
/** URL 参数恢复为可读表单单位，让筛选结果能复制分享。 */
function formValues(query: string): FilterForm {
  const params = new URLSearchParams(query);
  const result: Record<string, string | number | boolean> = {
    market: "all",
    sort: "amount",
    order: "desc",
    excludeSt: false,
    profitable: false,
  };
  params.forEach((value, key) => {
    if (numberFields.includes(key)) {
      const number = Number(value);
      if (Number.isFinite(number)) result[key] = number / (moneyFields.includes(key) ? 1e8 : 1);
    } else if (["profitable", "excludeSt"].includes(key)) result[key] = value === "1";
    else if (["market", "sort", "order", "query"].includes(key)) result[key] = value;
  });
  return result;
}

/** 所有筛选先作用于完整市场，再做 20 行分页；表单编辑不会实时请求上游。 */
export function Screener({ query }: { query: string }) {
  const router = useRouter(),
    [form] = Form.useForm<FilterForm>();
  const params = new URLSearchParams(query),
    page = Number(params.get("page") || "1");
  const { data, error, isLoading, isValidating, mutate } = useMarketData<ScreenerResult>(
    `/api/screener?${query}`,
    false,
  );
  /** 转换数值单位并将提交后的条件同步到站内 URL。 */
  function apply(values: FilterForm) {
    const next = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (typeof value === "boolean") {
        if (value) next.set(key, "1");
      } else
        next.set(
          key,
          typeof value === "number" && moneyFields.includes(key)
            ? String(value * 1e8)
            : String(value),
        );
    });
    router.replace(`/screener?${next}`, { scroll: false });
  }
  /** 预设只提供透明的量化条件，不将筛选结果描述为投资建议。 */
  function preset(values: FilterForm) {
    const next = { market: "all", sort: "amount", order: "desc", excludeSt: true, ...values };
    apply(next);
  }
  /** 分页保留其他条件，并可通过浏览器回退恢复历史筛选。 */
  function paginate(value: number) {
    params.set("page", String(value));
    router.replace(`/screener?${params}`, { scroll: false });
  }
  const fields = [
    { label: "股价（元）", min: "minPrice", max: "maxPrice" },
    { label: "涨跌幅（%）", min: "minChange", max: "maxChange" },
    { label: "市盈率 PE（倍）", min: "minPe", max: "maxPe" },
    { label: "换手率（%）", min: "minTurnover", max: "maxTurnover" },
    { label: "总市值（亿元）", min: "minCap", max: "maxCap" },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">STOCK SCREENER</div>
          <h1>条件选股</h1>
          <p>把你的关注点，变成清晰的筛选条件。</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => mutate()} loading={isValidating}>
          刷新快照
        </Button>
      </div>
      <section className="panel screener-form-panel">
        <div className="panel-heading">
          <div>
            <h2>筛选工作台</h2>
            <span className="panel-caption">覆盖全部 A 股 · 五分钟快照 · 组合条件</span>
          </div>
          <FilterOutlined />
        </div>
        <div className="screener-presets">
          <span>快速开始</span>
          <Button
            onClick={() =>
              preset({ profitable: true, maxPe: 20, maxPb: 2, sort: "pe", order: "asc" })
            }
          >
            低估值
          </Button>
          <Button onClick={() => preset({ minCap: 1000, sort: "marketCap" })}>大盘公司</Button>
          <Button onClick={() => preset({ minTurnover: 5, minAmount: 1 })}>成交活跃</Button>
          <Button onClick={() => preset({ minChange: 3, minAmount: 1, sort: "changePercent" })}>
            今日强势
          </Button>
        </div>
        <Form
          form={form}
          layout="vertical"
          initialValues={formValues(query)}
          onFinish={apply}
          requiredMark={false}
        >
          <div className="screener-basic">
            <Form.Item name="query" label="名称 / 代码">
              <Input
                aria-label="选股名称或代码"
                placeholder="如 贵州茅台 / 600519"
                allowClear
                maxLength={40}
              />
            </Form.Item>
            <Form.Item name="market" label="市场范围">
              <Select
                aria-label="选股市场"
                options={[
                  { value: "all", label: "全部 A 股" },
                  { value: "sh", label: "沪市" },
                  { value: "sz", label: "深市" },
                  { value: "bj", label: "北交所" },
                  { value: "cyb", label: "创业板" },
                  { value: "kcb", label: "科创板" },
                ]}
              />
            </Form.Item>
          </div>
          <div className="screener-fields">
            {fields.map((field) => (
              <div className="filter-range" key={field.min}>
                <label>{field.label}</label>
                <div>
                  <Form.Item name={field.min}>
                    <InputNumber
                      aria-label={`${field.label}下限`}
                      placeholder="不限"
                      min={field.min === "minChange" ? -100 : 0}
                    />
                  </Form.Item>
                  <span>至</span>
                  <Form.Item name={field.max}>
                    <InputNumber
                      aria-label={`${field.label}上限`}
                      placeholder="不限"
                      min={field.max === "maxChange" ? -100 : 0}
                    />
                  </Form.Item>
                </div>
              </div>
            ))}
            <Form.Item name="maxPb" label="市净率 PB 上限（倍）">
              <InputNumber aria-label="市净率上限" placeholder="不限" min={0} />
            </Form.Item>
            <Form.Item name="minAmount" label="成交额下限（亿元）">
              <InputNumber aria-label="成交额下限" placeholder="不限" min={0} />
            </Form.Item>
          </div>
          <div className="screener-footer">
            <div>
              <Form.Item name="excludeSt" valuePropName="checked" noStyle>
                <Checkbox>排除 ST</Checkbox>
              </Form.Item>
              <Form.Item name="profitable" valuePropName="checked" noStyle>
                <Checkbox>仅正 PE</Checkbox>
              </Form.Item>
            </div>
            <div className="filter-sort">
              <Form.Item name="sort" noStyle>
                <Select
                  aria-label="选股排序指标"
                  options={[
                    { value: "amount", label: "成交额" },
                    { value: "changePercent", label: "涨跌幅" },
                    { value: "marketCap", label: "总市值" },
                    { value: "turnover", label: "换手率" },
                    { value: "price", label: "最新价" },
                    { value: "pe", label: "市盈率" },
                    { value: "pb", label: "市净率" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="order" noStyle>
                <Select
                  aria-label="选股排序方向"
                  options={[
                    { value: "desc", label: "从高到低" },
                    { value: "asc", label: "从低到高" },
                  ]}
                />
              </Form.Item>
              <Button
                icon={<UndoOutlined />}
                onClick={() => router.replace("/screener", { scroll: false })}
              >
                重置
              </Button>
              <Button type="primary" htmlType="submit" icon={<FilterOutlined />}>
                应用筛选
              </Button>
            </div>
          </div>
        </Form>
      </section>
      <section className="panel screener-results">
        <div className="panel-heading">
          <div>
            <h2>
              筛选结果 <Tag>{data?.data.total ?? "—"} 只</Tag>
            </h2>
            <span className="panel-caption">
              {data
                ? `全市场 ${data.data.universeTotal.toLocaleString()} 只证券中筛选 · 总成交额 ${compact(data.data.breadth.amount)}`
                : "正在获取完整 A 股快照，首次加载可能需要数秒"}
            </span>
          </div>
        </div>
        {error ? (
          <DataError error={error} retry={mutate} />
        ) : isLoading ? (
          <DataSkeleton rows={8} />
        ) : (
          <StockTable
            rows={data?.data.stocks || []}
            pagination={{
              current: page,
              total: data?.data.total || 0,
              pageSize: 20,
              showSizeChanger: false,
              onChange: paginate,
              showTotal: (total) => `共 ${total} 只符合条件`,
            }}
          />
        )}
        <p className="table-note">
          PE
          为数据源排行接口口径。缺失指标在对应条件启用时排除；快照分页抓取存在时间差，结果仅用于数据研究。
        </p>
        <DataMeta meta={data?.meta} />
      </section>
    </>
  );
}

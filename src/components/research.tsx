"use client";

import Link from "next/link";
import { Select } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useMarketData } from "@/lib/api";
import type { Quote } from "@/lib/types";
import { number, direction, percent } from "@/lib/format";
import { FundsPanel } from "./funds-panel";
import { FinancialPanel } from "./financial-panel";

const popular = [
  "sh600519",
  "sz000001",
  "sz300750",
  "sh601318",
  "sh600036",
  "sz000858",
  "sh601899",
  "sz002594",
];
/** 独立研究页按 URL 中股票切换；任意股票也可从全局搜索进入详情研究标签。 */
export function Research({ kind, symbol }: { kind: "funds" | "financials"; symbol: string }) {
  const router = useRouter();
  const { data } = useMarketData<Quote[]>(
    `/api/market/quotes?symbols=${[...new Set([...popular, symbol])].join(",")}`,
  );
  const quote = data?.data.find((row) => row.symbol === symbol);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {kind === "funds" ? "CAPITAL FLOW" : "FUNDAMENTAL RESEARCH"}
          </div>
          <h1>{kind === "funds" ? "资金流向" : "财务研究"}</h1>
          <p>
            {kind === "funds"
              ? "透过成交结构，观察资金的不同视角。"
              : "从财务数据，了解一家公司的经营底色。"}
          </p>
        </div>
      </div>
      <section className="panel research-picker">
        <div className="picker-main">
          <span className="small-muted">研究标的</span>
          <Select
            aria-label="选择研究股票"
            value={symbol}
            onChange={(value) => router.replace(`/${kind}?symbol=${value}`, { scroll: false })}
            options={(data?.data || [{ symbol, name: symbol }]).map((row) => ({
              value: row.symbol,
              label: `${row.name}  ${row.symbol.slice(2)}`,
            }))}
          />
          <strong className={`numeric ${direction(quote?.change)}`}>{number(quote?.price)}</strong>
          <span className={`change-pill ${direction(quote?.change)}`}>
            {percent(quote?.changePercent)}
          </span>
        </div>
        <Link className="text-link" href={`/stock/${symbol}?view=${kind}`}>
          股票详情 <ArrowRightOutlined />
        </Link>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{quote?.name || "正在获取股票名称"}</h2>
            <span className="panel-caption">
              {symbol.slice(2)} · {kind === "funds" ? "分类成交资金分析" : "报告期财务数据"}
            </span>
          </div>
        </div>
        {kind === "funds" ? <FundsPanel symbol={symbol} /> : <FinancialPanel symbol={symbol} />}
      </section>
    </>
  );
}

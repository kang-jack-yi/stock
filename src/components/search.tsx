"use client";

import { AutoComplete, Input, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMarketData } from "@/lib/api";
import type { SearchStock } from "@/lib/types";
import { exchange } from "@/lib/format";

/** 通过新浪搜索建议查询沪深北股票，避免每次键入都访问上游。 */
export function StockSearch({ large = false }: { large?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, isLoading, error } = useMarketData<SearchStock[]>(
    debounced ? `/api/market/search?q=${encodeURIComponent(debounced)}` : null,
    false,
  );
  /** 搜索结果始终使用服务端校验后的代码构建站内详情地址。 */
  function select(symbol: string) {
    setQuery("");
    setDebounced("");
    router.push(`/stock/${symbol}`);
  }
  return (
    <AutoComplete
      className={large ? "stock-search large" : "stock-search"}
      // 最多 12 项，无需虚拟滚动；实际选项节点便于屏幕阅读器读取股票名称。
      virtual={false}
      value={query}
      onChange={setQuery}
      onSelect={select}
      options={(data?.data || []).map((stock) => ({
        value: stock.symbol,
        label: (
          <div className="search-result">
            <strong>{stock.name}</strong>
            <span>
              {stock.code}
              <small>{exchange(stock.symbol)}</small>
            </span>
          </div>
        ),
      }))}
      notFoundContent={
        isLoading ? <Spin size="small" /> : error ? "搜索暂不可用，请重试" : "未找到相关股票"
      }
    >
      <Input
        prefix={<SearchOutlined />}
        aria-label="搜索股票"
        placeholder="搜索股票名称 / 代码 / 拼音"
        allowClear
        maxLength={40}
        suffix={isLoading ? <Spin size="small" /> : <kbd>搜索</kbd>}
      />
    </AutoComplete>
  );
}

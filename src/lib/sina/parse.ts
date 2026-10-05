import type { Candle, Financials, Funds, MarketStock, Numeric, Quote, SearchStock } from "../types";

export const symbolPattern = /^(sh|sz|bj)\d{6}$/;
/** 校验沪、深、北证券代码，禁止将用户输入拼接为任意上游 URL。 */
export function validSymbol(symbol: string) {
  if (!symbolPattern.test(symbol)) throw new Error("股票代码格式不正确");
  return symbol;
}
/** 将上游数字字符串转换为有限数值，缺失和无效值保留为 null。 */
export function numeric(value: unknown): Numeric {
  if (value == null || value === "" || value === "--") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
/** 价格与股本需大于零，零报价或无效报价按缺失处理。 */
function positive(value: unknown) {
  const n = numeric(value);
  return n != null && n > 0 ? n : null;
}
/** 只提取行情赋值语句中的字符串，不执行新浪返回的 JavaScript。 */
export function parseAssignments(text: string) {
  return Object.fromEntries(
    [...text.matchAll(/var\s+hq_str_(\w+)\s*=\s*"([^"]*)"\s*;/g)].map((m) => [
      m[1],
      m[2].split(","),
    ]),
  );
}
/** 解析实时行情、五档盘口和扩展估值字段，并统一股数与金额单位。 */
export function parseQuotes(text: string, symbols: string[]): Quote[] {
  const records = parseAssignments(text);
  return symbols.flatMap((symbol) => {
    const f = records[symbol];
    if (!f || f.length < 33 || !f[0]) return [];
    const info = records[`${symbol}_i`] ?? [];
    const price = positive(f[3]),
      previousClose = positive(f[2]);
    const change = price != null && previousClose != null ? price - previousClose : null;
    const totalShares = positive(info[7]),
      floatShares = positive(info[8]);
    const shares = totalShares == null ? null : totalShares * 10000;
    const floating = floatShares == null ? null : floatShares * 10000;
    const eps = positive(info[3]),
      bookValue = positive(info[5]);
    return [
      {
        symbol,
        name: f[0],
        price,
        previousClose,
        open: positive(f[1]),
        high: positive(f[4]),
        low: positive(f[5]),
        change,
        changePercent:
          change != null && previousClose != null ? (change / previousClose) * 100 : null,
        // 沪市指数快照为手；深市指数与个股快照已为股。项目接口统一为股。
        volume: (Number(f[8]) || 0) * (/^sh000\d{3}$/.test(symbol) ? 100 : 1),
        amount: Number(f[9]) || 0,
        date: f[30],
        time: f[31],
        status: f[32],
        bids: Array.from({ length: 5 }, (_, i) => ({
          volume: Number(f[10 + i * 2]) || 0,
          price: positive(f[11 + i * 2]),
        })),
        asks: Array.from({ length: 5 }, (_, i) => ({
          volume: Number(f[20 + i * 2]) || 0,
          price: positive(f[21 + i * 2]),
        })),
        totalShares: shares,
        floatShares: floating,
        marketCap: shares != null && price != null ? shares * price : null,
        floatCap: floating != null && price != null ? floating * price : null,
        pe: price != null && eps != null ? price / eps : null,
        pb: price != null && bookValue != null ? price / bookValue : null,
        turnover: floating != null ? (Number(f[8]) / floating) * 100 : null,
        amplitude:
          previousClose != null ? ((Number(f[4]) - Number(f[5])) / previousClose) * 100 : null,
      },
    ];
  });
}
/** 解析排行 JSON，将原始万元市值换算为元。 */
export function parseMarket(text: string): MarketStock[] {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("股票列表暂不可用");
  return rows.map((r) => ({
    symbol: String(r.symbol),
    name: String(r.name),
    price: positive(r.trade),
    change: numeric(r.pricechange),
    changePercent: numeric(r.changepercent),
    volume: numeric(r.volume) ?? 0,
    amount: numeric(r.amount) ?? 0,
    pe: numeric(r.per),
    pb: numeric(r.pb),
    turnover: numeric(r.turnoverratio),
    marketCap: r.mktcap == null ? null : Number(r.mktcap) * 10000,
    floatCap: r.nmc == null ? null : Number(r.nmc) * 10000,
    time: String(r.ticktime ?? ""),
  }));
}
/** 解析未复权 OHLC，剔除不完整记录；该源的个股和指数成交量均已为股。 */
export function parseCandles(text: string): Candle[] {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("该股票暂无此周期的 K 线数据");
  return rows.flatMap((r) => {
    const values = [r.open, r.close, r.high, r.low, r.volume].map(numeric);
    if (values.some((v) => v == null)) return [];
    return [
      {
        date: String(r.day),
        open: Number(r.open),
        close: Number(r.close),
        high: Number(r.high),
        low: Number(r.low),
        volume: Number(r.volume),
      },
    ];
  });
}
/** 提取搜索建议并按证券代码去重，仅保留本站支持的 A 股证券。 */
export function parseSearch(text: string): SearchStock[] {
  const payload = text.match(/=\s*"([^"]*)"/)?.[1] ?? "";
  const seen = new Set<string>();
  return payload
    .split(";")
    .flatMap((record) => {
      const f = record.split(","),
        symbol = f[3];
      if (!symbol || !symbolPattern.test(symbol) || seen.has(symbol)) return [];
      seen.add(symbol);
      return [{ symbol, name: f[4] || f[6] || symbol, code: f[2] }];
    })
    .slice(0, 12);
}
/** 从 JSONP 包装中安全提取 JSON，按上游单笔分类计算成交方向净流入。 */
export function parseFunds(text: string, symbol: string): Funds {
  const json = text.match(/=\s*\((\{[\s\S]*\})\)\s*;/)?.[1];
  if (!json) throw new Error("该股票暂无资金流向数据");
  const d = JSON.parse(json);
  if (!d.opendate) throw new Error("该股票暂无资金流向数据");
  const categories = ["特大单", "大单", "小单", "散单"].map((name, i) => {
    const inflow = Number(d[`r${i}_in`]) || 0,
      outflow = Number(d[`r${i}_out`]) || 0;
    return { name, inflow, outflow, net: inflow - outflow };
  });
  return {
    symbol,
    date: d.opendate,
    time: d.ticktime,
    categories,
    net: categories.reduce((sum, c) => sum + c.net, 0),
  };
}
/** 合并最近报告期指标，保留缺失值、分组、单位及同比的小数比例口径。 */
export function parseFinancials(text: string, symbol: string, source: string): Financials {
  const result = JSON.parse(text).result;
  if (result?.status?.code !== 0 || !result?.data?.report_list)
    throw new Error("该股票暂无财务报表数据");
  const reports = result.data.report_list;
  const dates: string[] = result.data.report_date
    .map((r: { date_value: string }) => r.date_value)
    .filter((date: string) => reports[date]);
  if (!dates.length) throw new Error("该股票暂无财务报表数据");
  /** 新浪报告中每一项的原始字段，值在输出前通过 numeric 校验。 */
  type Item = {
    /** 上游指标代码，空值表示分组。 */
    item_field: string;
    /** 指标或分组名称。 */
    item_title: string;
    /** 上游值，可能是数字字符串或缺失标记。 */
    item_value: unknown;
    /** 同比小数比例，如 0.1 代表 10%。 */
    item_tongbi: unknown;
    /** 单位与显示精度编码，p 为百分比、ps 为每股金额。 */
    item_precision: string;
  };
  const all = new Map<string, Item>();
  const key = (item: Item) => `${item.item_field}|${item.item_title}`;
  for (const date of dates)
    for (const item of reports[date].data as Item[])
      if (!all.has(key(item))) all.set(key(item), item);
  const byDate = dates.map(
    (date) =>
      new Map<string, Item>((reports[date].data as Item[]).map((item) => [key(item), item])),
  );
  const rows = [...all.values()].map((item) => ({
    field: key(item),
    title: item.item_title,
    heading: !item.item_field,
    values: byDate.map((items) => numeric(items.get(key(item))?.item_value)),
    yoy: numeric(byDate[0].get(key(item))?.item_tongbi),
    // p2 是百分比数值（如 16.75），ps4 是每股元值；同比字段才是小数比例。
    unit: !item.item_field
      ? ""
      : item.item_precision?.startsWith("ps")
        ? "元/股"
        : item.item_precision?.startsWith("p")
          ? "%"
          : /天数/.test(item.item_title)
            ? "天"
            : /周转率/.test(item.item_title)
              ? "次"
              : /比率/.test(item.item_title)
                ? "倍"
                : source === "gjzb" && item.item_precision === "f4"
                  ? ""
                  : "元",
  }));
  return {
    symbol,
    source,
    dates,
    rows,
    currency: reports[dates[0]].rCurrency || "CNY",
    publishedAt: reports[dates[0]].publish_date || "",
  };
}

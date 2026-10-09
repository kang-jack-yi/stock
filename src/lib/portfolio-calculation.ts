import type {
  PortfolioInput,
  PortfolioPosition,
  PortfolioResult,
  PortfolioTransaction,
} from "./portfolio-types";
import type { Quote } from "./types";

/** 金额结算至分，避免连续记账的二进制小数误差。 */
function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 中国标准时间的今天，服务器时区不影响日期校验。 */
export function portfolioToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);
}

/** 验证各记录字段用途，拒绝未来日期、指数、无效股数与隐含金额。 */
export function validatePortfolioInput(input: PortfolioInput, today = portfolioToday()) {
  const parsed = new Date(`${input.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== input.date ||
    input.date > today
  )
    throw new Error("发生日期必须为有效日期，且不能晚于今天");
  if (!["deposit", "withdraw", "buy", "sell", "dividend", "bonus"].includes(input.kind))
    throw new Error("账本记录类型不正确");
  if (
    [input.amount, input.price, input.quantity, input.fee].some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1e10,
    )
  )
    throw new Error("账本数值必须为有效非负数，且不超过 100 亿");
  if (
    [input.amount, input.price, input.fee].some(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) > 1e-5,
    )
  )
    throw new Error("金额和成交单价最多保留两位小数");
  if (!Number.isInteger(input.quantity)) throw new Error("股数必须为整数");
  const cash = input.kind === "deposit" || input.kind === "withdraw";
  if (!cash && !/^(sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj[489]\d{5})$/.test(input.symbol))
    throw new Error("仅支持沪深北 A 股股票，指数不能记入持仓");
  if (cash && (input.symbol || input.quantity || input.price || input.fee || input.amount <= 0))
    throw new Error("入金与出金只填写正数金额");
  if (
    (input.kind === "buy" || input.kind === "sell") &&
    (input.quantity <= 0 ||
      input.price <= 0 ||
      input.amount !== 0 ||
      input.quantity * input.price > 1e12)
  )
    throw new Error("买卖记录须填写正数股数和单价，不填写现金金额");
  if (
    input.kind === "dividend" &&
    (input.amount <= 0 || input.quantity || input.price || input.fee)
  )
    throw new Error("现金分红只填写实际税后到账金额");
  if (input.kind === "bonus" && (input.quantity <= 0 || input.price || input.amount || input.fee))
    throw new Error("送转股只填写新增整数股数");
  if (input.note.length > 200) throw new Error("备注最多 200 字");
}

/** 日期再序号完整回放移动加权成本；任一历史节点超卖或现金为负即拒绝。 */
export function replayPortfolio(transactions: PortfolioTransaction[]) {
  let cash = 0,
    netDeposits = 0;
  const positions = new Map<string, PortfolioPosition>();
  const records = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence,
  );
  for (const record of records) {
    validatePortfolioInput(record);
    if (record.kind === "deposit") {
      cash = money(cash + record.amount);
      netDeposits = money(netDeposits + record.amount);
    } else if (record.kind === "withdraw") {
      cash = money(cash - record.amount);
      netDeposits = money(netDeposits - record.amount);
    } else {
      const position = positions.get(record.symbol) || {
        symbol: record.symbol,
        quantity: 0,
        cost: 0,
        realized: 0,
        lastDate: record.date,
      };
      const gross = money(record.quantity * record.price);
      if (record.kind === "buy") {
        cash = money(cash - gross - record.fee);
        position.quantity += record.quantity;
        position.cost = money(position.cost + gross + record.fee);
      } else if (record.kind === "sell") {
        if (record.quantity > position.quantity)
          throw new Error(`${record.date} ${record.symbol} 卖出股数超过当时持仓`);
        const removedCost =
          record.quantity === position.quantity
            ? position.cost
            : money((position.cost * record.quantity) / position.quantity);
        position.quantity -= record.quantity;
        position.cost = money(position.cost - removedCost);
        position.realized = money(position.realized + gross - record.fee - removedCost);
        cash = money(cash + gross - record.fee);
      } else if (record.kind === "dividend") {
        position.realized = money(position.realized + record.amount);
        cash = money(cash + record.amount);
      } else {
        if (!position.quantity)
          throw new Error(`${record.date} ${record.symbol} 送转股前必须有持仓`);
        position.quantity += record.quantity;
      }
      position.lastDate = record.date;
      positions.set(record.symbol, position);
    }
    if (cash < 0) throw new Error(`${record.date} 现金余额不足，请先记录入金`);
  }
  if (positions.size > 60) throw new Error("每个账号最多记录 60 个证券");
  return { cash, netDeposits, positions: [...positions.values()] };
}

/** 使用真实报价估值；缺失报价保持 null，已清仓收益不依赖行情。 */
export function valuePortfolio(
  transactions: PortfolioTransaction[],
  quotes: Quote[],
  warning = "",
): PortfolioResult {
  const replay = replayPortfolio(transactions);
  const holdings = replay.positions.map((position) => {
    const quote = quotes.find((quote) => quote.symbol === position.symbol);
    const quoteDate = quote?.date ? new Date(`${quote.date}T00:00:00Z`) : null;
    const validDate =
      !!quoteDate &&
      Number.isFinite(quoteDate.getTime()) &&
      /^\d{4}-\d{2}-\d{2}$/.test(quote!.date) &&
      quoteDate.toISOString().slice(0, 10) === quote!.date;
    const price =
      quote?.price != null &&
      Number.isFinite(quote.price) &&
      quote.price > 0 &&
      validDate &&
      /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(quote.time) &&
      quote.date >= position.lastDate &&
      quote.date <= portfolioToday()
        ? quote.price
        : null;
    const marketValue =
      position.quantity === 0 ? 0 : price == null ? null : money(position.quantity * price);
    const unrealized = marketValue == null ? null : money(marketValue - position.cost);
    return {
      ...position,
      name: quote?.name || position.symbol,
      averageCost: position.quantity ? position.cost / position.quantity : null,
      price,
      quoteAt: quote ? `${quote.date} ${quote.time}` : "",
      marketValue,
      unrealized,
      contribution: unrealized == null ? null : money(position.realized + unrealized),
      concentration: null as number | null,
    };
  });
  const missingSymbols = holdings
    .filter((holding) => holding.quantity > 0 && holding.marketValue == null)
    .map((holding) => holding.symbol);
  const knownMarketValue = money(
    holdings.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0),
  );
  const marketValue = missingSymbols.length ? null : knownMarketValue;
  const cost = money(holdings.reduce((sum, holding) => sum + holding.cost, 0));
  const realized = money(holdings.reduce((sum, holding) => sum + holding.realized, 0));
  const totalAssets = marketValue == null ? null : money(replay.cash + marketValue);
  for (const holding of holdings)
    holding.concentration =
      marketValue && holding.marketValue != null ? (holding.marketValue / marketValue) * 100 : null;
  return {
    transactions,
    holdings,
    cash: replay.cash,
    netDeposits: replay.netDeposits,
    cost,
    realized,
    knownMarketValue,
    marketValue,
    totalAssets,
    unrealized: marketValue == null ? null : money(marketValue - cost),
    totalProfit: totalAssets == null ? null : money(totalAssets - replay.netDeposits),
    exposure: totalAssets && marketValue != null ? (marketValue / totalAssets) * 100 : null,
    missingSymbols,
    fetchedAt: new Date().toISOString(),
    warning:
      warning ||
      (missingSymbols.length ? "部分持仓缺少有效报价，完整估值暂不可用；请检查实际行情日期" : ""),
  };
}

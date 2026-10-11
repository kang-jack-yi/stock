import type { PortfolioResult } from "./portfolio-types";

/** 单个股票目标，不自动推断未配置股票的目标。 */
export interface PortfolioTarget {
  /** 沪深北 A 股代码。 */
  symbol: string;
  /** 目标占总资产百分比。 */
  weight: number;
}

/** 用户目标与风险假设，百分比 20 表示 20%，不生成真实交易。 */
export interface PortfolioRiskSettings {
  /** 单股占总资产上限；null 表示未设置。 */
  stockLimit: number | null;
  /** 目标现金占总资产百分比；null 表示未设置。 */
  cashTarget: number | null;
  /** 股票目标占总资产百分比，最多 60 项；未列出证券不推断目标。 */
  targets: PortfolioTarget[];
  /** 所有持仓同时下跌的假设百分比，0 至 100。 */
  assumedDrop: number;
}

/** 单股风险检查；缺少完整估值时比例与超限判定为 null。 */
export interface PortfolioRiskRow {
  /** 股票代码。 */
  symbol: string;
  /** 股票名称，缺少真实名称时使用代码。 */
  name: string;
  /** 实际占总资产百分比。 */
  weight: number | null;
  /** 用户目标百分比，未设置为 null。 */
  target: number | null;
  /** 实际减目标的百分点数。 */
  deviation: number | null;
  /** 是否超过用户单股上限；上限未设置或无法估值为 null。 */
  overLimit: boolean | null;
}

/** 完整组合风险与静态假设结果，不是预测或交易建议。 */
export interface PortfolioRiskResult {
  /** 当前持仓及额外配置目标的股票。 */
  rows: PortfolioRiskRow[];
  /** 是否具有完整报价且总资产大于零。 */
  complete: boolean;
  /** 现金占总资产百分比，估值不完整为 null。 */
  cashWeight: number | null;
  /** 100 减已设置现金与股票目标的百分比。 */
  unallocated: number;
  /** 假设全部股票同时下跌后的组合减少金额，元；不完整为 null。 */
  loss: number | null;
  /** 假设下跌后的总资产，元；不完整为 null。 */
  afterDrop: number | null;
}
/** 未设置限制与目标，默认跌幅仅为清楚标识的场景假设。 */
export const defaultPortfolioRisk: PortfolioRiskSettings = {
  stockLimit: null,
  cashTarget: null,
  targets: [],
  assumedDrop: 10,
};

/** 验证目标合计不超过 100%，未知部分保持未分配，不假设行业或自动调仓。 */
export function validatePortfolioRisk(settings: PortfolioRiskSettings) {
  const values = [
    settings.stockLimit,
    settings.cashTarget,
    settings.assumedDrop,
    ...settings.targets.map((target) => target.weight),
  ];
  if (
    values.some(
      (value) =>
        value != null &&
        (!Number.isFinite(value) ||
          value < 0 ||
          value > 100 ||
          Math.abs(value * 100 - Math.round(value * 100)) > 1e-5),
    )
  )
    throw new Error("比例须为 0 至 100，最多两位小数");
  if (
    settings.targets.length > 60 ||
    new Set(settings.targets.map((target) => target.symbol)).size !== settings.targets.length
  )
    throw new Error("目标最多 60 个证券，股票代码不能重复");
  if (
    settings.targets.some(
      (target) => !/^(sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj[489]\d{5})$/.test(target.symbol),
    )
  )
    throw new Error("目标仅支持沪深北 A 股代码");
  if (
    (settings.cashTarget ?? 0) + settings.targets.reduce((sum, target) => sum + target.weight, 0) >
    100 + 1e-8
  )
    throw new Error("现金与股票目标合计不能超过 100%");
}

/** 完整总资产为比例分母；缺任一持仓报价不产生局部仓位或完整场景损失。 */
export function calculatePortfolioRisk(
  portfolio: PortfolioResult,
  settings: PortfolioRiskSettings,
): PortfolioRiskResult {
  validatePortfolioRisk(settings);
  const total = portfolio.totalAssets;
  const complete =
    portfolio.missingSymbols.length === 0 &&
    total != null &&
    total > 0 &&
    portfolio.marketValue != null;
  const symbols = [
    ...new Set([
      ...portfolio.holdings
        .filter((holding) => holding.quantity > 0)
        .map((holding) => holding.symbol),
      ...settings.targets.map((target) => target.symbol),
    ]),
  ];
  const rows = symbols.map((symbol) => {
    const holding = portfolio.holdings.find(
      (holding) => holding.symbol === symbol && holding.quantity > 0,
    );
    const target = settings.targets.find((target) => target.symbol === symbol)?.weight ?? null;
    const weight = complete ? ((holding?.marketValue ?? 0) / total) * 100 : null;
    return {
      symbol,
      name: holding?.name || symbol,
      weight,
      target,
      deviation: weight != null && target != null ? weight - target : null,
      overLimit:
        weight != null && settings.stockLimit != null ? weight > settings.stockLimit : null,
    };
  });
  const loss = complete ? (portfolio.marketValue! * settings.assumedDrop) / 100 : null;
  return {
    rows,
    complete,
    cashWeight: complete ? (portfolio.cash / total) * 100 : null,
    unallocated: Math.max(
      0,
      100 -
        (settings.cashTarget ?? 0) -
        settings.targets.reduce((sum, target) => sum + target.weight, 0),
    ),
    loss,
    afterDrop: loss != null ? total! - loss : null,
  };
}

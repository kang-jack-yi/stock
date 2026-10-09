import type { Financials, Numeric } from "./types";

/** 分析口径；单季度只对可加和的流量指标作同年累计差分。 */
export type FinancialPeriod = "cumulative" | "quarter";

/** 对齐关键指标报告日期的分析结果，金额保留元，比例为百分数。 */
export interface FinancialAnalysis {
  /** 营业总收入；单季度缺少同年上一累计期时为 null。 */
  revenue: Numeric[];
  /** 归母净利润，与营业总收入使用相同期间。 */
  profit: Numeric[];
  /** 经营活动现金流量净额，与营业总收入使用相同期间。 */
  cashFlow: Numeric[];
  /** 净利润 / 营业收入 × 100，不能用归母净利润或营业总收入替代。 */
  netMargin: Numeric[];
  /** 上游期末资产负债率，不随分析期间转换。 */
  debtRatio: Numeric[];
  /** 对应上年同季度的营业总收入增长率，百分数口径。 */
  revenueYoy: Numeric[];
  /** 对应上年同季度的归母净利润增长率，百分数口径。 */
  profitYoy: Numeric[];
  /** 对应上年同季度的经营现金流增长率，百分数口径。 */
  cashFlowYoy: Numeric[];
}

/** 按字段代码寻找行，避免相同指标在多个分组重复出现造成误匹配。 */
export function financialRow(report: Financials | undefined, field: string) {
  return report?.rows.find((row) => !row.heading && row.field.split("|")[0] === field);
}

/** 校验标准季度末报告日期；异常日期不参与季度转换和同比。 */
function quarterDate(date: string) {
  return /^\d{4}(0331|0630|0930|1231)$/.test(date);
}

/** 从累计流量中提取单季度；一季度直接取值，其余季度只减同年相邻累计期。 */
export function quarterlyValues(dates: string[], values: Numeric[]): Numeric[] {
  return dates.map((date, index) => {
    const current = values[index];
    if (!quarterDate(date) || current == null || !Number.isFinite(current)) return null;
    const quarter = ["0331", "0630", "0930", "1231"].indexOf(date.slice(4));
    if (quarter === 0) return current;
    const previousDate = `${date.slice(0, 4)}${["0331", "0630", "0930"][quarter - 1]}`;
    const previousIndex = dates.indexOf(previousDate);
    const previous = values[previousIndex];
    return previousIndex < 0 || previous == null || !Number.isFinite(previous)
      ? null
      : current - previous;
  });
}

/** 同比采用 (本期 - 上年同期) / |上年同期|，零基数与缺失值不计算。 */
export function sameQuarterYoy(dates: string[], values: Numeric[]): Numeric[] {
  return dates.map((date, index) => {
    if (!quarterDate(date)) return null;
    const previousIndex = dates.indexOf(`${Number(date.slice(0, 4)) - 1}${date.slice(4)}`);
    const previous = values[previousIndex],
      current = values[index];
    return current == null ||
      previous == null ||
      previous === 0 ||
      !Number.isFinite(current) ||
      !Number.isFinite(previous)
      ? null
      : ((current - previous) / Math.abs(previous)) * 100;
  });
}

/** 组合分析指标；利润表净利率按日期对齐，缺失不回填、不沿用相邻期。 */
export function analyzeFinancials(
  report: Financials,
  income: Financials | undefined,
  period: FinancialPeriod,
): FinancialAnalysis {
  /** 仅提取已核实的流量字段，保留原始报告对象不变。 */
  const values = (field: string, bankField?: string) => {
    // 银行关键指标使用 BIZINCO 和 NETPARECOMPPROF，已核实名称和金额口径一致。
    const row =
      financialRow(report, field) ?? (bankField ? financialRow(report, bankField) : undefined);
    const original = report.dates.map((_, index) => row?.values[index] ?? null);
    return period === "quarter" ? quarterlyValues(report.dates, original) : original;
  };
  const revenue = values("BIZTOTINCO", "BIZINCO"),
    profit = values("PARENETP", "NETPARECOMPPROF"),
    cashFlow = values("MANANETR");
  const netProfitRow = financialRow(income, "NETPROFIT"),
    incomeRow = financialRow(income, "BIZINCO");
  const incomeDates = income?.dates ?? [];
  const netProfits = incomeDates.map((_, index) => netProfitRow?.values[index] ?? null);
  const revenues = incomeDates.map((_, index) => incomeRow?.values[index] ?? null);
  const numerator = period === "quarter" ? quarterlyValues(incomeDates, netProfits) : netProfits;
  const denominator = period === "quarter" ? quarterlyValues(incomeDates, revenues) : revenues;
  const margin = financialRow(report, "SNPMARGINCONMS"),
    debt = financialRow(report, "ASSLIABRT");
  const netMargin = report.dates.map((date, index) => {
    if (period === "cumulative") return margin?.values[index] ?? null;
    const incomeIndex = incomeDates.indexOf(date);
    const net = numerator[incomeIndex],
      sales = denominator[incomeIndex];
    return net == null || sales == null || sales === 0 ? null : (net / sales) * 100;
  });
  return {
    revenue,
    profit,
    cashFlow,
    netMargin,
    debtRatio: report.dates.map((_, index) => debt?.values[index] ?? null),
    revenueYoy: sameQuarterYoy(report.dates, revenue),
    profitYoy: sameQuarterYoy(report.dates, profit),
    cashFlowYoy: sameQuarterYoy(report.dates, cashFlow),
  };
}

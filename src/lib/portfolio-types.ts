/** 手工账本业务种类；不连接券商或自动同步交易。 */
export type TransactionKind = "deposit" | "withdraw" | "buy" | "sell" | "dividend" | "bonus";

/** POST/PATCH 持仓账本记录；所有金额使用人民币元。 */
export interface PortfolioInput {
  /** 发生日期，中国标准时间 YYYY-MM-DD。 */
  date: string;
  /** 入金、出金、买入、卖出、税后现金分红或新增送转股。 */
  kind: TransactionKind;
  /** 股票代码；入金/出金为空，禁止录入指数。 */
  symbol: string;
  /** 买卖数量或新增送转股数，非负整数股。 */
  quantity: number;
  /** 买卖成交单价，元。 */
  price: number;
  /** 入金/出金或实际到账税后现金分红金额，元。 */
  amount: number;
  /** 买卖实际交易费用合计，元。 */
  fee: number;
  /** 用户备注，最多 200 字。 */
  note: string;
}

/** 账号独立的持久化记录，回放顺序为日期再序号。 */
export interface PortfolioTransaction extends PortfolioInput {
  /** 不可猜测的操作编号。 */
  id: string;
  /** 同日稳定回放序号；编辑保留原序号。 */
  sequence: number;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
}

/** 移动加权成本法回放后的个股账面状态，包括已清仓证券。 */
export interface PortfolioPosition {
  /** 股票代码。 */
  symbol: string;
  /** 剩余股数。 */
  quantity: number;
  /** 剩余总成本，买入含费用，卖出按加权成本结转。 */
  cost: number;
  /** 已实现卖出盈亏加实际税后现金分红。 */
  realized: number;
  /** 最近一次涉及该证券的记录日期。 */
  lastDate: string;
}

/** 行情估值后的个股持仓与盈亏贡献。 */
export interface PortfolioHolding extends PortfolioPosition {
  /** 行情名称；缺失时使用代码。 */
  name: string;
  /** 每股加权成本；已清仓为 null。 */
  averageCost: number | null;
  /** 最新有效报价，元；缺失或早于账本记录时为 null。 */
  price: number | null;
  /** 实际报价日期时间，中国标准时间；缺失时为空。 */
  quoteAt: string;
  /** 持仓市值，元；持仓缺少报价时为 null。 */
  marketValue: number | null;
  /** 未实现盈亏，元；缺少有效报价时为 null。 */
  unrealized: number | null;
  /** 已实现与浮动盈亏之和，元；估值不完整为 null。 */
  contribution: number | null;
  /** 占股票市值比例百分比；任何持仓报价缺失时为 null。 */
  concentration: number | null;
}

/** GET /api/portfolio 的账号账本与当前估值，不使用未复权历史 K 线。 */
export interface PortfolioResult {
  /** 日期/序号升序的手工记录，最多 1000 条。 */
  transactions: PortfolioTransaction[];
  /** 包含已清仓证券的持仓与收益贡献。 */
  holdings: PortfolioHolding[];
  /** 当前现金余额，元。 */
  cash: number;
  /** 累计入金减出金，元。 */
  netDeposits: number;
  /** 当前剩余股票账面总成本，元。 */
  cost: number;
  /** 已实现卖出盈亏与现金分红合计，元。 */
  realized: number;
  /** 有有效报价的持仓市值小计，不能当作完整股票市值。 */
  knownMarketValue: number;
  /** 完整股票市值；任何持仓无有效报价为 null。 */
  marketValue: number | null;
  /** 现金加完整股票市值；行情不全时为 null。 */
  totalAssets: number | null;
  /** 完整持仓浮动盈亏；行情不全时为 null。 */
  unrealized: number | null;
  /** 总资产减净入金；行情不全时为 null，不等于年化收益率。 */
  totalProfit: number | null;
  /** 股票市值/总资产的百分比；行情不全或总资产为零时为 null。 */
  exposure: number | null;
  /** 无有效估值的持仓代码，不用零补齐。 */
  missingSymbols: string[];
  /** 获取估值的系统时间，ISO。 */
  fetchedAt: string;
  /** 上游行情失败、缓存降级或估值缺失说明。 */
  warning: string;
}

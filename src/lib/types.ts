/** 缺失值统一为 null；0 表示真实零值，不能用于填充缺失指标。 */
export type Numeric = number | null;

/** 盘口一档；买卖数组均按一档至五档排列。 */
export interface BookLevel {
  /** 委托价格，元；空档为 null。 */
  price: Numeric;
  /** 委托数量，股；展示为手时除以 100。 */
  volume: number;
}

/** GET /api/market/quotes 的规范化行情。 */
export interface Quote {
  /** 交易所前缀加六位代码，如 sh600519、sz000001、bj920344。 */
  symbol: string;
  /** 数据源证券名称。 */
  name: string;
  /** 最新成交价，个股单位元、指数单位点；无有效报价时为 null。 */
  price: Numeric;
  /** 昨收价，元或点。 */
  previousClose: Numeric;
  /** 当日开盘价，元或点。 */
  open: Numeric;
  /** 当日最高价，元或点。 */
  high: Numeric;
  /** 当日最低价，元或点。 */
  low: Numeric;
  /** 最新价减昨收价，元或点。 */
  change: Numeric;
  /** 百分比数值：1.86 表示 1.86%，不是 0.0186。 */
  changePercent: Numeric;
  /** 全天累计成交量，股；仅沪市指数快照的原始手数乘以 100，深市指数已为股。 */
  volume: number;
  /** 全天累计成交金额，元。 */
  amount: number;
  /** 行情实际交易日 YYYY-MM-DD；不等于请求日期。 */
  date: string;
  /** 行情源时间 HH:mm:ss，中国标准时间。 */
  time: string;
  /** 新浪原始状态码，保留原值。 */
  status: string;
  /** 买一至买五；指数没有有效盘口时档位价格为 null。 */
  bids: BookLevel[];
  /** 卖一至卖五。 */
  asks: BookLevel[];
  /** 总股本，股；原始万股已转换。 */
  totalShares: Numeric;
  /** 流通股本，股。 */
  floatShares: Numeric;
  /** 总市值，元，最新价 × 总股本。 */
  marketCap: Numeric;
  /** 流通市值，元。 */
  floatCap: Numeric;
  /** PE TTM，倍；最新价/近四季 EPS，EPS 不大于零时为 null。 */
  pe: Numeric;
  /** 市净率，倍；最新价/每股净资产。 */
  pb: Numeric;
  /** 换手率，百分比数值；成交股数/流通股数 × 100。 */
  turnover: Numeric;
  /** 振幅，百分比数值；（最高－最低）/昨收 × 100。 */
  amplitude: Numeric;
}

/** GET /api/market/list 的排行项。金额和成交量与 Quote 使用相同单位。 */
export interface MarketStock {
  /** 沪、深或北交易所股票代码。 */
  symbol: string;
  /** 证券名称。 */
  name: string;
  /** 最新价，元。 */
  price: Numeric;
  /** 涨跌额，元。 */
  change: Numeric;
  /** 涨跌幅，百分比数值。 */
  changePercent: Numeric;
  /** 成交量，股。 */
  volume: number;
  /** 成交额，元。 */
  amount: number;
  /** 上游排行接口的 PE，倍；不保证与详情 PE TTM 口径一致。 */
  pe: Numeric;
  /** 市净率，倍。 */
  pb: Numeric;
  /** 总市值，元；原始万元已转换。 */
  marketCap: Numeric;
  /** 流通市值，元。 */
  floatCap: Numeric;
  /** 换手率，百分比数值。 */
  turnover: Numeric;
  /** 数据源时间 HH:mm:ss；排行接口未提供完整交易日。 */
  time: string;
}

/** GET /api/market/candles 的未复权 OHLC，按时间升序。 */
export interface Candle {
  /** 日线 YYYY-MM-DD，分钟线 YYYY-MM-DD HH:mm:ss。 */
  date: string;
  /** 周期开盘价，元或点。 */
  open: number;
  /** 周期收盘价，元或点。 */
  close: number;
  /** 周期最高价，元或点。 */
  high: number;
  /** 周期最低价，元或点。 */
  low: number;
  /** 周期成交量，股。 */
  volume: number;
}

/** 交易日内的分时点，午间重复槽已按新浪规则移除。 */
export interface MinutePoint {
  /** 交易所当地分钟标签 HH:mm。 */
  time: string;
  /** 分钟价格，元或点。 */
  price: number;
  /** 当日累计成交均价，元或点。 */
  average: number;
  /** 当前分钟成交量，股，不是全天累计量。 */
  volume: number;
}

/** GET /api/market/minutes 返回最近五个交易日，由旧到新。 */
export interface MinuteDay {
  /** 序列实际交易日期 YYYY-MM-DD。 */
  date: string;
  /** 该日的前一交易日收盘价，元或点。 */
  previousClose: number;
  /** 按时间升序的 241 个分钟点。 */
  points: MinutePoint[];
}

/** GET /api/market/search 搜索建议。 */
export interface SearchStock {
  /** 带交易所前缀的站内路由代码。 */
  symbol: string;
  /** 证券名称。 */
  name: string;
  /** 不带前缀的六位代码。 */
  code: string;
}

/** 新浪按单笔金额划分的成交方向统计。 */
export interface FundCategory {
  /** 特大单、大单、小单、散单之一。 */
  name: string;
  /** 买入方向成交金额，元。 */
  inflow: number;
  /** 卖出方向成交金额，元。 */
  outflow: number;
  /** 净流入，元，inflow - outflow。 */
  net: number;
}

/** GET /api/market/funds；数据不代表真实账户转账。 */
export interface Funds {
  /** 研究股票代码。 */
  symbol: string;
  /** 统计交易日 YYYY-MM-DD。 */
  date: string;
  /** 上游统计时刻 HH:mm:ss。 */
  time: string;
  /** 四类资金数据，从特大单到散单。 */
  categories: FundCategory[];
  /** 四类净流入之和，元。 */
  net: number;
}

/** 单个指标在多个财务报告期的取值。 */
export interface FinancialRow {
  /** 字段代码与名称组合的行键，避免重复名称冲突。 */
  field: string;
  /** 上游指标名称。 */
  title: string;
  /** 分组标题不展示数值。 */
  heading: boolean;
  /** 与 dates 对齐的原始值，缺失为 null。 */
  values: Numeric[];
  /** 最新一期同比的小数比例：0.1 表示 10%，显示时乘以 100。 */
  yoy: Numeric;
  /** 源单位：元、元/股、%、倍、次、天；界面将金额转换为万元。 */
  unit: string;
}

/** GET /api/market/financials 的最近八期合并报表。 */
export interface Financials {
  /** 股票代码。 */
  symbol: string;
  /** gjzb 关键指标、lrb 利润表、fzb 资产负债表、llb 现金流量表。 */
  source: string;
  /** YYYYMMDD，由新到旧；利润和现金流为报告期累计值。 */
  dates: string[];
  /** 指标和分组行。 */
  rows: FinancialRow[];
  /** 币种，通常为 CNY。 */
  currency: string;
  /** 最新报告公告日期 YYYYMMDD；缺失时为空字符串。 */
  publishedAt: string;
}

/** 行情成功响应的数据来源与缓存状态。 */
export interface ApiMeta {
  /** 数据源名称，当前为新浪财经。 */
  source: string;
  /** 本服务成功获取时间，ISO UTC；不是行情交易时间。 */
  fetchedAt: string;
  /** true 表示上游失败后返回容许期限内的旧缓存。 */
  stale: boolean;
  /** 缓存降级提示；正常请求不提供。 */
  warning?: string;
}

/** 行情 API 成功响应；失败为 { error: string } 与非 2xx HTTP 状态。 */
export interface ApiResult<T> {
  /** 规范化为项目类型、单位的数据。 */
  data: T;
  /** 数据来源和缓存信息。 */
  meta: ApiMeta;
}

/** 可公开的账号字段；禁止添加密码哈希或会话凭证。 */
export interface User {
  /** 服务端生成的 UUID。 */
  id: string;
  /** 规范化为小写的登录邮箱。 */
  email: string;
  /** 昵称，1 至 24 个字符。 */
  name: string;
}

/** GET /api/market/list 的分页数据，外层使用 ApiResult。 */
export interface MarketList {
  /** 当前页的股票，默认每页 20 条。 */
  stocks: MarketStock[];
  /** 当前市场匹配的证券总数。 */
  total: number;
}

/** GET /api/auth/me 和登录、注册成功后的公开响应。 */
export interface AuthResult {
  /** 已验证的用户；me 在未登录时为 null。 */
  user: User | null;
}

/** GET /api/watchlist，仅包含当前登录账号的数据。 */
export interface WatchlistResult {
  /** 带交易所前缀的证券代码，按添加时间排列，最多 60 个。 */
  symbols: string[];
}

/** 退出账号、添加或删除自选的成功响应。 */
export interface MutationResult {
  /** true 表示操作已完成；失败采用非 2xx 状态和 ApiError。 */
  ok: true;
}

/** 所有 API 的错误响应，由 HTTP 状态区分参数、认证及上游错误。 */
export interface ApiError {
  /** 可向用户展示的错误提示。 */
  error: string;
}

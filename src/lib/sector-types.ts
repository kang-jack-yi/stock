import type { MarketStock, Numeric } from "./types";

/** 新浪公开板块分类；行业采用新浪行业，概念采用 class 接口。 */
export type SectorKind = "industry" | "concept";

/** 板块汇总榜；部分概念只统计最多一百只样本，不能视为完整成分统计或可交易指数。 */
export interface SectorSummary {
  /** 新浪板块节点，如 new_blhy 或 gn_hwqc；用于成分股查询。 */
  id: string;
  /** 数据源提供的板块名称。 */
  name: string;
  /** 新浪行业或概念分类。 */
  kind: SectorKind;
  /** 汇总榜声明的统计证券数量；部分概念最多一百只，并非实际全成分总数。 */
  reportedStockCount: Numeric;
  /** 上游样本的平均股价，元；不是板块指数点位，也不保证覆盖完整成分。 */
  averagePrice: Numeric;
  /** 板块平均股价的涨跌额，元；缺失为 null。 */
  change: Numeric;
  /** 汇总榜涨跌幅，百分比数值：1.5 表示 1.5%，缺失为 null。 */
  changePercent: Numeric;
  /** 上游统计样本累计成交数量，股；部分概念限一百只，不代表完整成分总量。 */
  volume: Numeric;
  /** 上游统计样本累计成交金额，元；部分概念限一百只，跨概念存在证券重叠。 */
  amount: Numeric;
  /** 汇总榜样本领涨股的交易所代码，可能不是全部成分领涨股；无效为 null。 */
  leaderSymbol: string | null;
  /** 领涨股票名称；缺失为 null。 */
  leaderName: string | null;
  /** 领涨股票最新价格，元；缺失为 null。 */
  leaderPrice: Numeric;
  /** 领涨股票涨跌幅，百分比数值；缺失为 null。 */
  leaderChangePercent: Numeric;
  /** 领涨股票涨跌额，元；缺失为 null。 */
  leaderChange: Numeric;
}

/** GET /api/sectors?type=industry|concept 的完整公开板块列表。 */
export interface SectorList {
  /** 当前返回的板块分类。 */
  kind: SectorKind;
  /** 当前分类全部板块，不使用热门样本代替完整列表。 */
  sectors: SectorSummary[];
  /** 本次完整列表的板块数量。 */
  total: number;
}

/** GET /api/sectors?type=...&node=... 的成分股分页行情。 */
export interface SectorConstituents {
  /** 当前板块的汇总数据；数量字段保留独立上游口径。 */
  sector: SectorSummary;
  /** 当前页的成分股行情，金额、成交量分别统一为元、股。 */
  stocks: MarketStock[];
  /** 逐页抓取至尾页并按证券代码去重后的实际成分总数，用于完整分页。 */
  total: number;
  /** 上游数量接口的独立统计，可能与实际完整成分快照有差异。 */
  sourceStockCount: number;
  /** 全部实际成分的成交量之和，股；不使用有样本上限的汇总榜成交量。 */
  volume: number;
  /** 全部实际成分的成交额之和，元；不同板块相加会重复计算重叠证券。 */
  amount: number;
  /** 从完整成分快照取涨跌幅最高的证券；无有效涨跌幅时为 null。 */
  leader: MarketStock | null;
  /** 当前页码，从 1 开始。 */
  page: number;
  /** 每页最多 20 只成分股。 */
  pageSize: number;
}

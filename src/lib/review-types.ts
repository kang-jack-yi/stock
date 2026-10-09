import type { AlertEvent } from "./alert-types";
import type { MarketBreadth } from "./screener";
import type { SectorSummary } from "./sector-types";
import type { MarketStock } from "./types";

/** 被真实日期验证排除的证券，不用旧行情补齐当日收盘。 */
export interface ReviewExcluded {
  /** 带交易所前缀的代码。 */
  symbol: string;
  /** 当日排行名称。 */
  name: string;
  /** 缺失、旧日期、未收盘或不一致的说明。 */
  reason: string;
}

/** 一个交易日公共快照，由所有账号共享，不重复抓取市场。 */
export interface ReviewMarket {
  /** 逐只有效证券及指数核实的实际交易日期。 */
  date: string;
  /** 完成全部数据获取的 ISO 时间，不能替代行情日期。 */
  fetchedAt: string;
  /** 全市场排行开始获取时间。 */
  startedAt: string;
  /** 源排行成功获取时间。 */
  marketFetchedAt: string;
  /** 源目录覆盖总数，含无法核实收盘的证券。 */
  sourceTotal: number;
  /** 同日收盘价格及涨幅通过逐股核对的排行证券。 */
  stocks: MarketStock[];
  /** 排除的证券及原因。 */
  excluded: ReviewExcluded[];
  /** 仅基于通过验证证券的市场宽度，分母不同于全目录。 */
  breadth: MarketBreadth;
  /** 收盘后采集的行业与概念源汇总样本，不是交易所全量指数。 */
  sectors: SectorSummary[];
  /** 两种板块汇总的成功获取时间。 */
  sectorFetchedAt: string[];
}

/** 保存筛选集合中的证券，不保留分页限制。 */
export interface ReviewSecurity {
  /** 股票代码。 */
  symbol: string;
  /** 采集时的名称。 */
  name: string;
}

/** 当日方案冻结结果，条件变化之后不会混用旧基线。 */
export interface ReviewScreener {
  /** 保存方案编号。 */
  id: string;
  /** 当时的方案名称。 */
  name: string;
  /** 不包含排序及页码的标准化条件哈希。 */
  conditionHash: string;
  /** 当日经过日期验证的完整匹配集合。 */
  matches: ReviewSecurity[];
}

/** 已保存个人日终研究快照；后续自选修改不重写历史。 */
export interface ReviewAccount {
  /** 快照日期。 */
  date: string;
  /** 冻结账号关注列表的毫秒时间戳。 */
  savedAt: number;
  /** 当时关注且当日收盘可验证的证券。 */
  watchlist: MarketStock[];
  /** 关注但无有效收盘行情的证券，不混入正常涨跌。 */
  unavailable: ReviewExcluded[];
  /** 当时保存的全部选股方案及完整匹配集合。 */
  screeners: ReviewScreener[];
  /** 实际行情时间属于当天的个人提醒记录。 */
  alerts: AlertEvent[];
}

/** 一个方案相对相邻已有个人快照的变化。 */
export interface ReviewScreenerChange extends ReviewScreener {
  /** 是否存在同一方案同一条件的比较基线。 */
  hasBaseline: boolean;
  /** 首次出现、条件变化或正常比较的说明。 */
  baselineLabel: string;
  /** 当前存在而基线没有的完整证券集合。 */
  added: ReviewSecurity[];
  /** 基线存在而当前没有的完整证券集合。 */
  removed: ReviewSecurity[];
  /** 任一快照行情不可验证的候选变化；不能直接称作新增或退出。 */
  unverifiable: ReviewSecurity[];
}

/** 板块源汇总的日间变化，差值单位为百分点。 */
export interface ReviewSectorChange extends SectorSummary {
  /** 相邻可用快照的汇总涨跌幅；无基线为 null。 */
  previousChangePercent: number | null;
  /** 当前涨幅减基线涨幅，缺失任一侧时为 null。 */
  difference: number | null;
}

/** GET /api/reviews，仅返回当前会话账号的复盘。 */
export interface ReviewsResult {
  /** 当前中国标准时间交易日期。 */
  today: string;
  /** 是否允许采集当天收盘。 */
  canCapture: boolean;
  /** 交易状态或等待收盘原因。 */
  captureLabel: string;
  /** 当前账号已有快照日期，由新到旧，最多 120 日。 */
  dates: string[];
  /** 选中日期；没有快照时为 null。 */
  selectedDate: string | null;
  /** 相邻可用基线日期；不能把缺失日期当作连续日。 */
  previousDate: string | null;
  /** 个人日终记录；无历史时为 null。 */
  review: ReviewAccount | null;
  /** 公共市场摘要，不向前端返回整套行情原始记录。 */
  market:
    | (Omit<ReviewMarket, "stocks" | "excluded" | "sectors"> & {
        /** 同日有效证券数。 */
        verifiedTotal: number;
        /** 缺失或停牌等原因排除数。 */
        excludedTotal: number;
      })
    | null;
  /** 完整方案结果变化；界面分页不会改变集合。 */
  screeners: ReviewScreenerChange[];
  /** 完整板块汇总变化，界面单独分页。 */
  sectors: ReviewSectorChange[];
  /** 后台采集心跳，毫秒。 */
  workerAt: number | null;
  /** 后台进程是否在 90 秒内更新状态。 */
  workerRunning: boolean;
  /** 最近后台采集状态，无个人账号信息。 */
  workerMessage: string;
}

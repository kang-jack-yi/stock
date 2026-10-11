/** 固定事实条件，不表达买卖建议。 */
export const signalLabels = {
  ma20Above: "收盘价上穿 MA20",
  macdBullish: "MACD DIF 上穿 DEA",
  volumeSpike: "成交量上穿前五日均量的 2 倍",
  rsiOversold: "RSI14 下穿 30",
} as const;
/** 固定信号名称，阈值及计算口径由服务端决定。 */
export type SignalKind = keyof typeof signalLabels;
/** 每个账号只订阅自己的自选或当前持仓。 */
export interface SignalRule {
  /** 规则 UUID。 */
  id: string;
  /** A 股证券代码。 */
  symbol: string;
  /** 固定条件枚举。 */
  kind: SignalKind;
  /** 是否参与收盘检查。 */
  enabled: boolean;
  /** 最近完整检查的实际收盘日期，未检查为 null。 */
  checkedDate: string | null;
  /** 规则创建毫秒时间。 */
  createdAt: number;
}
/** 已触发事实记录，规则删除后仍可保留。 */
export interface SignalEvent {
  /** 记录 UUID。 */
  id: string;
  /** 对应规则；删除后为 null。 */
  ruleId: string | null;
  /** 股票代码。 */
  symbol: string;
  /** 触发时真实行情名称。 */
  name: string;
  /** 条件枚举。 */
  kind: SignalKind;
  /** 收盘价元、DIF 元、量倍数或 RSI 点数，由 kind 决定。 */
  value: number;
  /** 源日线收盘日期 YYYY-MM-DD，不是采集日期。 */
  date: string;
  /** 采集记录毫秒时间，不冒充实际发生时分。 */
  createdAt: number;
  /** 当前用户是否已读。 */
  read: boolean;
}
/** GET /api/signals 的账号隔离响应。 */
export interface SignalsResult {
  /** 最多 80 条个人规则。 */
  rules: SignalRule[];
  /** 最近 100 条个人记录。 */
  events: SignalEvent[];
  /** 独立进程心跳毫秒时间，未启动为 null。 */
  workerAt: number | null;
  /** 心跳是否在 90 秒内。 */
  workerRunning: boolean;
  /** 后台最近检查状态。 */
  workerMessage: string;
}
/** 手动及后台检查结果。 */
export interface SignalCheckResult {
  /** 完整检查且去重写入的规则数。 */
  checked: number;
  /** 新增事实记录数。 */
  triggered: number;
  /** 上游异常、当前不关注、旧日期或暖机不足而跳过的规则数。 */
  skipped: number;
  /** 当前收盘窗口状态和结果。 */
  message: string;
}

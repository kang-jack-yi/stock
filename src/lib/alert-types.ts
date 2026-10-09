/** 提醒条件使用原始价格（元/点）或涨跌幅百分比数值。 */
export interface AlertRule {
  /** 服务端规则 UUID。 */
  id: string;
  /** 带交易所前缀的证券代码。 */
  symbol: string;
  /** 规则指标。 */
  metric: "price" | "changePercent";
  /** above 为上穿，below 为下穿。 */
  direction: "above" | "below";
  /** 阈值，元/点或百分比数值。 */
  threshold: number;
  /** 是否检查；触发后自动暂停，重新启用会重建基准。 */
  enabled: boolean;
  /** 最近有效观测，首次观测仅建立基准。 */
  previousValue: number | null;
  /** 最近观测的行情实际 ISO 时间。 */
  previousAt: string | null;
  /** 规则创建的毫秒时间戳。 */
  createdAt: number;
}
/** 已触发的站内提醒，即使规则删除也保留记录。 */
export interface AlertEvent {
  /** 记录 UUID。 */
  id: string;
  /** 对应规则 UUID；规则删除后为 null。 */
  ruleId: string | null;
  /** 证券代码。 */
  symbol: string;
  /** 触发时行情中的证券名。 */
  name: string;
  /** 指标与规则一致。 */
  metric: AlertRule["metric"];
  /** 穿越方向。 */
  direction: AlertRule["direction"];
  /** 触发规则阈值。 */
  threshold: number;
  /** 实际观测值。 */
  value: number;
  /** 行情实际 ISO 时间。 */
  quoteAt: string;
  /** 记录是否已读。 */
  read: boolean;
}
/** GET /api/alerts：仅包含会话用户的规则、最近记录和检查进程状态。 */
export interface AlertsResult {
  /** 最多 50 条个人规则。 */
  rules: AlertRule[];
  /** 最近 100 条个人提醒。 */
  events: AlertEvent[];
  /** 后台进程心跳的毫秒时间戳，没有运行时为 null。 */
  workerAt: number | null;
  /** 服务端读取时，后台心跳是否在 90 秒以内。 */
  workerRunning: boolean;
  /** 最近后台检查结果提示。 */
  workerMessage: string;
}

/** POST /api/alerts 的个人手动检查结果。 */
export interface AlertCheckResult {
  /** 本次检查的有效规则数，不包括陈旧或缺失行情。 */
  checked: number;
  /** 本次新增的提醒记录数。 */
  triggered: number;
  /** 休市状态或检查摘要。 */
  message: string;
}

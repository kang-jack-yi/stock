/** 情报种类，仅聚合公开元数据和本账号真实触发记录。 */
export const intelligenceKinds = {
  all: "全部类型",
  announcement: "公告",
  news: "相关资讯",
  alert: "价格提醒",
  signal: "技术信号",
} as const;

/** 服务端采集后的稳定情报元数据，不保存原文全文。 */
export interface IntelligenceEntry {
  /** 类型、证券及上游编号生成的 SHA-256；不同账号状态独立。 */
  id: string;
  /** 情报种类。 */
  kind: Exclude<keyof typeof intelligenceKinds, "all">;
  /** 带交易所前缀的证券代码。 */
  symbol: string;
  /** 来源证券简称，缺失时为代码。 */
  name: string;
  /** 纯文本公开标题或真实触发条件描述。 */
  title: string;
  /** 原始披露/行情 ISO 时间，技术信号为实际收盘日期 YYYY-MM-DD。 */
  occurredAt: string;
  /** true 只展示披露或收盘日期，不能视为执行/触发时刻。 */
  dateOnly: boolean;
  /** 安全外部原文地址；站内提醒与信号为 null。 */
  url: string | null;
  /** 关联依据，例如证券代码、标题名称匹配或账号规则。 */
  association: string;
}

/** 当前账号保留的元数据和阅读/收藏状态。 */
export interface IntelligenceItem extends IntelligenceEntry {
  /** 当前账号是否已读。 */
  read: boolean;
  /** 当前账号是否收藏；来源移除后仍可查看已保留的标题。 */
  saved: boolean;
}

/** 单证券情报查询，分页只影响已采集结果的展示。 */
export interface IntelligenceQuery {
  /** 自选或当前持仓股票；空字符串选择第一只，收藏页可查看历史证券。 */
  symbol: string;
  /** 情报类型，all 不过滤。 */
  kind: keyof typeof intelligenceKinds;
  /** all 全部、unread 未读、saved 已收藏。 */
  state: "all" | "unread" | "saved";
  /** 从 1 开始，每页 20 条。 */
  page: number;
}

/** 单个来源本次加载结果，失败不阻塞其他来源。 */
export interface IntelligenceCoverage {
  /** 中文来源或模块名称。 */
  label: string;
  /** 本次成功验证的条数，缺失为零且须结合状态解释。 */
  count: number;
  /** ok 成功、warning 缓存降级或局部失败、error 来源不可用。 */
  status: "ok" | "warning" | "error";
  /** 覆盖窗口、页数或失败原因。 */
  message: string;
}

/** GET /api/intelligence 响应；全部内容和状态按会话隔离。 */
export interface IntelligenceResult {
  /** 规范化后的条件。 */
  query: IntelligenceQuery;
  /** 已加载股票的真实行情简称；缺失或无选择为null，不能用代码伪装名称。 */
  selectedName: string | null;
  /** 自选和现持仓的证券并集；代码排序，不包含清仓股票或指数。 */
  symbols: string[];
  /** 已收藏标题涉及的历史证券，可包括移出自选或已清仓股票。 */
  savedSymbols: string[];
  /** 本页情报。 */
  items: IntelligenceItem[];
  /** 当前范围和状态过滤后的真实条数。 */
  total: number;
  /** 固定为 20。 */
  pageSize: number;
  /** 按来源展示有限覆盖和故障。 */
  coverage: IntelligenceCoverage[];
  /** 本次窗口开始日，中国标准时间；收藏不限定窗口。 */
  start: string;
  /** 服务读取的 ISO 时间，不等同于情报发生时间。 */
  fetchedAt: string;
}

/** 当前账号的自选分组。 */
export interface ResearchGroup {
  /** 分组唯一编号；不作为账号身份依据。 */
  id: string;
  /** 用户定义的分组名称。 */
  name: string;
}

/** 一只股票的私人研究记录，可独立于自选成员保存。 */
export interface ResearchEntry {
  /** 带市场前缀的证券代码。 */
  symbol: string;
  /** 所属分组编号，null 表示未分组。 */
  groupId: string | null;
  /** 关注理由和待验证问题，最多 1500 字。 */
  note: string;
  /** 最多八个标签，各不超过 16 字。 */
  tags: string[];
  /** 计划复查日期，YYYY-MM-DD；空字符串表示不安排。 */
  reviewDate: string;
  /** 用户自定义排序，较小的数排在前面。 */
  position: number;
}

/** 研究工作台查询响应，仅包含当前会话账号的数据。 */
export interface ResearchWorkspace {
  /** 该账号创建的分组。 */
  groups: ResearchGroup[];
  /** 该账号保存的股票记录。 */
  entries: ResearchEntry[];
}

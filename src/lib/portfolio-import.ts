import { validatePortfolioInput } from "./portfolio-calculation";
import type { PortfolioInput, PortfolioTransaction, TransactionKind } from "./portfolio-types";

/** CSV 列对应账本字段；编号可选，用于跨批次识别同一记录。 */
export type PortfolioImportField = keyof PortfolioInput | "reference";
/** 列索引从零开始；null 表示该字段不导入，数值字段默认为零。 */
export type PortfolioColumnMap = Record<PortfolioImportField, number | null>;
/** 已解析 CSV 表格，不执行任何公式或脚本。 */
export interface PortfolioCsv {
  /** 文件首行列名。 */
  headers: string[];
  /** 其余非空记录，顺序决定同日回放顺序。 */
  rows: string[][];
}
/** 单行预览，错误行不能参与提交。 */
export interface PortfolioImportRow {
  /** 数据行编号，从 1 开始，不含表头；同日保持此顺序。 */
  ordinal: number;
  /** 可选外部记录编号或导出原编号，不包含账号身份。 */
  reference: string;
  /** 已验证的账本输入，错误时为 null。 */
  record: PortfolioInput | null;
  /** 中文字段或业务错误；合法时为空。 */
  error: string;
}
/** 服务端完整账本回放预览，预览不写数据库。 */
export interface PortfolioImportPreview {
  /** 逐行验证与防重复状态。 */
  rows: (PortfolioImportRow & {
    /** 新增、已导入或错误。 */
    status: "new" | "duplicate" | "error";
  })[];
  /** 可新增记录数。 */
  added: number;
  /** 已导入记录数，不再次入账。 */
  skipped: number;
  /** 整体回放错误，存在时不能提交。 */
  error: string;
  /** 当前账本版本，确认时检测预览后编辑。 */
  version: string;
}

export const portfolioImportFields: {
  /** 列映射对应的账本字段或外部记录编号。 */
  key: PortfolioImportField;
  /** 界面展示的中文字段名称，金额标签注明元。 */
  label: string;
}[] = [
  { key: "date", label: "发生日期" },
  { key: "kind", label: "记录类型" },
  { key: "symbol", label: "股票代码" },
  { key: "quantity", label: "股数" },
  { key: "price", label: "单价（元）" },
  { key: "amount", label: "现金金额（元）" },
  { key: "fee", label: "费用（元）" },
  { key: "note", label: "备注" },
  { key: "reference", label: "唯一记录编号（可选）" },
];
export const portfolioKindLabels: Record<TransactionKind, string> = {
  deposit: "入金",
  withdraw: "出金",
  buy: "买入",
  sell: "卖出",
  dividend: "现金分红",
  bonus: "送转股",
};

/** 解析 UTF-8 CSV，包括引号内换行、逗号及双引号；限制 1 MB、1000 行、20 列。 */
export function parsePortfolioCsv(text: string): PortfolioCsv {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error("CSV 文件不能超过 1 MB");
  const table: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const source = text.replace(/^\uFEFF/, "");
  /** 提交字段并限制单元格长度，避免不必要的大文本解析。 */
  function pushCell() {
    if (cell.length > 1000) throw new Error("CSV 单元格不能超过 1000 字");
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 20) throw new Error("CSV 最多 20 列");
  }
  /** 保留有效记录顺序，忽略完全空白行。 */
  function pushRow() {
    pushCell();
    if (row.some((value) => value.trim())) table.push(row);
    row = [];
    if (table.length > 1001) throw new Error("每次最多导入 1000 条记录");
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ",") pushCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      pushRow();
    } else if (closed || char === '"') throw new Error("CSV 引号格式不正确");
    else cell += char;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (cell || row.length || closed) pushRow();
  if (!table.length) throw new Error("CSV 文件为空");
  const [headers, ...rows] = table;
  if (rows.some((record) => record.length !== headers.length))
    throw new Error("CSV 每行列数须与表头一致");
  return { headers, rows };
}

/** 根据本项目模板或英文键推断列映射，重复表头需用户手工选择。 */
export function defaultPortfolioColumns(headers: string[]): PortfolioColumnMap {
  const aliases: Record<PortfolioImportField, string[]> = {
    date: ["发生日期", "日期", "date"],
    kind: ["记录类型", "类型", "kind"],
    symbol: ["股票代码", "symbol"],
    quantity: ["股数", "quantity"],
    price: ["单价（元）", "price"],
    amount: ["现金金额（元）", "amount"],
    fee: ["费用（元）", "fee"],
    note: ["备注", "备注（安全文本）", "note"],
    reference: ["记录编号", "reference", "id"],
  };
  return Object.fromEntries(
    portfolioImportFields.map(({ key }) => {
      const index = headers.findIndex((header) => aliases[key].includes(header.trim()));
      return [key, index < 0 ? null : index];
    }),
  ) as PortfolioColumnMap;
}

/** 严格解析数值、类型与日期，逐行返回中文错误，不隐式吞掉非法字段。 */
export function portfolioImportRows(
  csv: PortfolioCsv,
  columns: PortfolioColumnMap,
): PortfolioImportRow[] {
  if (columns.date == null || columns.kind == null) throw new Error("必须映射发生日期和记录类型");
  const indices = Object.values(columns).filter((value) => value != null);
  if (
    new Set(indices).size !== indices.length ||
    indices.some((index) => !Number.isInteger(index) || index < 0 || index >= csv.headers.length)
  )
    throw new Error("列映射不能重复或超出文件列数");
  return csv.rows.map((row, index) => {
    /** 缺失可选列使用空值，数值由下方统一解析。 */
    const value = (key: PortfolioImportField) => (columns[key] == null ? "" : row[columns[key]!]);
    const reference = value("reference").trim();
    try {
      if (reference.length > 100 || /[\x00-\x1f]/.test(reference))
        throw new Error("唯一记录编号最多 100 字且不能含控制字符");
      /** 数值不接受货币符号、千分位、科学计数或公式，避免含义不明确。 */
      const numeric = (key: "quantity" | "price" | "amount" | "fee") => {
        const text = value(key).trim();
        if (text && !/^\d+(\.\d+)?$/.test(text))
          throw new Error(
            `${portfolioImportFields.find((field) => field.key === key)!.label}须为非负数字`,
          );
        return text ? Number(text) : 0;
      };
      const rawKind = value("kind").trim();
      const kind = Object.entries(portfolioKindLabels).find(
        ([key, label]) => key === rawKind || label === rawKind,
      )?.[0] as TransactionKind | undefined;
      if (!kind) throw new Error("记录类型须为入金、出金、买入、卖出、现金分红或送转股");
      const safeNote =
        columns.note != null && csv.headers[columns.note].trim() === "备注（安全文本）";
      const note =
        safeNote && value("note").startsWith("'") ? value("note").slice(1) : value("note");
      const record: PortfolioInput = {
        date: value("date").trim(),
        kind,
        symbol: value("symbol").trim().toLowerCase(),
        quantity: numeric("quantity"),
        price: numeric("price"),
        amount: numeric("amount"),
        fee: numeric("fee"),
        note,
      };
      validatePortfolioInput(record);
      return { ordinal: index + 1, reference, record, error: "" };
    } catch (error) {
      return {
        ordinal: index + 1,
        reference,
        record: null,
        error: error instanceof Error ? error.message : "记录格式不正确",
      };
    }
  });
}

/** 导出可往返的 UTF-8 CSV；备注统一前置单引号，阻止表格软件执行公式。 */
export function exportPortfolioCsv(records: PortfolioTransaction[]) {
  const rows = [
    [
      "发生日期",
      "记录类型",
      "股票代码",
      "股数",
      "单价（元）",
      "现金金额（元）",
      "费用（元）",
      "备注（安全文本）",
      "记录编号",
    ],
    ...records.map((record) => [
      record.date,
      portfolioKindLabels[record.kind],
      record.symbol,
      record.quantity,
      record.price.toFixed(2),
      record.amount.toFixed(2),
      record.fee.toFixed(2),
      `'${record.note}`,
      record.id,
    ]),
  ];
  return (
    "\uFEFF" +
    rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n")
  );
}

/** 空模板只有表头，不将演示交易混入用户账本。 */
export function portfolioCsvTemplate() {
  return exportPortfolioCsv([]);
}

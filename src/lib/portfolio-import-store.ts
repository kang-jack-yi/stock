import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";
import { replayPortfolio } from "./portfolio-calculation";
import { portfolioTransactions } from "./portfolio-store";
import { parsePortfolioCsv, portfolioImportRows } from "./portfolio-import";
import type { PortfolioColumnMap, PortfolioImportPreview } from "./portfolio-import";
import type { PortfolioInput } from "./portfolio-types";

/** 固定字段顺序摘要，忽略数据库编号与创建时间，仅比较真实账本内容。 */
function signature(record: PortfolioInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        record.date,
        record.kind,
        record.symbol,
        record.quantity,
        record.price,
        record.amount,
        record.fee,
        record.note,
      ]),
    )
    .digest("hex");
}
/** 版本包含所有记录身份、顺序与内容，阻止确认前其他标签修改账本。 */
function version(userId: string) {
  return createHash("sha256")
    .update(JSON.stringify(portfolioTransactions(userId)))
    .digest("hex");
}
/** 在当前账号中检查来源身份并回放候选全集，不合并同批相同交易。 */
function prepareImport(userId: string, text: string, columns: PortfolioColumnMap) {
  const parsed = portfolioImportRows(parsePortfolioCsv(text), columns);
  if (!parsed.length) throw new HttpError("CSV 没有可导入的数据行");
  const batch = createHash("sha256")
    .update(JSON.stringify(parsed.map((row) => [row.reference, row.record])))
    .digest("hex");
  const records = portfolioTransactions(userId);
  const used = new Set<string>();
  const rows = parsed.map((row) => {
    const key = row.reference ? `id:${row.reference}` : `batch:${batch}:${row.ordinal}`;
    let error = row.error;
    let status: "new" | "duplicate" | "error" = error ? "error" : "new";
    if (used.has(key)) error = "文件内唯一记录编号重复，请为独立交易填写不同编号";
    used.add(key);
    if (!error && row.record) {
      const marker = db()
        .prepare(
          "SELECT record_hash,transaction_id FROM portfolio_import_rows WHERE user_id=? AND source_key=?",
        )
        .get(userId, key) as
        | {
            /** 原导入账本内容的 SHA-256 摘要，用于检测同来源内容变化。 */
            record_hash: string;
            /** 本账号对应的账本记录编号，删除账本后仍保留防重身份。 */
            transaction_id: string;
          }
        | undefined;
      const existing = marker
        ? records.find((record) => record.id === marker.transaction_id)
        : row.reference
          ? records.find((record) => record.id === row.reference)
          : undefined;
      if (marker || existing) {
        if (marker && marker.record_hash !== signature(row.record))
          error = "同一来源编号内容已变化，请核对原记录，不自动覆盖";
        else if (!existing) error = "此来源已导入但账本记录已删除，不能重复恢复；请手工确认新记录";
        else if (signature(existing) !== signature(row.record))
          error = "此来源对应账本已被编辑，请核对，不自动覆盖";
        else status = "duplicate";
      }
    }
    return { ...row, error, status: error ? ("error" as const) : status, key };
  });
  const added = rows.filter((row) => row.status === "new").length;
  let error = rows.some((row) => row.error) ? "存在错误行，请修正文件后重新预览" : "";
  if (!error && records.length + added > 1000) error = "导入后超过每个账号 1000 条记录上限";
  if (!error)
    try {
      const nextSequence = Math.max(0, ...records.map((record) => record.sequence));
      replayPortfolio([
        ...records,
        ...rows
          .filter((row) => row.status === "new")
          .map((row, index) => ({
            ...row.record!,
            id: row.key,
            sequence: nextSequence + index + 1,
            createdAt: Date.now(),
          })),
      ]);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "账本完整回放失败";
    }
  const preview: PortfolioImportPreview = {
    rows: rows.map((row) => ({
      ordinal: row.ordinal,
      reference: row.reference,
      record: row.record,
      error: row.error,
      status: row.status,
    })),
    added,
    skipped: rows.filter((row) => row.status === "duplicate").length,
    error,
    version: version(userId),
  };
  return { rows, preview };
}

/** 服务端预览不写入；确认必须重新验证同一文件、映射和当前账号账本。 */
export function previewPortfolioImport(userId: string, text: string, columns: PortfolioColumnMap) {
  return prepareImport(userId, text, columns).preview;
}
/** 短 SQLite 写事务内重新校验并整批插入；任一失败回滚账本与防重标记。 */
export function commitPortfolioImport(
  userId: string,
  text: string,
  columns: PortfolioColumnMap,
  expectedVersion: string,
) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (version(userId) !== expectedVersion)
      throw new HttpError("预览后账本已变化，请重新预览", 409);
    const { rows, preview } = prepareImport(userId, text, columns);
    if (preview.error) throw new HttpError(preview.error);
    for (const row of rows.filter((row) => row.status === "new")) {
      const record = row.record!,
        id = randomUUID(),
        now = Date.now();
      connection
        .prepare(
          "INSERT INTO portfolio_transactions(id,user_id,date,kind,symbol,quantity,price,amount,fee,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          userId,
          record.date,
          record.kind,
          record.symbol,
          record.quantity,
          record.price,
          record.amount,
          record.fee,
          record.note,
          now,
        );
      connection
        .prepare(
          "INSERT INTO portfolio_import_rows(user_id,source_key,record_hash,transaction_id,created_at) VALUES(?,?,?,?,?)",
        )
        .run(userId, row.key, signature(record), id, now);
    }
    replayPortfolio(portfolioTransactions(userId));
    connection.exec("COMMIT");
    return { added: preview.added, skipped: preview.skipped };
  } catch (error) {
    connection.exec("ROLLBACK");
    if (error instanceof HttpError) throw error;
    throw new HttpError(error instanceof Error ? error.message : "批量导入失败");
  }
}

/** 流式限制请求体 2 MB；CSV 上限 1 MB，留出 JSON 编码与映射开销。 */
export async function portfolioImportBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("请求内容为空");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError("导入请求不能超过 2 MB", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new HttpError("导入请求须为有效 UTF-8 JSON");
  }
}

import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";
import { replayPortfolio, validatePortfolioInput, valuePortfolio } from "./portfolio-calculation";
import { quotes } from "./sina/client";
import type { PortfolioInput, PortfolioTransaction } from "./portfolio-types";

/** 当前账号按日期、序号读取手工账本；字段别名保持 API 类型一致。 */
export function portfolioTransactions(userId: string): PortfolioTransaction[] {
  return db()
    .prepare(
      "SELECT id,sequence,date,kind,symbol,quantity,price,amount,fee,note,created_at AS createdAt FROM portfolio_transactions WHERE user_id = ? ORDER BY date,sequence",
    )
    .all(userId) as unknown as PortfolioTransaction[];
}

/** 请求已有免费行情，为所有持仓估值；上游失败仍返回可操作的手工账本。 */
export async function getPortfolio(userId: string) {
  const records = portfolioTransactions(userId);
  const positions = replayPortfolio(records).positions.filter((position) => position.quantity > 0);
  if (!positions.length) return valuePortfolio(records, []);
  try {
    const result = await quotes(positions.map((position) => position.symbol));
    return valuePortfolio(
      records,
      result.data,
      result.meta.stale ? "行情服务降级，估值使用缓存报价，请核对各股行情日期" : "",
    );
  } catch {
    return valuePortfolio(records, [], "行情暂不可用，完整估值不展示；账本和已实现收益仍可查看");
  }
}

/** 单个事务内创建、修改或删除后完整回放；历史操作造成非法账本时全部回滚。 */
export function writePortfolio(
  userId: string,
  action: "create" | "update" | "delete",
  input?: PortfolioInput,
  id?: string,
) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const records = portfolioTransactions(userId);
    if (action !== "create" && !records.some((record) => record.id === id))
      throw new HttpError("账本记录不存在", 404);
    if (input) validatePortfolioInput(input);
    if (action === "create") {
      if (records.length >= 1000) throw new HttpError("每个账号最多保存 1000 条账本记录");
      connection
        .prepare(
          "INSERT INTO portfolio_transactions(id,user_id,date,kind,symbol,quantity,price,amount,fee,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          userId,
          input!.date,
          input!.kind,
          input!.symbol,
          input!.quantity,
          input!.price,
          input!.amount,
          input!.fee,
          input!.note,
          Date.now(),
        );
    } else if (action === "update") {
      connection
        .prepare(
          "UPDATE portfolio_transactions SET date=?,kind=?,symbol=?,quantity=?,price=?,amount=?,fee=?,note=? WHERE id=? AND user_id=?",
        )
        .run(
          input!.date,
          input!.kind,
          input!.symbol,
          input!.quantity,
          input!.price,
          input!.amount,
          input!.fee,
          input!.note,
          id!,
          userId,
        );
    } else
      connection
        .prepare("DELETE FROM portfolio_transactions WHERE id=? AND user_id=?")
        .run(id!, userId);
    replayPortfolio(portfolioTransactions(userId));
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    if (error instanceof HttpError) throw error;
    throw new HttpError(error instanceof Error ? error.message : "账本操作失败");
  }
}

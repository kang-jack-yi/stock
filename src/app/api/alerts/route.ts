import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, sameOrigin, HttpError, errorResponse, rateLimit } from "@/lib/http";
import { symbolPattern } from "@/lib/sina/parse";
import { getAlerts, checkAlerts } from "@/lib/alerts";

export const runtime = "nodejs";
const ruleSchema = z
  .object({
    symbol: z.string().regex(symbolPattern),
    metric: z.enum(["price", "changePercent"]),
    direction: z.enum(["above", "below"]),
    threshold: z.number().finite().min(-100).max(1e9),
  })
  .strict()
  .refine((rule) => (rule.metric === "price" ? rule.threshold > 0 : rule.threshold <= 10000));
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enabled"), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("read"), id: z.uuid().optional() }).strict(),
]);
/** 获取当前会话账号；客户端无法选择其他用户。 */
async function user() {
  const value = await currentUser();
  if (!value) throw new HttpError("请登录后管理提醒", 401);
  return value;
}
/** GET /api/alerts：账号独立规则与触发记录，禁止共享缓存。 */
export async function GET() {
  try {
    return NextResponse.json(getAlerts((await user()).id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** POST /api/alerts：创建规则，或显式检查当前用户的规则。 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const account = await user();
    const input = await body(request);
    if (input.action === "check" && Object.keys(input).length === 1) {
      rateLimit(`alerts-check:${account.id}`, 30);
      return NextResponse.json(await checkAlerts(account.id), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success) throw new HttpError("提醒条件格式不正确，价格须大于零");
    const connection = db();
    connection.exec("BEGIN IMMEDIATE");
    try {
      const count = connection
        .prepare("SELECT COUNT(*) AS count FROM alert_rules WHERE user_id = ?")
        .get(account.id) as { count: number };
      if (count.count >= 50) throw new HttpError("每个账号最多保存 50 条提醒");
      const r = parsed.data;
      connection
        .prepare(
          "INSERT INTO alert_rules(id,user_id,symbol,metric,direction,threshold,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(randomUUID(), account.id, r.symbol, r.metric, r.direction, r.threshold, Date.now());
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** PATCH /api/alerts：暂停/重新启用并清空基准，或将记录标为已读。 */
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const account = await user();
    const parsed = patchSchema.safeParse(await body(request));
    if (!parsed.success) throw new HttpError("提醒操作格式不正确");
    const r = parsed.data;
    if (r.action === "enabled") {
      const result = db()
        .prepare(
          "UPDATE alert_rules SET enabled = ?, previous_value = NULL, previous_at = NULL WHERE id = ? AND user_id = ?",
        )
        .run(r.enabled ? 1 : 0, r.id, account.id);
      if (!result.changes) throw new HttpError("提醒不存在", 404);
    } else if (r.id) {
      const result = db()
        .prepare("UPDATE alert_events SET read_at = ? WHERE id = ? AND user_id = ?")
        .run(Date.now(), r.id, account.id);
      if (!result.changes) throw new HttpError("记录不存在", 404);
    } else
      db()
        .prepare("UPDATE alert_events SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
        .run(Date.now(), account.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** DELETE /api/alerts：只删除当前账号规则，触发历史保留。 */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const account = await user();
    const parsed = z
      .object({ id: z.uuid() })
      .strict()
      .safeParse(await body(request));
    if (!parsed.success) throw new HttpError("提醒编号格式不正确");
    const result = db()
      .prepare("DELETE FROM alert_rules WHERE id = ? AND user_id = ?")
      .run(parsed.data.id, account.id);
    if (!result.changes) throw new HttpError("提醒不存在", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

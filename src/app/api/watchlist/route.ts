import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { symbolPattern } from "@/lib/sina/parse";

export const runtime = "nodejs";
/** GET /api/watchlist：仅查询当前会话用户的收藏代码，按添加时间排列。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return errorResponse(new HttpError("请登录后管理自选股", 401));
  const rows = db()
    .prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at")
    .all(user.id) as { symbol: string }[];
  return NextResponse.json(
    { symbols: rows.map((r) => r.symbol) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
/** 写入或移除当前用户自选；用户身份完全来自会话，忽略客户端用户编号。 */
async function update(request: Request, remove: boolean) {
  try {
    sameOrigin(request);
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后管理自选股", 401);
    const input = await body(request);
    if (typeof input.symbol !== "string" || !symbolPattern.test(input.symbol))
      throw new HttpError("股票代码格式不正确");
    if (remove)
      db()
        .prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?")
        .run(user.id, input.symbol);
    else {
      const count = db()
        .prepare("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ?")
        .get(user.id) as { count: number };
      const exists = db()
        .prepare("SELECT 1 FROM watchlist WHERE user_id = ? AND symbol = ?")
        .get(user.id, input.symbol);
      if (count.count >= 60 && !exists) throw new HttpError("最多保存 60 只自选股");
      db()
        .prepare("INSERT OR IGNORE INTO watchlist (user_id, symbol, created_at) VALUES (?, ?, ?)")
        .run(user.id, input.symbol, Date.now());
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** POST /api/watchlist：幂等添加证券代码，单个账号最多保存 60 只。 */
export async function POST(request: Request) {
  return update(request, false);
}
/** DELETE /api/watchlist：按证券代码移除当前账号收藏，重复删除仍成功。 */
export async function DELETE(request: Request) {
  return update(request, true);
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { captureDailyReview, getDailyReviews } from "@/lib/daily-review";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/reviews：日期选择只读取会话用户的已持久化历史，不触发抓取。 */
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后查看每日复盘", 401);
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    )
      throw new HttpError("复盘日期格式不正确");
    return NextResponse.json(getDailyReviews(user.id, date), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** POST /api/reviews：只保存当日收盘，禁止传入历史日期、账号或行情内容。 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后保存每日复盘", 401);
    const input = await body(request);
    if (Object.keys(input).length)
      throw new HttpError("只能采集当日收盘，不接受历史日期或外部数据");
    return NextResponse.json(await captureDailyReview(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

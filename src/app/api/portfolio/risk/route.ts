import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { getPortfolioRisk, savePortfolioRisk } from "@/lib/portfolio-risk-store";

export const runtime = "nodejs";
const ratio = z.number().finite().min(0).max(100);
const schema = z
  .object({
    stockLimit: ratio.nullable(),
    cashTarget: ratio.nullable(),
    assumedDrop: ratio,
    targets: z.array(z.object({ symbol: z.string().max(8), weight: ratio }).strict()).max(60),
  })
  .strict();
/** 会话决定风险设置账号，客户端不能传入用户 ID。 */
async function account() {
  const user = await currentUser();
  if (!user) throw new HttpError("请登录后管理组合目标", 401);
  return user;
}
/** GET 私有风险偏好，禁止公共缓存。 */
export async function GET() {
  try {
    return NextResponse.json(getPortfolioRisk((await account()).id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** PUT 完整保存经过验证的用户目标，不生成买卖指令。 */
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const user = await account();
    const parsed = schema.safeParse(await body(request));
    if (!parsed.success) throw new HttpError("组合目标格式不正确");
    savePortfolioRisk(user.id, parsed.data);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, error instanceof HttpError ? error.status : 400);
  }
}

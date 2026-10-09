import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { getPortfolio, writePortfolio } from "@/lib/portfolio-store";

export const runtime = "nodejs";
const inputSchema = z
  .object({
    date: z.string(),
    kind: z.enum(["deposit", "withdraw", "buy", "sell", "dividend", "bonus"]),
    symbol: z.string().max(8),
    quantity: z.number().finite(),
    price: z.number().finite(),
    amount: z.number().finite(),
    fee: z.number().finite(),
    note: z.string().max(200),
  })
  .strict();

/** 使用当前会话账号，禁止客户端指定账户 ID。 */
async function account() {
  const user = await currentUser();
  if (!user) throw new HttpError("请登录后管理持仓账本", 401);
  return user;
}

/** GET /api/portfolio：个人账本和当前行情估值，禁止公共缓存。 */
export async function GET() {
  try {
    return NextResponse.json(await getPortfolio((await account()).id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** POST /api/portfolio：创建手工记录，回放通过后才提交。 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await account();
    const parsed = inputSchema.safeParse(await body(request));
    if (!parsed.success) throw new HttpError("账本字段格式不正确");
    writePortfolio(user.id, "create", parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** PATCH /api/portfolio：编辑保留原同日序号，不允许破坏后续账本。 */
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const user = await account();
    const parsed = z
      .object({ id: z.uuid(), record: inputSchema })
      .strict()
      .safeParse(await body(request));
    if (!parsed.success) throw new HttpError("账本编辑格式不正确");
    writePortfolio(user.id, "update", parsed.data.record, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** DELETE /api/portfolio：删除只作用当前账号，完整回放非法时拒绝。 */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const user = await account();
    const parsed = z
      .object({ id: z.uuid() })
      .strict()
      .safeParse(await body(request));
    if (!parsed.success) throw new HttpError("账本编号格式不正确");
    writePortfolio(user.id, "delete", undefined, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

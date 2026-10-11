import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { body, errorResponse, HttpError, rateLimit, sameOrigin } from "@/lib/http";
import {
  checkSignals,
  createSignal,
  getSignals,
  markSignalRead,
  updateSignal,
} from "@/lib/signals";
import { technicalSymbol } from "@/lib/technical-calculation";
export const runtime = "nodejs";
const rule = z
  .object({
    symbol: z.string().refine(technicalSymbol),
    kind: z.enum(["ma20Above", "macdBullish", "volumeSpike", "rsiOversold"]),
  })
  .strict();
/** 从服务端会话取得账号，客户端不能传入其他用户。 */
async function user() {
  const account = await currentUser();
  if (!account) throw new HttpError("请登录后管理技术信号", 401);
  return account;
}
/** GET：个人规则、最近记录和后台状态，禁止公共缓存。 */
export async function GET() {
  try {
    return NextResponse.json(getSignals((await user()).id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** POST：创建固定事实条件或手动检查盘后有效关注范围。 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const account = await user(),
      input = await body(request);
    if (input.action === "check" && Object.keys(input).length === 1) {
      rateLimit(`signals-check:${account.id}`, 30);
      return NextResponse.json(await checkSignals(account.id), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const parsed = rule.safeParse(input);
    if (!parsed.success) throw new HttpError("股票或技术条件格式不正确");
    createSignal(account.id, parsed.data.symbol, parsed.data.kind);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** PATCH：暂停/恢复条件或标记自己记录已读；无权限操作返回不存在。 */
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const account = await user();
    const parsed = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("enabled"), id: z.uuid(), enabled: z.boolean() }).strict(),
        z.object({ action: z.literal("read"), id: z.uuid().optional() }).strict(),
      ])
      .safeParse(await body(request));
    if (!parsed.success) throw new HttpError("技术信号操作格式不正确");
    if (parsed.data.action === "enabled")
      updateSignal(account.id, parsed.data.id, parsed.data.enabled);
    else markSignalRead(account.id, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
/** DELETE：删除个人规则，保留已触发事实历史。 */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const account = await user(),
      parsed = z
        .object({ id: z.uuid() })
        .strict()
        .safeParse(await body(request));
    if (!parsed.success) throw new HttpError("技术条件编号格式不正确");
    updateSignal(account.id, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

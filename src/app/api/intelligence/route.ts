import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { getIntelligence } from "@/lib/intelligence";
import { updateIntelligence } from "@/lib/intelligence-store";

export const runtime = "nodejs";
const querySchema = z
  .object({
    symbol: z
      .string()
      .regex(/^(?:sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj[489]\d{5})?$/)
      .default(""),
    kind: z.enum(["all", "announcement", "news", "alert", "signal"]).default("all"),
    state: z.enum(["all", "unread", "saved"]).default("all"),
    page: z.coerce.number().int().min(1).max(200).default(1),
  })
  .strict();

/** 情报查询及状态操作只认服务端会话，不接收客户端账号编号。 */
async function account() {
  const user = await currentUser();
  if (!user) throw new HttpError("请登录后查看关注情报", 401);
  return user;
}

/** GET /api/intelligence：有限来源聚合、过滤和分页，禁止共享或浏览器缓存。 */
export async function GET(request: Request) {
  try {
    const user = await account();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length > 1))
      throw new HttpError("查询参数不能重复");
    const query = querySchema.safeParse(Object.fromEntries(params));
    if (!query.success) throw new HttpError("情报查询条件不正确");
    return NextResponse.json(await getIntelligence(user.id, query.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** PATCH /api/intelligence：仅变更已验证条目的个人已读/收藏状态，不接受原文元数据。 */
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const user = await account();
    const input = z
      .object({
        id: z.string().regex(/^[a-f0-9]{64}$/),
        action: z.enum(["read", "saved"]),
        value: z.boolean(),
      })
      .strict()
      .safeParse(await body(request));
    if (!input.success) throw new HttpError("情报状态格式不正确");
    updateIntelligence(user.id, input.data.id, input.data.action, input.data.value);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

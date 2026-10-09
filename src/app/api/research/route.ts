import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { symbolPattern } from "@/lib/sina/parse";
import {
  deleteResearchEntry,
  deleteResearchGroup,
  orderResearchEntries,
  researchWorkspace,
  saveResearchEntry,
  saveResearchGroup,
} from "@/lib/research-store";

export const runtime = "nodejs";
const symbol = z.string().regex(symbolPattern, "股票代码格式不正确");
const id = z.string().uuid("分组编号格式不正确");
const name = z.string().trim().min(1, "请输入分组名称").max(24, "分组名称最多 24 字");
/** 仅接受有效日历日期，非法月份和闰日不会进入数据库。 */
function validReviewDate(value: string) {
  if (value === "") return true;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1900 ||
    Number(value.slice(0, 4)) > 2100
  )
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const reviewDate = z.string().refine(validReviewDate, "复查日期必须是有效的 YYYY-MM-DD 日期");
const entry = z.object({
  action: z.literal("entry"),
  symbol,
  groupId: id.nullable(),
  note: z.string().max(1500, "研究笔记最多 1500 字"),
  tags: z
    .array(z.string().trim().min(1, "标签不能为空").max(16, "每个标签最多 16 字"))
    .max(8, "最多保存 8 个标签")
    .transform((values) => [...new Set(values)]),
  reviewDate,
  position: z.number().int("排序必须是整数").min(0, "排序不能小于零").max(10000, "排序超出范围"),
});
const create = z.discriminatedUnion("action", [
  z.object({ action: z.literal("group"), name }),
  entry,
]);
const update = z.discriminatedUnion("action", [
  z.object({ action: z.literal("group"), id, name }),
  z.object({
    action: z.literal("order"),
    symbols: z.array(symbol).max(60, "最多排序 60 只自选股"),
  }),
]);
const remove = z.discriminatedUnion("action", [
  z.object({ action: z.literal("group"), id }),
  z.object({ action: z.literal("entry"), symbol }),
]);

/** 查询当前登录账号的分组和研究记录，私有内容不进入 HTTP 缓存。 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后保存研究记录", 401);
    return NextResponse.json(researchWorkspace(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** 校验同源会话和各写操作参数，客户端不能指定账号归属。 */
async function write(request: Request, method: "POST" | "PATCH" | "DELETE") {
  try {
    sameOrigin(request);
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后保存研究记录", 401);
    const schema = method === "POST" ? create : method === "PATCH" ? update : remove;
    const parsed = schema.safeParse(await body(request));
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message || "";
      throw new HttpError(
        /[\u4e00-\u9fff]/.test(detail) ? detail : "研究参数不正确，请检查必填字段",
      );
    }
    const input = parsed.data;
    if (input.action === "order") orderResearchEntries(user.id, input.symbols);
    else if (input.action === "group") {
      if (method === "DELETE" && "id" in input) deleteResearchGroup(user.id, input.id);
      else if ("name" in input)
        saveResearchGroup(user.id, input.name, "id" in input ? input.id : undefined);
    } else if (method === "DELETE") deleteResearchEntry(user.id, input.symbol);
    else if ("note" in input) saveResearchEntry(user.id, input);
    return NextResponse.json(researchWorkspace(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** 创建分组或覆盖一只股票的研究内容。 */
export async function POST(request: Request) {
  return write(request, "POST");
}
/** 重命名分组或保存完整自选顺序。 */
export async function PATCH(request: Request) {
  return write(request, "PATCH");
}
/** 删除分组或清除研究记录，收藏关系独立保留。 */
export async function DELETE(request: Request) {
  return write(request, "DELETE");
}

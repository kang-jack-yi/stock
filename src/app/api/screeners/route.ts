import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { body, errorResponse, HttpError, sameOrigin } from "@/lib/http";
import {
  createSavedScreener,
  deleteSavedScreener,
  listSavedScreeners,
  savedFiltersSchema,
  updateSavedScreener,
} from "@/lib/saved-screeners";

export const runtime = "nodejs";
const nameSchema = z.string().trim().min(1).max(40);
const createSchema = z.object({ name: nameSchema, filters: savedFiltersSchema }).strict();
const updateSchema = z
  .object({
    id: z.string().uuid(),
    name: nameSchema.optional(),
    filters: savedFiltersSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.filters !== undefined);
const deleteSchema = z.object({ id: z.string().uuid() }).strict();

/** GET /api/screeners：返回会话账号的方案，禁止缓存账号数据。 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后管理选股方案", 401);
    return NextResponse.json(
      { screeners: listSavedScreeners(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** 验证来源、账号与白名单数据后执行方案写操作，不接受客户端账号编号。 */
async function write(request: Request, operation: "create" | "update" | "delete") {
  try {
    sameOrigin(request);
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后管理选股方案", 401);
    const input = await body(request);
    if (operation === "create") {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success)
        throw new HttpError(
          parsed.error.issues[0]?.message === "下限不能高于上限"
            ? "下限不能高于上限"
            : "方案名称或选股条件格式不正确",
        );
      const id = createSavedScreener(user.id, parsed.data.name, parsed.data.filters);
      return NextResponse.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "update") {
      const parsed = updateSchema.safeParse(input);
      if (!parsed.success) throw new HttpError("方案名称或选股条件格式不正确");
      updateSavedScreener(user.id, parsed.data.id, parsed.data.name, parsed.data.filters);
    } else {
      const parsed = deleteSchema.safeParse(input);
      if (!parsed.success) throw new HttpError("方案编号格式不正确");
      deleteSavedScreener(user.id, parsed.data.id);
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** POST /api/screeners：保存已应用的筛选条件。 */
export async function POST(request: Request) {
  return write(request, "create");
}
/** PATCH /api/screeners：改名或用已应用条件覆盖指定方案。 */
export async function PATCH(request: Request) {
  return write(request, "update");
}
/** DELETE /api/screeners：删除当前账号的指定方案。 */
export async function DELETE(request: Request) {
  return write(request, "delete");
}

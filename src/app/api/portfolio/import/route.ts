import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { errorResponse, HttpError, sameOrigin } from "@/lib/http";
import {
  commitPortfolioImport,
  portfolioImportBody,
  previewPortfolioImport,
} from "@/lib/portfolio-import-store";

export const runtime = "nodejs";
const column = z.number().int().min(0).max(19).nullable();
const schema = z
  .object({
    csv: z.string().max(1024 * 1024),
    columns: z
      .object({
        date: column,
        kind: column,
        symbol: column,
        quantity: column,
        price: column,
        amount: column,
        fee: column,
        note: column,
        reference: column,
      })
      .strict(),
    action: z.enum(["preview", "commit"]),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
/** POST 批量导入：会话确定账号，同源流式有界请求，预览和提交均做完整回放。 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后导入账本", 401);
    const input = schema.safeParse(await portfolioImportBody(request));
    if (!input.success) throw new HttpError("导入字段格式不正确");
    const { csv, columns, action, version } = input.data;
    if (action === "commit" && !version) throw new HttpError("请先预览再确认导入");
    const result =
      action === "preview"
        ? previewPortfolioImport(user.id, csv, columns)
        : commitPortfolioImport(user.id, csv, columns, version!);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, error instanceof HttpError ? error.status : 400);
  }
}

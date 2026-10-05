import { NextResponse } from "next/server";
import { z } from "zod";
import { screener } from "@/lib/sina/universe";
import { screenerSorts } from "@/lib/screener";
import { HttpError, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
/** 可选数值参数只能是有限数值，留空表示不设边界。 */
const positive = z.coerce.number().finite().min(0).max(1e15).optional();
const change = z.coerce.number().finite().min(-100).max(10000).optional();
const schema = z
  .object({
    market: z.enum(["all", "sh", "sz", "bj", "cyb", "kcb"]).default("all"),
    query: z.string().max(40).default(""),
    minPrice: positive,
    maxPrice: positive,
    minChange: change,
    maxChange: change,
    minPe: positive,
    maxPe: positive,
    maxPb: positive,
    minTurnover: positive,
    maxTurnover: positive,
    minCap: positive,
    maxCap: positive,
    minAmount: positive,
    profitable: z
      .enum(["0", "1"])
      .default("0")
      .transform((value) => value === "1"),
    excludeSt: z
      .enum(["0", "1"])
      .default("0")
      .transform((value) => value === "1"),
    sort: z.enum(screenerSorts).default("amount"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).max(750).default(1),
  })
  .superRefine((value, context) => {
    for (const [min, max] of [
      [value.minPrice, value.maxPrice],
      [value.minChange, value.maxChange],
      [value.minPe, value.maxPe],
      [value.minTurnover, value.maxTurnover],
      [value.minCap, value.maxCap],
    ])
      if (min !== undefined && max !== undefined && min > max)
        context.addIssue({ code: "custom", message: "下限不能高于上限" });
  });

/** GET /api/screener：验证条件后从完整 A 股快照筛选，不对单页数据冒充全市场筛选。 */
export async function GET(request: Request) {
  try {
    const entries = Object.fromEntries(new URL(request.url).searchParams);
    for (const key of Object.keys(entries)) if (entries[key] === "") delete entries[key];
    const parsed = schema.safeParse(entries);
    if (!parsed.success)
      throw new HttpError(
        parsed.error.issues[0]?.message === "下限不能高于上限"
          ? "下限不能高于上限"
          : "选股条件格式不正确",
        400,
      );
    return NextResponse.json(await screener(parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

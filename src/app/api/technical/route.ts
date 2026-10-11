import { NextResponse } from "next/server";
import { getTechnical } from "@/lib/technical";
import { technicalSymbol } from "@/lib/technical-calculation";
import { HttpError, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
/** GET：只请求固定上游 A 股日线，拒绝任意 URL、指数和无效复权枚举。 */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const symbol = query.get("symbol") || "",
      adjustment = query.get("adjustment") || "qfq";
    if (!technicalSymbol(symbol) || !["none", "qfq"].includes(adjustment))
      throw new HttpError("日线股票代码或复权口径不正确");
    return NextResponse.json(await getTechnical(symbol, adjustment as "none" | "qfq"), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

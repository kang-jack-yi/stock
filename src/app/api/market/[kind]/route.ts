import { NextResponse } from "next/server";
import { candles, financials, funds, market, minutes, quotes, search } from "@/lib/sina/client";
import { errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";
/** GET /api/market/[kind]：验证各模块查询参数，统一返回 data/meta 或 HTTP 错误。 */
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  const p = new URL(request.url).searchParams;
  try {
    let result;
    switch (kind) {
      case "quotes":
        result = await quotes((p.get("symbols") || "").split(","));
        break;
      case "search":
        result = await search(p.get("q") || "");
        break;
      case "list":
        result = await market(
          p.get("node") || "hs_a",
          p.get("sort") || "changepercent",
          p.get("asc") || "0",
          Number(p.get("page") || "1"),
        );
        break;
      case "candles":
        result = await candles(p.get("symbol") || "", p.get("scale") || "240");
        break;
      case "minutes":
        result = await minutes(p.get("symbol") || "");
        break;
      case "funds":
        result = await funds(p.get("symbol") || "");
        break;
      case "financials":
        result = await financials(p.get("symbol") || "", p.get("source") || "gjzb");
        break;
      default:
        throw new HttpError("接口不存在", 404);
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const inputError =
      error instanceof Error &&
      /不正确|查询条件|每次查询|搜索词|不支持该 K|报表类型/.test(error.message);
    return errorResponse(error, inputError ? 400 : 502);
  }
}

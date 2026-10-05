import { NextResponse } from "next/server";
import { breadth } from "@/lib/sina/universe";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
/** GET /api/breadth：完整 A 股集合的市场宽度，缓存时间与选股快照一致。 */
export async function GET() {
  try {
    return NextResponse.json(await breadth(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

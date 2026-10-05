import { NextResponse } from "next/server";
import type { SectorKind } from "@/lib/sector-types";
import { errorResponse, HttpError } from "@/lib/http";
import { sectorConstituents, sectors } from "@/lib/sina/sectors";

export const runtime = "nodejs";

/** GET /api/sectors：返回完整板块榜，携带 node 时返回该板块的真实成分分页行情。 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const kind = params.get("type") || "industry";
    if (kind !== "industry" && kind !== "concept") throw new HttpError("板块分类不正确");
    const node = params.get("node");
    const result = node
      ? await sectorConstituents(
          kind as SectorKind,
          node,
          params.get("sort") || "changepercent",
          params.get("asc") || "0",
          Number(params.get("page") || "1"),
        )
      : await sectors(kind);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { announcements } from "@/lib/announcements";
import { parseAnnouncementQuery } from "@/lib/announcement-parse";
import { errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/announcements：公开 A 股标题元数据，完整区间过滤、去重后返回真实分页。 */
export async function GET(request: Request) {
  try {
    let query;
    try {
      query = parseAnnouncementQuery(new URL(request.url).searchParams);
    } catch (error) {
      throw new HttpError(error instanceof Error ? error.message : "公告查询条件不正确");
    }
    return NextResponse.json(await announcements(query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

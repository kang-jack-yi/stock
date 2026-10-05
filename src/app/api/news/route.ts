import { NextResponse } from "next/server";
import { newsCategories, parseNews, type NewsResult } from "@/lib/news";
import { cached, text } from "@/lib/sina/client";
import { errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";
const feeds = { finance: 2519, stocks: 2671, world: 2676 };
/** GET /api/news：使用新浪官方滚动页 pageid 384 的已验证分类，最多翻 100 页。 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const category = params.get("category") || "stocks",
      page = Number(params.get("page") || "1");
    if (
      !(newsCategories as readonly string[]).includes(category) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100
    )
      throw new HttpError("资讯查询条件不正确", 400);
    const kind = category as NewsResult["category"];
    const result = await cached(`news:${kind}:${page}`, 60000, async () =>
      parseNews(
        await text(
          `https://feed.mix.sina.com.cn/api/roll/get?pageid=384&lid=${feeds[kind]}&num=20&page=${page}`,
        ),
        kind,
      ),
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

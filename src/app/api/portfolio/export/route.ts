import { currentUser } from "@/lib/auth";
import { errorResponse, HttpError } from "@/lib/http";
import { exportPortfolioCsv, portfolioCsvTemplate } from "@/lib/portfolio-import";
import { portfolioTransactions } from "@/lib/portfolio-store";

export const runtime = "nodejs";
/** GET 当前账号 CSV 备份或空模板，不包含账号邮箱、凭证及风控设置。 */
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError("请登录后导出账本", 401);
    const template = new URL(request.url).searchParams.get("template") === "1";
    return new Response(
      template ? portfolioCsvTemplate() : exportPortfolioCsv(portfolioTransactions(user.id)),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="portfolio-${template ? "template" : "backup"}.csv"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return errorResponse(error, 500);
  }
}

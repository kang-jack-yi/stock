import { News } from "@/components/news";
import { newsCategories } from "@/lib/news";
import { notFound } from "next/navigation";

export const metadata = { title: "财经资讯" };
/** 官方资讯分类和页码校验在服务端完成，避免无效查询反复请求上游。 */
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const params = await searchParams,
    category = params.category || "stocks",
    page = Number(params.page || "1");
  if (
    !(newsCategories as readonly string[]).includes(category) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100
  )
    notFound();
  return <News key={`${category}:${page}`} category={category} page={page} />;
}

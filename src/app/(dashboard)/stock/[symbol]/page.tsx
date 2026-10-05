import { notFound } from "next/navigation";
import { StockDetail } from "@/components/stock-detail";
import { symbolPattern } from "@/lib/sina/parse";
import { isIndex } from "@/lib/format";
/** 动态股票页面在服务端校验路径代码，错误路径不进入数据请求层。 */
export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { symbol } = await params,
    { view } = await searchParams;
  if (!symbolPattern.test(symbol)) notFound();
  const selected =
    !isIndex(symbol) && ["funds", "financials"].includes(view || "") ? view! : "overview";
  return <StockDetail symbol={symbol} view={selected} />;
}
/** 动态标题不访问上游，避免元数据请求重复拉取行情。 */
export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  return { title: `${(await params).symbol.slice(2)} 股票详情` };
}

import { notFound } from "next/navigation";
import { Compare } from "@/components/compare";
import { symbolPattern } from "@/lib/sina/parse";

export const metadata = { title: "股票比较" };
/** 站内比较路由最多允许四个有效代码和四种窗口，查询参数异步读取。 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ symbols?: string; days?: string }>;
}) {
  const params = await searchParams;
  const symbols = [...new Set((params.symbols || "sh600519,sz000001").split(","))];
  const days = Number(params.days || "60");
  if (
    symbols.length > 4 ||
    symbols.some((symbol) => !symbolPattern.test(symbol)) ||
    ![20, 60, 120, 240].includes(days)
  )
    notFound();
  return <Compare key={`${symbols.join(",")}:${days}`} symbols={symbols} days={days} />;
}

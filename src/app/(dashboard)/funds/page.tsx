import { Research } from "@/components/research";
import { symbolPattern } from "@/lib/sina/parse";
import { isIndex } from "@/lib/format";
export const metadata = { title: "资金流向" };
/** 独立资金页从查询参数读取标的，缺省展示贵州茅台。 */
export default async function FundsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const { symbol } = await searchParams;
  return (
    <Research
      kind="funds"
      symbol={symbol && symbolPattern.test(symbol) && !isIndex(symbol) ? symbol : "sh600519"}
    />
  );
}

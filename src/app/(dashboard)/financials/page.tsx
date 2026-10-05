import { Research } from "@/components/research";
import { symbolPattern } from "@/lib/sina/parse";
import { isIndex } from "@/lib/format";
export const metadata = { title: "财务研究" };
/** 财务页保持为服务端路由，交互报表在独立 Client Component 中。 */
export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const { symbol } = await searchParams;
  return (
    <Research
      kind="financials"
      symbol={symbol && symbolPattern.test(symbol) && !isIndex(symbol) ? symbol : "sh600519"}
    />
  );
}

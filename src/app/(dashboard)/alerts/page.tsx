import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Alerts } from "@/components/alerts";
import { symbolPattern } from "@/lib/sina/parse";
export const metadata = { title: "提醒中心" };
/** 提醒页面先校验会话；可从股票详情带入合法证券代码。 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const params = await searchParams;
  const symbol = params.symbol && symbolPattern.test(params.symbol) ? params.symbol : "";
  if (!(await currentUser()))
    redirect(`/login?next=${encodeURIComponent(`/alerts${symbol ? `?symbol=${symbol}` : ""}`)}`);
  return <Alerts initialSymbol={symbol} />;
}

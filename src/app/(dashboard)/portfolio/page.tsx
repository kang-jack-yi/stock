import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Portfolio } from "@/components/portfolio";

export const metadata = { title: "持仓与组合" };

/** 持仓页面验证会话，并只接受 A 股代码作为手工记录的初始证券。 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const params = await searchParams;
  const symbol =
    params.symbol && /^(sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj[489]\d{5})$/.test(params.symbol)
      ? params.symbol
      : "";
  if (!(await currentUser()))
    redirect(`/login?next=${encodeURIComponent(`/portfolio${symbol ? `?symbol=${symbol}` : ""}`)}`);
  return <Portfolio initialSymbol={symbol} />;
}

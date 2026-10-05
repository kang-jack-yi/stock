import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Watchlist } from "@/components/watchlist";
export const metadata = { title: "我的自选" };
/** 页面先在服务端保护，API 会再次校验用户以防直接调用越权。 */
export default async function WatchlistPage() {
  if (!(await currentUser())) redirect("/login?next=/watchlist");
  return <Watchlist />;
}

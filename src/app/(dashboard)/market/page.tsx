import { Market } from "@/components/market";
export const metadata = { title: "股票排行" };
/** 股票排行使用独立页面和共享服务端布局。 */
export default function MarketPage() {
  return <Market />;
}

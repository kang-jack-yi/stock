import { Screener } from "@/components/screener";

export const metadata = { title: "条件选股" };
/** 服务端保留站内筛选查询，key 让回退和预设切换同步表单值。 */
export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  Object.entries(await searchParams).forEach(([key, value]) => {
    if (typeof value === "string") params.set(key, value);
  });
  const query = params.toString();
  return <Screener key={query} query={query} />;
}

import { Sectors } from "@/components/sectors";

export const metadata = { title: "板块行情" };

/** Next.js 服务端页面等待异步查询参数，将可分享板块选择传给独立客户端组件。 */
export default async function SectorsPage({
  searchParams,
}: {
  /** App Router 异步查询参数；客户端不能访问服务端上游请求方法。 */
  searchParams: Promise<{ type?: string; node?: string }>;
}) {
  const params = await searchParams;
  const kind = params.type === "concept" ? "concept" : "industry";
  const node =
    params.node && /^(?:new_|gn_)[a-zA-Z0-9_]{1,40}$/.test(params.node) ? params.node : undefined;
  return <Sectors kind={kind} node={node} />;
}

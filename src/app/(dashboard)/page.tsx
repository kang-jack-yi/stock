import { Overview } from "@/components/overview";
/** App Router 服务端页面，仅将持续轮询的行情模块交给客户端。 */
export default function HomePage() {
  return <Overview />;
}

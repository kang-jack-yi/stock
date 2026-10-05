import { Shell } from "@/components/shell";
/** 行情路由组共享导航；children 继续保留 Server Component 边界。 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

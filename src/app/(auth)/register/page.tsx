import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "注册" };
/** 注册入口保留站内回跳参数，验证和账号创建仅在服务端执行。 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentUser()) redirect("/watchlist");
  return <AuthForm mode="register" next={(await searchParams).next || "/watchlist"} />;
}

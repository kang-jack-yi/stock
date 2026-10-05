import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "登录" };
/** 已登录用户直接进入自选；searchParams 按 Next.js 规范异步读取。 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentUser()) redirect("/watchlist");
  return <AuthForm mode="login" next={(await searchParams).next || "/watchlist"} />;
}

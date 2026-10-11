import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Intelligence } from "@/components/intelligence";

export const metadata = { title: "关注情报" };

/** 登录后查看账号独立的关注情报，保留未登录返回地址。 */
export default async function IntelligencePage() {
  if (!(await currentUser())) redirect("/login?next=%2Fintelligence");
  return <Intelligence />;
}

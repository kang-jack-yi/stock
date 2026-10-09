import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { DailyReview } from "@/components/daily-review";

export const metadata = { title: "每日复盘" };

/** 个人复盘需要账号会话，未登录时保留返回地址。 */
export default async function ReviewPage() {
  if (!(await currentUser())) redirect("/login?next=%2Freview");
  return <DailyReview />;
}

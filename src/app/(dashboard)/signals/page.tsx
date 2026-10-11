import { SignalManager } from "@/components/technical-panel";
export const metadata = { title: "技术信号" };
/** 页面保留服务端边界，账号条件操作由独立客户端工作区处理。 */
export default function SignalsPage() {
  return <SignalManager />;
}

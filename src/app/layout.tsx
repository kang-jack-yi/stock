import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Providers } from "@/components/providers";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "观澜行情 · 看见市场的每一面", template: "%s · 观澜行情" },
  description: "沪深股票行情、五档盘口、分时 K 线、资金流向与公司财务研究。",
};
/** 根布局负责中文文档、antd 服务端样式注入与服务端会话校验。 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('guanlan-theme')==='dark'?'dark':'light'}catch(e){}`,
          }}
        />
      </head>
      <body>
        <AntdRegistry>
          <Providers initialUser={user}>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}

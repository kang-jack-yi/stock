import Link from "next/link";
/** 无效股票代码与不存在的路径统一进入 404。 */
export default function NotFound() {
  return (
    <main className="not-found">
      <span className="eyebrow">404 · PAGE NOT FOUND</span>
      <h1>这里还没有行情</h1>
      <p>请确认页面地址或股票代码。</p>
      <Link href="/">返回市场总览 →</Link>
    </main>
  );
}

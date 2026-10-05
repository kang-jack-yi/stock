import { Logo } from "@/components/shell";
/** 账号路由组采用专用布局，避免交易看板信息分散表单注意力。 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-visual">
        <Logo />
        <div className="auth-pitch">
          <div className="eyebrow">GUANLAN MARKET INSIGHTS</div>
          <h2>
            看见市场的
            <br />
            每一面。
          </h2>
          <p>
            从价格变化到企业价值，
            <br />
            用清晰的数据，形成自己的判断。
          </p>
          <div className="auth-chart">
            <svg viewBox="0 0 500 180" fill="none" aria-hidden="true">
              <path
                d="M0 150L40 140L65 153L100 110L130 120L165 81L200 95L235 60L265 72L300 36L335 58L370 22L400 39L440 12L500 5"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M0 150L40 140L65 153L100 110L130 120L165 81L200 95L235 60L265 72L300 36L335 58L370 22L400 39L440 12L500 5V180H0Z"
                fill="url(#chart-fill)"
              />
              <defs>
                <linearGradient
                  id="chart-fill"
                  x1="250"
                  y1="0"
                  x2="250"
                  y2="180"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="currentColor" stopOpacity=".2" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="auth-features">
            <span>真实行情</span>
            <span>财务研究</span>
            <span>账号同步</span>
          </div>
        </div>
        <span className="auth-copyright">GUANLAN · 观澜行情</span>
      </div>
      <div className="auth-panel">{children}</div>
    </main>
  );
}

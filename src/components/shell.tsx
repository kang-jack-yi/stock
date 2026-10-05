"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Avatar, Button, Dropdown, App } from "antd";
import {
  AppstoreOutlined,
  StarOutlined,
  BarChartOutlined,
  FundOutlined,
  BankOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  UserOutlined,
  ApartmentOutlined,
  FilterOutlined,
  SwapOutlined,
  MoreOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { useApp } from "./providers";
import { StockSearch } from "./search";
import { fetchJson } from "@/lib/api";

const navigation = [
  { href: "/", label: "市场总览", icon: AppstoreOutlined, group: "市场" },
  { href: "/market", label: "股票排行", icon: BarChartOutlined, group: "市场" },
  { href: "/watchlist", label: "我的自选", icon: StarOutlined, group: "市场" },
  { href: "/sectors", label: "板块行情", icon: ApartmentOutlined, group: "市场" },
  { href: "/news", label: "财经资讯", icon: ReadOutlined, group: "市场" },
  { href: "/screener", label: "条件选股", icon: FilterOutlined, group: "研究工具" },
  { href: "/compare", label: "股票比较", icon: SwapOutlined, group: "研究工具" },
  { href: "/funds", label: "资金流向", icon: FundOutlined, group: "研究工具" },
  { href: "/financials", label: "财务研究", icon: BankOutlined, group: "研究工具" },
];
/** 首页采用精确匹配，其余导航允许详情子路径继承当前栏目状态。 */
function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
/** 统一品牌图标以 SVG 绘制，不依赖远程图片资源。 */
export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="观澜行情首页">
      <span className="logo-mark">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M7 22V17L13 11L18 16L25 8"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 8H25V13"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        观澜<span className="logo-sub">行情</span>
      </span>
    </Link>
  );
}
/** 导航和搜索属于交互边界，页面内容仍由 App Router 的 Server Components 提供。 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(),
    router = useRouter();
  const { mode, toggleTheme, user, refreshUser } = useApp();
  const { message } = App.useApp();
  const activePage = navigation.find((item) => isActivePath(pathname, item.href));
  const pageLabel = activePage?.label || (pathname.startsWith("/stock/") ? "行情详情" : "观澜行情");
  const mobilePrimary = navigation.slice(0, 4);
  const mobileMore = navigation.slice(4);
  useEffect(() => {
    /** Cmd / Ctrl + K 聚焦顶部股票搜索；保留其他浏览器和系统组合键。 */
    function focusSearch(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const input = document.querySelector<HTMLInputElement>('.topbar [aria-label="搜索股票"]');
      if (!input) return;
      event.preventDefault();
      input.focus();
    }
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);
  /** 删除服务端会话后重新校验用户，确保自选股内容不残留。 */
  async function logout() {
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
      await refreshUser();
      router.push("/");
      router.refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <aside className="sidebar">
        <Logo />
        <nav aria-label="主要导航">
          {["市场", "研究工具"].map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-caption">{group}</div>
              {navigation.filter((item) => item.group === group).map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    className={`nav-item ${active ? "active" : ""}`}
                    href={item.href}
                    key={item.href}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-card">
            <span className="source-icon">
              <FundOutlined />
            </span>
            <strong>行情与研究</strong>
            <p>洞察行情，关注每一次变化。</p>
            <span className="source-badge">
              <i /> 真实行情数据
            </span>
          </div>
          <div className="sidebar-foot">GUANLAN · MARKET INSIGHTS</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-logo">
            <Logo />
          </div>
          <div className="toolbar-title">
            <span>观澜行情</span>
            <strong>{pageLabel}</strong>
          </div>
          <div className="toolbar-search" role="search" aria-label="全站股票搜索" aria-keyshortcuts="Meta+K Control+K" title="Cmd / Ctrl + K：搜索股票">
            <StockSearch />
            <kbd className="toolbar-shortcut" aria-hidden="true">⌘ / Ctrl K</kbd>
          </div>
          <div className="topbar-right">
            <span className="market-source">
              <i /> 行情数据
            </span>
            <Button
              type="text"
              className="theme-button"
              onClick={toggleTheme}
              aria-label={mode === "light" ? "切换暗色主题" : "切换亮色主题"}
              icon={mode === "light" ? <MoonOutlined /> : <SunOutlined />}
            />
            {user ? (
              <Dropdown
                menu={{
                  items: [
                    { key: "email", label: user.email, disabled: true },
                    { key: "logout", label: "退出登录", icon: <LogoutOutlined />, onClick: logout },
                  ],
                }}
                trigger={["click"]}
              >
                <button className="user-button" aria-label="账号菜单">
                  <Avatar
                    size={32}
                    style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
                  >
                    {user.name.slice(0, 1)}
                  </Avatar>
                  <span>{user.name}</span>
                </button>
              </Dropdown>
            ) : (
              <Link href="/login">
                <Button icon={<UserOutlined />}>登录 / 注册</Button>
              </Link>
            )}
          </div>
        </header>
        <nav className="mobile-nav" aria-label="移动端导航">
          {mobilePrimary.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                href={item.href}
                key={item.href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                <Icon />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <Dropdown
            trigger={["click"]}
            placement="topRight"
            menu={{
              selectedKeys: activePage ? [activePage.href] : [],
              items: mobileMore.map((item) => {
                const Icon = item.icon;
                return { key: item.href, icon: <Icon />, label: <Link href={item.href}>{item.label}</Link> };
              }),
            }}
          >
            <button
              className={mobileMore.some((item) => isActivePath(pathname, item.href)) ? "active" : ""}
              aria-label="更多功能"
            >
              <MoreOutlined />
              <span>更多</span>
            </button>
          </Dropdown>
        </nav>
        <main id="main-content" className="page-content">
          {children}
        </main>
        <footer className="page-footer">
          <span>© {new Date().getFullYear()} 观澜行情</span>
          <span>行情以数据时间为准，仅供参考</span>
        </footer>
      </div>
    </div>
  );
}

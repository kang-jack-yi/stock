"use client";

import { App, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { AuthResult, User } from "@/lib/types";
import { fetchJson } from "@/lib/api";

type ThemeMode = "light" | "dark";
interface AppContextValue {
  /** 当前主题；所有图表与 Ant Design 共享该值。 */
  mode: ThemeMode;
  /** 在两套主题之间切换，并保存到当前浏览器。 */
  toggleTheme: () => void;
  /** 服务端验证会话后返回的用户，不包含密码和登录凭证。 */
  user: User | null;
  /** 重新验证登录状态，登录或退出后调用。 */
  refreshUser: () => Promise<unknown>;
}
const AppContext = createContext<AppContextValue | null>(null);
const listeners = new Set<() => void>();
let memoryTheme: ThemeMode = "light";
/** 订阅同一页面中的主题切换及其他标签页的 storage 事件。 */
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
/** localStorage 不可用时仍允许在本次页面访问期间切换主题。 */
function themeSnapshot(): ThemeMode {
  try {
    return localStorage.getItem("guanlan-theme") === "dark" ? "dark" : "light";
  } catch {
    return memoryTheme;
  }
}
/** Provider 保留服务端初始用户，并按需重新校验 HttpOnly 会话。 */
export function Providers({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: User | null;
}) {
  const mode = useSyncExternalStore(subscribe, themeSnapshot, () => "light" as ThemeMode);
  const { data, mutate } = useSWR<AuthResult>("/api/auth/me", fetchJson, {
    fallbackData: { user: initialUser },
    revalidateOnFocus: true,
  });
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);
  /** 主题修改同时触发 React 订阅更新与 CSS 语义色更新。 */
  function toggleTheme() {
    memoryTheme = mode === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("guanlan-theme", memoryTheme);
    } catch {
      /* 隐私模式下使用内存主题。 */
    }
    listeners.forEach((listener) => listener());
  }
  return (
    <AppContext.Provider
      value={{ mode, toggleTheme, user: data?.user ?? null, refreshUser: () => mutate() }}
    >
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: mode === "dark" ? "#95b7ff" : "#225dd9",
            colorLink: mode === "dark" ? "#95b7ff" : "#225dd9",
            colorText: mode === "dark" ? "#f1f2f5" : "#202124",
            colorTextSecondary: mode === "dark" ? "#b0b2bc" : "#63666e",
            colorTextPlaceholder: mode === "dark" ? "#a0a3ae" : "#70747d",
            colorTextLightSolid: mode === "dark" ? "#161b26" : "#ffffff",
            colorBgContainer: mode === "dark" ? "#232428" : "#ffffff",
            colorBgElevated: mode === "dark" ? "#2b2c30" : "#ffffff",
            colorBorder: mode === "dark" ? "#3a3b41" : "#dedfe3",
            colorBorderSecondary: mode === "dark" ? "#3a3b41" : "#e6e7eb",
            borderRadius: 8,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
            colorSuccess: mode === "dark" ? "#75d5b1" : "#087453",
            colorError: mode === "dark" ? "#ff909a" : "#bb3040",
            controlHeight: 38,
          },
          components: {
            Table: { headerBg: mode === "dark" ? "#2b2c30" : "#f5f5f7", cellPaddingBlock: 14 },
            Button: { primaryShadow: "none" },
            Segmented: {
              trackBg: mode === "dark" ? "#303136" : "#eeeef1",
              itemSelectedBg: mode === "dark" ? "#45464e" : "#ffffff",
            },
          },
        }}
      >
        <App>{children}</App>
      </ConfigProvider>
    </AppContext.Provider>
  );
}
/** 获取主题与账号上下文；组件必须位于根布局 Provider 内。 */
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp 必须在 Providers 中使用");
  return context;
}

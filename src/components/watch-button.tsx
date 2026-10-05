"use client";

import { Button, App } from "antd";
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { fetchJson } from "@/lib/api";
import { useApp } from "./providers";
import { useWatchlist } from "@/lib/use-watchlist";

/** 自选股操作只写入当前会话的账号；服务端不接收客户端 userId。 */
export function WatchButton({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const { user } = useApp(),
    { message } = App.useApp(),
    router = useRouter(),
    pathname = usePathname();
  const { data, mutate } = useWatchlist(user?.id);
  const [busy, setBusy] = useState(false),
    selected = data?.symbols.includes(symbol) || false;
  /** 未登录时保留当前路径，完成登录后继续浏览该股票。 */
  async function toggle() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setBusy(true);
    try {
      await fetchJson("/api/watchlist", {
        method: selected ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      await mutate();
      message.success(selected ? "已移出自选" : "已加入自选");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      className={selected ? "watch-selected" : ""}
      type={compact ? "text" : "default"}
      icon={selected ? <StarFilled /> : <StarOutlined />}
      loading={busy}
      onClick={toggle}
      aria-label={`${selected ? "移出" : "加入"}自选 ${symbol}`}
    >
      {compact ? null : selected ? "已加入自选" : "加入自选"}
    </Button>
  );
}

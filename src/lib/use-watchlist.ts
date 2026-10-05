"use client";
import useSWR from "swr";
import { fetchJson } from "./api";
import type { WatchlistResult } from "./types";

/** 缓存键包含账号 ID，切换账号时不会短暂展示前一位用户的自选股。 */
export function useWatchlist(userId?: string) {
  return useSWR<WatchlistResult>(
    userId ? ["/api/watchlist", userId] : null,
    ([url]: [string, string]) => fetchJson(url),
  );
}

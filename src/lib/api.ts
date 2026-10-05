import useSWR from "swr";
import { tradingHours } from "./format";
import type { ApiResult } from "./types";

/** 读取同源 JSON API，将服务端业务错误转换为可展示的 Error。 */
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试");
  return data;
}
/** 行情轮询只在页面可见、网络在线时执行；慢速数据关闭轮询。 */
export function useMarketData<T>(url: string | null, poll = true) {
  return useSWR<ApiResult<T>>(url, fetchJson, {
    refreshInterval: poll ? (tradingHours() ? 10000 : 60000) : 0,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: poll,
    dedupingInterval: 5000,
    errorRetryCount: 2,
  });
}

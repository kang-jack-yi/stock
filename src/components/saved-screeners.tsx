"use client";

import { App, Button, Empty, Input, Modal, Popconfirm, Spin } from "antd";
import { SaveOutlined, StarOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetchJson } from "@/lib/api";
import { useWatchlist } from "@/lib/use-watchlist";
import type { SavedScreener } from "@/lib/saved-screeners";
import { useApp } from "./providers";
import "./saved-screeners.css";

/** API 返回的当前账号方案集合。 */
interface SavedResult {
  /** 已验证且可重新运行的选股方案。 */
  screeners: SavedScreener[];
}

/** 保存面板仅接收已应用 URL 和当前实际展示的证券。 */
interface SavedProps {
  /** 已应用条件的 URL 查询字符串。 */
  query: string;
  /** 当前页已经加载完成的证券代码，最多二十个。 */
  symbols: string[];
}

/** 金额保留 URL 中的元单位，页码和任意外部地址不会写入方案。 */
function appliedFilters(query: string): Record<string, string | number | boolean> {
  const params = new URLSearchParams(query);
  const result: Record<string, string | number | boolean> = {};
  const numeric = [
    "minPrice",
    "maxPrice",
    "minChange",
    "maxChange",
    "minPe",
    "maxPe",
    "maxPb",
    "minTurnover",
    "maxTurnover",
    "minCap",
    "maxCap",
    "minAmount",
  ];
  for (const [key, value] of params) {
    if (value === "") continue;
    if (numeric.includes(key)) result[key] = Number(value);
    else if (["profitable", "excludeSt"].includes(key))
      result[key] = value === "1" || value === "0" ? value === "1" : value;
    else if (["market", "query", "sort", "order"].includes(key)) result[key] = value;
  }
  return result;
}

/** 已保存条件恢复成站内筛选 URL；布尔值使用现有行情接口的 0/1 约定。 */
function savedQuery(screener: SavedScreener): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(screener.filters)) {
    if (value === undefined || value === "") continue;
    if (typeof value === "boolean") {
      if (value) params.set(key, "1");
    } else params.set(key, String(value));
  }
  return params.toString();
}

/** 账号方案与行情筛选保持独立；未应用的表单编辑不能悄悄覆盖保存内容。 */
export function SavedScreeners({ query, symbols }: SavedProps) {
  const { user } = useApp();
  return <SavedScreenersContent key={user?.id || "anonymous"} query={query} symbols={symbols} />;
}

/** 切换账号时重建名称编辑和批量添加状态，防止显示上一账号的草稿。 */
function SavedScreenersContent({ query, symbols }: SavedProps) {
  const { user } = useApp(),
    { message } = App.useApp(),
    router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<SavedResult>(
    user ? ["/api/screeners", user.id] : null,
    ([url]: [string, string]) => fetchJson(url),
  );
  const { data: watchlist, mutate: refreshWatchlist } = useWatchlist(user?.id);
  const [editing, setEditing] = useState<SavedScreener | "new" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  /** 登录返回完整筛选条件，不丢失当前研究结果。 */
  function login() {
    router.push(`/login?next=${encodeURIComponent(`/screener${query ? `?${query}` : ""}`)}`);
  }
  /** 新增保存当前 URL；改名只修改名称，原有条件保持不变。 */
  function openName(value: SavedScreener | "new") {
    if (!user) {
      login();
      return;
    }
    setName(value === "new" ? "" : value.name);
    setEditing(value);
  }
  /** 写入通过统一 API helper 展示错误，失败时保留名称供用户修改。 */
  async function saveName() {
    if (!editing || !name.trim() || busy) return;
    setBusy(true);
    try {
      await fetchJson("/api/screeners", {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing === "new" ? { name, filters: appliedFilters(query) } : { id: editing.id, name },
        ),
      });
      setEditing(null);
      await mutate();
      message.success(editing === "new" ? "选股方案已保存" : "方案已改名");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** 覆盖和删除先由用户明确确认，每个请求只能操作当前会话账号的方案。 */
  async function change(screener: SavedScreener, remove: boolean) {
    setBusy(true);
    try {
      await fetchJson("/api/screeners", {
        method: remove ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          remove ? { id: screener.id } : { id: screener.id, filters: appliedFilters(query) },
        ),
      });
      await mutate();
      message.success(remove ? "方案已删除" : "已使用当前应用条件更新方案");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** 仅添加当前页；已有自选跳过，达到账号限制时明确报告部分完成情况。 */
  async function addPage() {
    if (!user) {
      login();
      return;
    }
    setAdding(true);
    let added = 0;
    try {
      for (const symbol of symbols) {
        if (watchlist?.symbols.includes(symbol)) continue;
        await fetchJson("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        added++;
      }
      message.success(added ? `已添加 ${added} 只股票到自选` : "本页股票已在自选中");
    } catch (error) {
      message.error(`本次已添加 ${added} 只；${(error as Error).message}`);
    } finally {
      await refreshWatchlist();
      setAdding(false);
    }
  }

  return (
    <section className="panel saved-screeners-panel">
      <div className="panel-heading">
        <div>
          <h2>我的选股方案</h2>
          <span className="panel-caption">
            保存已应用条件 · 每个账号最多 20 个 · 运行从第一页开始
          </span>
        </div>
        <Button icon={<SaveOutlined />} onClick={() => openName("new")} disabled={busy}>
          {user ? "保存当前条件" : "登录保存方案"}
        </Button>
      </div>
      {!user ? (
        <p className="saved-screeners-hint">登录后可以保存条件、改名和更新方案。</p>
      ) : error ? (
        <div className="saved-screeners-error">
          <span>{error.message}</span>
          <Button onClick={() => mutate()}>重新加载方案</Button>
        </div>
      ) : isLoading ? (
        <Spin />
      ) : !data?.screeners.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存的选股方案" />
      ) : (
        <div className="saved-screeners-list">
          {data.screeners.map((screener) => (
            <div className="saved-screener-row" key={screener.id}>
              <strong>{screener.name}</strong>
              <div className="saved-screener-actions">
                <Button
                  onClick={() =>
                    router.replace(`/screener?${savedQuery(screener)}`, { scroll: false })
                  }
                >
                  运行
                </Button>
                <Button onClick={() => openName(screener)} disabled={busy}>
                  改名
                </Button>
                <Popconfirm
                  title="用当前已应用条件覆盖此方案？"
                  description="未应用的表单修改不会保存。"
                  onConfirm={() => change(screener, false)}
                  okText="更新"
                  cancelText="取消"
                >
                  <Button disabled={busy}>更新条件</Button>
                </Popconfirm>
                <Popconfirm
                  title="删除这个选股方案？"
                  onConfirm={() => change(screener, true)}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button danger disabled={busy}>
                    删除
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="saved-screeners-batch">
        <span>仅将当前页 {symbols.length} 只结果加入自选，已有自选会跳过。</span>
        <Popconfirm
          title={`将当前页 ${symbols.length} 只股票加入自选？`}
          description="每个账号最多 60 只，自选已满时停止添加。"
          onConfirm={addPage}
          okText="加入自选"
          cancelText="取消"
          disabled={!symbols.length || adding}
        >
          <Button icon={<StarOutlined />} disabled={!symbols.length} loading={adding}>
            本页批量加入自选
          </Button>
        </Popconfirm>
      </div>
      <Modal
        title={editing === "new" ? "保存选股方案" : "修改方案名称"}
        open={editing !== null}
        onCancel={() => !busy && setEditing(null)}
        onOk={saveName}
        okText="保存"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: !name.trim() }}
      >
        <p className="saved-screeners-hint">
          {editing === "new"
            ? "保存当前已应用的筛选条件，不包含分页和未应用的表单编辑。"
            : "改名不改变已保存的条件。"}
        </p>
        <Input
          aria-label="选股方案名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="例如：低估值观察"
          onPressEnter={saveName}
        />
      </Modal>
    </section>
  );
}

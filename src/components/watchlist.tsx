"use client";

import Link from "next/link";
import { Button, App, Input, Modal, Popconfirm, Select, Tag } from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { fetchJson, useMarketData } from "@/lib/api";
import { useWatchlist } from "@/lib/use-watchlist";
import { useApp } from "./providers";
import type { Quote } from "@/lib/types";
import { StockSearch } from "./search";
import { StockTable } from "./stock-table";
import { DataError, DataMeta, DataSkeleton, NoData } from "./data-state";
import { StockResearch, useResearchWorkspace } from "./stock-research";
import type { ResearchGroup, ResearchWorkspace } from "@/lib/research-types";

/** 自选页面只请求账号持有的股票代码，缓存按账号切换时重新验证。 */
export function Watchlist() {
  const { user } = useApp();
  return <WatchlistContent key={user?.id || "anonymous"} />;
}
/** 账号切换时重建局部筛选和编辑状态，避免带入上一账号输入。 */
function WatchlistContent() {
  const { user } = useApp();
  const { data: watch, error: watchError, mutate: refreshWatch } = useWatchlist(user?.id);
  const { data, error, isLoading, isValidating, mutate } = useMarketData<Quote[]>(
    watch?.symbols.length ? `/api/market/quotes?symbols=${watch.symbols.join(",")}` : null,
  );
  const { message } = App.useApp();
  const {
    data: research,
    error: researchError,
    mutate: refreshResearch,
  } = useResearchWorkspace(user?.id);
  const [groupFilter, setGroupFilter] = useState("all");
  const [groupModal, setGroupModal] = useState<ResearchGroup | "new" | null>(null);
  const [groupName, setGroupName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const entries = new Map(research?.entries.map((entry) => [entry.symbol, entry]));
  const orderedSymbols = [...(watch?.symbols || [])].sort(
    (a, b) => (entries.get(a)?.position ?? 10000) - (entries.get(b)?.position ?? 10000),
  );
  const visibleSymbols = orderedSymbols.filter(
    (symbol) =>
      groupFilter === "all" ||
      (groupFilter === "none"
        ? !entries.get(symbol)?.groupId
        : entries.get(symbol)?.groupId === groupFilter),
  );
  const rows =
    visibleSymbols.flatMap((symbol) => data?.data.filter((row) => row.symbol === symbol) || []) ||
    [];
  /** 统一保存分组与排序，更新账号隔离的研究缓存。 */
  async function writeResearch(
    method: "POST" | "PATCH" | "DELETE",
    input: Record<string, unknown>,
  ) {
    setSaving(true);
    try {
      const result = await fetchJson<ResearchWorkspace>("/api/research", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await refreshResearch(result, false);
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
      return false;
    } finally {
      setSaving(false);
    }
  }
  /** 创建或改名后关闭输入弹窗，重复名称由服务端拒绝。 */
  async function saveGroup() {
    if (!groupName.trim()) {
      message.info("请输入分组名称");
      return;
    }
    const updated = await writeResearch(groupModal === "new" ? "POST" : "PATCH", {
      action: "group",
      name: groupName.trim(),
      ...(groupModal && groupModal !== "new" ? { id: groupModal.id } : {}),
    });
    if (updated) {
      setGroupModal(null);
      message.success("分组已保存");
    }
  }
  /** 删除分组后回到全部自选，原有笔记和收藏继续保留。 */
  async function removeGroup(id: string) {
    if (await writeResearch("DELETE", { action: "group", id })) {
      setGroupFilter("all");
      message.success("分组已删除，研究记录保留");
    }
  }
  /** 与当前筛选结果中的相邻股票交换位置，提交时携带全量成员。 */
  async function move(symbol: string, step: -1 | 1) {
    const index = visibleSymbols.indexOf(symbol);
    const neighbor = visibleSymbols[index + step];
    if (!neighbor) return;
    const next = [...orderedSymbols];
    const left = next.indexOf(symbol),
      right = next.indexOf(neighbor);
    [next[left], next[right]] = [next[right], next[left]];
    await writeResearch("PATCH", { action: "order", symbols: next });
  }
  /** CSV 来自当前真实行情；股票名称加引号并防止电子表格公式注入。 */
  function exportCsv() {
    if (!rows.length) {
      message.info("暂无可导出的自选行情");
      return;
    }
    const safe = (value: unknown) =>
      `"${String(value ?? "")
        .replace(/^[=+\-@]/, "'$&")
        .replace(/"/g, '""')}"`;
    const csv = [
      "代码,名称,最新价,涨跌幅(%),成交量(股),成交额(元),行情时间",
      ...rows.map((row) =>
        [
          row.symbol,
          row.name,
          row.price,
          row.changePercent,
          row.volume,
          row.amount,
          `${row.date} ${row.time}`,
        ]
          .map(safe)
          .join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "观澜-自选行情.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WATCHLIST</div>
          <h1>
            我的自选<span className="count-badge">{watch?.symbols.length || 0}</span>
          </h1>
          <p>关注的公司，在这里与你保持同步。</p>
        </div>
        <div className="heading-buttons">
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>
            导出行情
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={isValidating}
            onClick={() => {
              refreshWatch();
              mutate();
            }}
          >
            刷新
          </Button>
        </div>
      </div>
      <div className="watchlist-search panel">
        <div>
          <h2>下一家值得关注的公司</h2>
          <p>搜索股票，在详情页点击「加入自选」。</p>
        </div>
        <StockSearch large />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>关注计划</h2>
          <span className="panel-caption">分组、标签、笔记与手动排序</span>
        </div>
        <div className="research-tools">
          <Select
            aria-label="筛选自选分组"
            value={groupFilter}
            onChange={setGroupFilter}
            options={[
              { label: "全部分组", value: "all" },
              { label: "未分组", value: "none" },
              ...(research?.groups.map((group) => ({ label: group.name, value: group.id })) || []),
            ]}
          />
          <Button
            aria-label="新建分组"
            icon={<PlusOutlined />}
            disabled={!research || saving}
            onClick={() => {
              setGroupName("");
              setGroupModal("new");
            }}
          >
            新建分组
          </Button>
          <span className="panel-caption">移出自选后，研究笔记仍可在股票详情查看。</span>
        </div>
        {!!research?.groups.length && (
          <div className="research-groups">
            {research.groups.map((group) => (
              <div className="research-group-chip" key={group.id}>
                <span>{group.name}</span>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  aria-label={`重命名分组 ${group.name}`}
                  disabled={saving}
                  onClick={() => {
                    setGroupName(group.name);
                    setGroupModal(group);
                  }}
                />
                <Popconfirm
                  title={`删除分组「${group.name}」？`}
                  description="只移除分组，保留笔记和自选。"
                  onConfirm={() => removeGroup(group.id)}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    disabled={saving}
                    icon={<DeleteOutlined />}
                    aria-label={`删除分组 ${group.name}`}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
        {researchError ? (
          <DataError error={researchError} retry={refreshResearch} />
        ) : !research ? (
          <DataSkeleton />
        ) : !visibleSymbols.length ? (
          <NoData text="当前分组没有自选股票" />
        ) : (
          <div className="research-plans">
            {visibleSymbols.map((symbol, index) => {
              const entry = entries.get(symbol);
              const group = research.groups.find((item) => item.id === entry?.groupId);
              return (
                <div className="research-plan" key={symbol}>
                  <Link href={`/stock/${symbol}`} className="research-plan-code">
                    {symbol}
                  </Link>
                  <div className="research-plan-content">
                    <div className="research-plan-meta">
                      <Tag>{group?.name || "未分组"}</Tag>
                      {entry?.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                      {entry?.reviewDate && (
                        <span className="panel-caption">复查：{entry.reviewDate}</span>
                      )}
                    </div>
                    <p>{entry?.note || "尚未记录关注理由"}</p>
                  </div>
                  <div className="research-plan-actions">
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      aria-label={`上移 ${symbol}`}
                      disabled={saving || index === 0}
                      onClick={() => move(symbol, -1)}
                    />
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      aria-label={`下移 ${symbol}`}
                      disabled={saving || index === visibleSymbols.length - 1}
                      onClick={() => move(symbol, 1)}
                    />
                    <Button
                      size="small"
                      onClick={() => setEditing(symbol)}
                      aria-label={`编辑研究 ${symbol}`}
                    >
                      编辑研究
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-heading">
          <h2>自选行情</h2>
          <span className="panel-caption">红涨绿跌 · 每个账号独立保存</span>
        </div>
        {watchError ? (
          <DataError error={watchError} retry={refreshWatch} />
        ) : !watch ? (
          <DataSkeleton />
        ) : watch.symbols.length === 0 ? (
          <NoData text="自选列表还是空的，搜索你关注的第一只股票吧" />
        ) : !visibleSymbols.length ? (
          <NoData text="当前分组没有自选股票" />
        ) : error ? (
          <DataError error={error} retry={mutate} />
        ) : (
          <StockTable rows={rows} loading={isLoading} sortLocal />
        )}
        <DataMeta
          meta={data?.meta}
          date={data?.data[0] ? `${data.data[0].date} ${data.data[0].time}` : undefined}
        />
      </section>
      <Modal
        title={groupModal === "new" ? "新建自选分组" : "重命名自选分组"}
        open={!!groupModal}
        onCancel={() => setGroupModal(null)}
        onOk={saveGroup}
        confirmLoading={saving}
        okText="保存分组"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          aria-label="分组名称"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          maxLength={24}
          placeholder="例如：长期关注、观察中"
          onPressEnter={saveGroup}
        />
      </Modal>
      <Modal
        title={`编辑研究 · ${editing || ""}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
        width={640}
        className="research-editor-modal"
      >
        {editing && <StockResearch symbol={editing} />}
      </Modal>
    </>
  );
}

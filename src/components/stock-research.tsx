"use client";

import Link from "next/link";
import { App, Button, Form, Input, Popconfirm, Select, Space } from "antd";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetchJson } from "@/lib/api";
import type { ResearchEntry, ResearchWorkspace } from "@/lib/research-types";
import { useApp } from "./providers";
import { DataError, DataSkeleton } from "./data-state";
import "./research-workspace.css";

/** 私人研究表单字段；排序由自选工作台管理。 */
interface ResearchFormValues {
  /** 所属账号分组，未选择时为空。 */
  groupId: string | null;
  /** 研究理由与待验证问题。 */
  note: string;
  /** 用户标签列表。 */
  tags: string[];
  /** 原生日期输入值，未设置时为空字符串。 */
  reviewDate: string;
}

/** 按账号隔离缓存；股票详情与自选弹窗共享保存结果。 */
export function useResearchWorkspace(userId?: string) {
  return useSWR<ResearchWorkspace>(
    userId ? ["/api/research", userId] : null,
    ([url]: [string, string]) => fetchJson(url),
    { revalidateOnFocus: false },
  );
}

/** 为当前证券提供私人笔记；账号切换时重建表单以清除前一账号输入。 */
export function StockResearch({
  symbol,
}: {
  /** 当前详情页或编辑弹窗对应的证券代码。 */
  symbol: string;
}) {
  const { user } = useApp();
  return (
    <section className="panel stock-research" aria-label="研究笔记">
      <div className="panel-heading">
        <h2>研究笔记</h2>
        <span className="panel-caption">仅当前账号可见</span>
      </div>
      {user ? (
        <ResearchForm key={`${user.id}:${symbol}`} symbol={symbol} userId={user.id} />
      ) : (
        <p className="research-login">
          <Link className="text-link" href="/login">
            登录账号
          </Link>
          后记录关注理由、标签与复查日期。
        </p>
      )}
    </section>
  );
}

/** 从已保存记录初始化表单，保存不改变自选收藏关系。 */
function ResearchForm({
  symbol,
  userId,
}: {
  /** 证券代码。 */
  symbol: string;
  /** 当前会话账号编号，仅用于隔离前端缓存。 */
  userId: string;
}) {
  const { data, error, mutate } = useResearchWorkspace(userId);
  const [form] = Form.useForm<ResearchFormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const entry = data?.entries.find((row) => row.symbol === symbol);
  useEffect(() => {
    // 缓存重新验证期间不得覆盖用户已经开始编辑的字段。
    if (!data || form.isFieldsTouched()) return;
    form.setFieldsValue({
      groupId: entry?.groupId ?? null,
      note: entry?.note || "",
      tags: entry?.tags || [],
      reviewDate: entry?.reviewDate || "",
    });
  }, [data, entry, form]);

  /** 使用同源 API 保存受限字段，服务端会重新校验分组归属。 */
  async function save(values: ResearchFormValues) {
    setSaving(true);
    try {
      const next: ResearchEntry = {
        ...values,
        symbol,
        groupId: values.groupId || null,
        reviewDate: values.reviewDate || "",
        note: values.note || "",
        tags: values.tags || [],
        position: entry?.position ?? 10000,
      };
      const result = await fetchJson<ResearchWorkspace>("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "entry", ...next }),
      });
      await mutate(result, false);
      message.success("研究笔记已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  /** 清除研究内容时需要二次点击确认，收藏状态保持不变。 */
  async function clear() {
    setSaving(true);
    try {
      const result = await fetchJson<ResearchWorkspace>("/api/research", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "entry", symbol }),
      });
      await mutate(result, false);
      form.setFieldsValue({ groupId: null, note: "", tags: [], reviewDate: "" });
      message.success("研究记录已清除");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清除失败");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <DataError error={error} retry={mutate} />;
  if (!data) return <DataSkeleton />;
  return (
    <Form form={form} layout="vertical" onFinish={save} className="research-form" disabled={saving}>
      <div className="research-form-grid">
        <Form.Item name="groupId" label="自选分组">
          <Select
            allowClear
            placeholder="未分组"
            options={data.groups.map((group) => ({ label: group.name, value: group.id }))}
          />
        </Form.Item>
        <Form.Item name="reviewDate" label="复查日期">
          <Input type="date" min="1900-01-01" max="2100-12-31" />
        </Form.Item>
      </div>
      <Form.Item
        name="tags"
        label="研究标签"
        rules={[
          {
            validator: async (_, value: string[] | undefined) => {
              if (
                (value?.length || 0) > 8 ||
                value?.some((tag) => tag.trim().length < 1 || tag.trim().length > 16)
              )
                throw new Error("最多 8 个标签，每个标签 1 至 16 字");
            },
          },
        ]}
      >
        <Select
          mode="tags"
          placeholder="输入标签后按回车"
          tokenSeparators={[",", "，"]}
          maxTagCount="responsive"
        />
      </Form.Item>
      <Form.Item
        name="note"
        label="关注理由与待验证问题"
        rules={[{ max: 1500, message: "研究笔记最多 1500 字" }]}
      >
        <Input.TextArea
          rows={5}
          maxLength={1500}
          showCount
          placeholder="记录为什么关注，以及下一次需要验证什么。"
        />
      </Form.Item>
      <Space wrap>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存研究笔记
        </Button>
        {entry && (
          <Popconfirm
            title="清除该股票的研究内容？"
            description="自选收藏会保留。"
            onConfirm={clear}
            okText="清除"
            cancelText="取消"
          >
            <Button danger disabled={saving}>
              清除记录
            </Button>
          </Popconfirm>
        )}
        <span className="panel-caption">分组可在我的自选中管理</span>
      </Space>
    </Form>
  );
}

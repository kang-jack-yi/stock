"use client";

import { useState } from "react";
import { Alert, App, Button, Modal, Select, Table, Tag } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { fetchJson } from "@/lib/api";
import {
  defaultPortfolioColumns,
  parsePortfolioCsv,
  portfolioImportFields,
  portfolioKindLabels,
} from "@/lib/portfolio-import";
import type {
  PortfolioColumnMap,
  PortfolioCsv,
  PortfolioImportPreview,
} from "@/lib/portfolio-import";
import { number } from "@/lib/format";
import "./portfolio-tools.css";

/** 当前账号账本导入工作流；父工作台以账号 key 重建，草稿不会跨账号保留。 */
export function PortfolioImport({
  onImported,
}: {
  /** 成功提交后刷新当前账号账本。 */ onImported: () => Promise<unknown>;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [text, setText] = useState(""),
    [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState<PortfolioCsv | null>(null),
    [columns, setColumns] = useState<PortfolioColumnMap | null>(null),
    [preview, setPreview] = useState<PortfolioImportPreview | null>(null);
  /** 下载本账号导出或空模板，由服务端执行账号及公式安全校验。 */
  async function download(template: boolean) {
    try {
      const response = await fetch(`/api/portfolio/export${template ? "?template=1" : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "导出失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `账本${template ? "模板" : "备份"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  /** 读取 UTF-8 文件，先本地限制再由服务端重新验证，切换文件清空旧预览。 */
  async function load(file: File) {
    setPreview(null);
    setCsv(null);
    setColumns(null);
    setText("");
    setFileName("");
    try {
      if (file.size > 1024 * 1024) throw new Error("CSV 文件不能超过 1 MB");
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error("文件编码不是 UTF-8，请另存为 UTF-8 CSV 后重新选择");
      }
      const parsed = parsePortfolioCsv(content);
      setText(content);
      setCsv(parsed);
      setColumns(defaultPortfolioColumns(parsed.headers));
      setFileName(file.name);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  /** 预览不写入，确认重新校验版本和整批回放；失败时保留文件便于修正。 */
  async function submit(commit: boolean) {
    if (!columns) return;
    setBusy(true);
    try {
      if (commit) {
        const result = await fetchJson<{
          /** 本批次新增并已提交的账本记录数，单位条。 */
          added: number;
          /** 已有同来源且内容一致，未再次入账的记录数，单位条。 */
          skipped: number;
        }>("/api/portfolio/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csv: text,
            columns,
            action: "commit",
            version: preview?.version,
          }),
        });
        await onImported();
        message.success(`已导入 ${result.added} 条，跳过 ${result.skipped} 条已导入记录`);
        setPreview(null);
        setOpen(false);
      } else {
        const result = await fetchJson<PortfolioImportPreview>("/api/portfolio/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: text, columns, action: "preview" }),
        });
        setPreview(result);
      }
    } catch (error) {
      setPreview(null);
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>
        批量导入
      </Button>
      <Button icon={<DownloadOutlined />} onClick={() => download(false)}>
        导出账本
      </Button>
      <Modal
        title="CSV 批量导入账本"
        open={open}
        onCancel={() => !busy && setOpen(false)}
        width={960}
        footer={null}
        closable={!busy}
        mask={{ closable: !busy }}
      >
        <div className="portfolio-import-content">
          <Alert
            showIcon
            type="info"
            title="先映射列并预览，确认后整批入账"
            description="UTF-8 CSV，最多 1 MB / 1000 条。同日按文件顺序新增。只填对应种类需要的字段；空数值为零。唯一记录编号用于跨文件防重；未提供编号时按整批内容与行顺序识别。独立但内容相同的批次请填写不同编号。已有同日记录先于新增记录。"
          />
          <div className="portfolio-actions portfolio-tool-actions">
            <Button onClick={() => download(true)}>下载空模板</Button>
            <label className="portfolio-file-label">
              选择 CSV 文件
              <input
                aria-label="选择 CSV 文件"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void load(file);
                  event.target.value = "";
                }}
              />
            </label>
            {fileName && (
              <span className="portfolio-file-name">
                {fileName} · {csv?.rows.length} 条
              </span>
            )}
          </div>
          {csv && columns && (
            <>
              <div className="portfolio-column-map">
                {portfolioImportFields.map(({ key, label }) => (
                  <label key={key}>
                    {label}
                    <Select
                      aria-label={`映射${label}`}
                      value={columns[key] ?? -1}
                      disabled={busy}
                      options={[
                        { value: -1, label: "不导入" },
                        ...csv.headers.map((header, index) => ({
                          value: index,
                          label: `第 ${index + 1} 列：${header}`,
                        })),
                      ]}
                      onChange={(value) => {
                        setColumns({ ...columns, [key]: value < 0 ? null : value });
                        setPreview(null);
                      }}
                    />
                  </label>
                ))}
              </div>
              <Button loading={busy} onClick={() => submit(false)}>
                验证并预览
              </Button>
            </>
          )}
          {preview && (
            <>
              <Alert
                type={preview.error ? "error" : "success"}
                showIcon
                title={
                  preview.error ||
                  `完整回放通过：新增 ${preview.added} 条，已导入 ${preview.skipped} 条`
                }
                description="预览不会写入账本。所有错误行须修正；确认时再次校验，失败不会部分导入。"
              />
              <Table
                rowKey="ordinal"
                scroll={{ x: 1000 }}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                dataSource={preview.rows}
                columns={[
                  { title: "数据行", dataIndex: "ordinal", width: 75 },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (status) => (
                      <Tag
                        color={
                          status === "error" ? "error" : status === "new" ? "success" : "default"
                        }
                      >
                        {status === "error" ? "错误" : status === "new" ? "新增" : "已导入"}
                      </Tag>
                    ),
                  },
                  { title: "日期", render: (_, row) => row.record?.date || "—" },
                  {
                    title: "类型",
                    render: (_, row) => (row.record ? portfolioKindLabels[row.record.kind] : "—"),
                  },
                  { title: "股票", render: (_, row) => row.record?.symbol || "—" },
                  { title: "股数", render: (_, row) => number(row.record?.quantity, 0) },
                  {
                    title: "单价 / 现金金额",
                    render: (_, row) =>
                      `${number(row.record?.price)} / ${number(row.record?.amount)}`,
                  },
                  {
                    title: "错误说明",
                    dataIndex: "error",
                    width: 300,
                    render: (value) => value || "—",
                  },
                ]}
              />
              <Button
                type="primary"
                loading={busy}
                disabled={!!preview.error || !preview.added}
                onClick={() => submit(true)}
              >
                确认导入 {preview.added} 条
              </Button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

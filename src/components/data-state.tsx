"use client";

import { Alert, Button, Empty, Skeleton } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ApiMeta } from "@/lib/types";

/** 数据失败时提供局部重试，避免单个模块故障阻塞整个页面。 */
export function DataError({ error, retry }: { error: Error; retry: () => unknown }) {
  return (
    <div className="data-error">
      <Alert title="数据暂不可用" description={error.message} type="warning" showIcon />
      <Button icon={<ReloadOutlined />} onClick={() => retry()}>
        重新加载
      </Button>
    </div>
  );
}
/** 骨架占据与数据相近的空间，减少首屏加载时的布局跳动。 */
export function DataSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="data-skeleton">
      <Skeleton active paragraph={{ rows }} />
    </div>
  );
}
/** 空数据不显示为零值，保留上游缺少数据的真实状态。 */
export function NoData({ text = "暂无数据" }: { text?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}
/** 展示实际数据日期与缓存降级提示，不在界面展示提供方名称。 */
export function DataMeta({ meta, date }: { meta?: ApiMeta; date?: string }) {
  if (!meta || (!meta.stale && !date)) return null;
  return (
    <div className="data-meta">
      {meta.stale && <span className="stale">{meta.warning}</span>}
      {date && <span>数据时间 {date}</span>}
    </div>
  );
}

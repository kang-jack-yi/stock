"use client";
import { Button, Result } from "antd";
/** Next.js 错误边界只展示可恢复信息，不泄漏服务端错误详情。 */
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Result
      status="warning"
      title="页面暂时无法加载"
      subTitle="请稍后重试，或返回市场总览。"
      extra={
        <Button type="primary" onClick={reset}>
          重新加载
        </Button>
      }
    />
  );
}

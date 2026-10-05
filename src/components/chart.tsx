"use client";

import { useEffect, useRef } from "react";
import type { EChartsCoreOption, EChartsType } from "echarts/core";

/** 延迟加载 ECharts，ResizeObserver 处理容器变化，卸载时释放 canvas。 */
export function Chart({
  option,
  label,
  height = 340,
}: {
  option: EChartsCoreOption;
  label: string;
  height?: number;
}) {
  const element = useRef<HTMLDivElement>(null),
    instance = useRef<EChartsType | null>(null),
    latest = useRef(option);
  useEffect(() => {
    latest.current = option;
    instance.current?.setOption(option, { replaceMerge: ["series"] });
  }, [option]);
  useEffect(() => {
    let disposed = false;
    const observer = new ResizeObserver(() => instance.current?.resize());
    import("@/lib/charts").then(({ echarts }) => {
      if (disposed || !element.current) return;
      instance.current = echarts.init(element.current);
      instance.current.setOption(latest.current);
      observer.observe(element.current);
    });
    return () => {
      disposed = true;
      observer.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);
  return (
    <div
      ref={element}
      className="chart-container"
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}

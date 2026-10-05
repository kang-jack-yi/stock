/** Canvas 图表不能直接继承 CSS 色变量，集中映射到与界面相同的语义色。 */
export interface ChartColors {
  /** 坐标和图例次级文字。 */
  muted: string;
  /** 网格和浮层边框。 */
  grid: string;
  /** 浮层主体文字。 */
  text: string;
  /** tooltip 背景表面。 */
  surface: string;
  /** 主走势与第一条比较曲线。 */
  blue: string;
  /** 均价或第二条曲线。 */
  amber: string;
  /** 第三条曲线。 */
  violet: string;
  /** 国内市场上涨/买入方向的红色。 */
  up: string;
  /** 国内市场下跌/卖出方向的绿色。 */
  down: string;
}

/** 与双主题 CSS 一致，暗色采用更亮的文字和曲线以保留对比。 */
export function chartColors(mode: "light" | "dark"): ChartColors {
  return mode === "dark"
    ? {
        muted: "#b0b2bc",
        grid: "#3a3b41",
        text: "#f1f2f5",
        surface: "#232428",
        blue: "#95b7ff",
        amber: "#e1b875",
        violet: "#c9a5f2",
        up: "#ff909a",
        down: "#75d5b1",
      }
    : {
        muted: "#63666e",
        grid: "#e6e7eb",
        text: "#202124",
        surface: "#fff",
        blue: "#225dd9",
        amber: "#9a661e",
        violet: "#864fc2",
        up: "#bb3040",
        down: "#087453",
      };
}

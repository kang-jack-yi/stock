import "server-only";
import { db } from "./db";
import { defaultPortfolioRisk, validatePortfolioRisk } from "./portfolio-risk";
import type { PortfolioRiskSettings } from "./portfolio-risk";
/** 读取当前账号目标；没有设置时不替用户推断上限或目标。 */
export function getPortfolioRisk(userId: string): PortfolioRiskSettings {
  const row = db()
    .prepare("SELECT payload FROM portfolio_risk_settings WHERE user_id=?")
    .get(userId) as
    | {
        /** 当前账号已验证风险设置的 JSON，比例沿用百分比数值口径。 */
        payload: string;
      }
    | undefined;
  return row
    ? (JSON.parse(row.payload) as PortfolioRiskSettings)
    : { ...defaultPortfolioRisk, targets: [] };
}
/** 完整验证后仅更新会话账号，保存用户设置而不是交易指令。 */
export function savePortfolioRisk(userId: string, settings: PortfolioRiskSettings) {
  validatePortfolioRisk(settings);
  db()
    .prepare(
      "INSERT INTO portfolio_risk_settings(user_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
    )
    .run(userId, JSON.stringify(settings), Date.now());
}

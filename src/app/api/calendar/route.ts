import { tradingSession, calendarSource } from "@/lib/trading-calendar";
import { NextResponse } from "next/server";
/** GET /api/calendar：当前交易所状态，不把休市行情解释为实时行情。 */
export function GET() {
  return NextResponse.json(
    { ...tradingSession(), source: calendarSource },
    { headers: { "Cache-Control": "no-store" } },
  );
}

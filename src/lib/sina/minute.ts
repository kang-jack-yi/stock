import type { MinuteDay, MinutePoint } from "../types";

// Sina's KLC minute stream uses least-significant-bit-first six-bit characters.
// Only minute format 136 is decoded here; other formats fail explicitly.
// Format reference: finance.sina.com.cn/sinafinancesdk/js/datas/t.js and sf_sdk.js.
/** 解码新浪 KLC 136 分时压缩流，恢复实际交易日、价格、均价和分钟成交量。 */
export function decodeMinute(encoded: string): MinuteDay {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const words = Array.from(encoded, (c) => alphabet.indexOf(c));
  if (words.some((w) => w < 0)) throw new Error("分时数据编码异常");
  let position = 0;
  /** 按低位优先读取指定位宽；支持有符号差分与大于 32 位的指数成交量。 */
  function read(bits: number, signed = false) {
    // 指数成交量可超过 32 位，使用 JS 安全整数范围内的算术读取。
    if (bits < 0 || bits > 52 || position + bits > words.length * 6)
      throw new Error("分时数据格式异常");
    let result = 0;
    for (let i = 0; i < bits; i++, position++)
      result += ((words[Math.floor(position / 6)] >> (position % 6)) & 1) * 2 ** i;
    return signed && bits > 0 && result >= 2 ** (bits - 1) ? result - 2 ** bits : result;
  }
  /** 读取一个标志位。 */
  function bit() {
    return read(1) === 1;
  }
  /** 读取以连续标志位编码的正负位宽变化。 */
  function delta() {
    const positive = bit();
    let magnitude = 1;
    while (bit()) {
      if (++magnitude > 30) throw new Error("分时数据格式异常");
    }
    return positive ? magnitude : -magnitude;
  }
  const format = read(12),
    version = 63 ^ read(6);
  if (format !== 136 || version > 2) throw new Error("暂不支持该分时数据格式");
  let dayOffset = read(18, true) - 1;
  dayOffset++;
  if (dayOffset % 7 === 3 || dayOffset % 7 === 4) dayOffset += 5 - (dayOffset % 7);
  const date = new Date((7657 + dayOffset) * 86400000).toISOString().slice(0, 10);
  const widths = version < 1 ? [3, 3, 4, 1, 1, 1, 5] : [4, 4, 4, 1, 1, 1, 3];
  const settings = widths.map((width) => read(width));
  const lengths = { average: settings[0], price: settings[1], volume: settings[2] };
  const variable = settings[3],
    rawVolume = settings[4],
    zeroVolume = settings[5],
    precision = settings[6];
  const divisor = 10 ** precision;
  const terminal = version >= 1 ? read(3) : 2;
  const priceWidth = version >= 1 ? read(3) : 5;
  const previousClose = read(6 * priceWidth) / divisor;
  let price = previousClose * divisor,
    averageAdjustment = 0,
    totalVolume = 0,
    totalAmount = 0;
  const points: Omit<MinutePoint, "time">[] = [];
  while (
    position < words.length * 6 &&
    (Math.floor(position / 6) !== words.length - 1 || ((terminal ^ points.length) & 7) !== 0)
  ) {
    if (points.length > 250) throw new Error("分时数据记录过多");
    const changed = variable ? bit() : true;
    let volume = 0,
      priceDelta = 0,
      averageDelta: number | undefined;
    for (const field of ["volume", "price", "average"] as const) {
      if (changed && bit()) lengths[field] += delta();
      const volumeUnit = field === "volume" && rawVolume ? bit() : true;
      const value =
        read(
          3 * lengths[field] + (field === "volume" ? 7 * Number(volumeUnit) : 0),
          field !== "volume",
        ) * (volumeUnit ? 1 : 100);
      if (field === "volume") {
        volume = value;
        if (!volume && (version > 1 || points.length < 241) && (zeroVolume ? !bit() : true)) break;
      } else if (field === "price") priceDelta = value;
      else {
        averageDelta = value;
        averageAdjustment = (version < 1 ? 0 : averageAdjustment) + value;
      }
    }
    totalVolume += volume;
    price += priceDelta;
    totalAmount += volume * price;
    const currentPrice = price / divisor;
    const average =
      averageDelta === undefined
        ? (points.at(-1)?.average ?? currentPrice)
        : totalVolume
          ? (Math.floor((totalAmount * (2000 / divisor) + totalVolume) / totalVolume / 2) +
              averageAdjustment) /
            1000
          : currentPrice + averageAdjustment / 1000;
    points.push({ price: currentPrice, average, volume });
  }
  // The source includes a repeated midday slot; the official chart removes slot 120.
  points.splice(120, 1);
  const times = [
    ...Array.from({ length: 121 }, (_, i) => 570 + i),
    ...Array.from({ length: 120 }, (_, i) => 781 + i),
  ].map(
    (minutes) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
  );
  if (points.length !== times.length) throw new Error("分时数据时点数量异常");
  return { date, previousClose, points: points.map((point, i) => ({ ...point, time: times[i] })) };
}
/** 提取最近五个交易日的压缩串，按原始顺序逐日解码。 */
export function parseMinutes(text: string): MinuteDay[] {
  const value = text.match(/=\s*"([^"]*)"/)?.[1];
  if (!value) throw new Error("该股票暂无分时数据");
  return value.split(",").map(decodeMinute);
}

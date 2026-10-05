import "server-only";
import { NextResponse } from "next/server";

/** 可安全向客户端返回的业务错误，status 为 HTTP 状态码。 */
export class HttpError extends Error {
  /** 绑定用户提示和响应状态，默认表示请求参数错误。 */
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
/** 将业务或上游异常转换为统一 JSON 错误响应，并禁止浏览器缓存。 */
export function errorResponse(error: unknown, fallbackStatus = 502) {
  const status = error instanceof HttpError ? error.status : fallbackStatus;
  const message = error instanceof Error ? error.message : "服务暂不可用，请稍后重试";
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
/** 写操作必须携带匹配本站协议和域名的 Origin，阻止跨站请求伪造。 */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  let matches = false;
  try {
    // next start 的内部 Request URL 可能使用监听主机名，外部域名以 Host 为准。
    const parsed = origin ? new URL(origin) : null;
    matches =
      !!parsed &&
      parsed.host === request.headers.get("host") &&
      parsed.protocol === new URL(request.url).protocol;
  } catch {
    /* 非 URL 来源视为不可信。 */
  }
  if (!matches) throw new HttpError("请求来源不正确，请刷新页面后重试", 403);
}
/** 限制 JSON 请求体大小；空内容、非对象及非法 JSON 都返回参数错误。 */
export async function body(request: Request) {
  const text = await request.text();
  if (text.length > 4096) throw new HttpError("请求内容过长", 413);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError("请求格式不正确");
  }
}
const attempts = new Map<string, { count: number; until: number }>();
/** 按操作与邮箱在当前服务进程中限制十分钟内的登录或注册尝试。 */
export function rateLimit(key: string, limit = 8) {
  const now = Date.now();
  if (attempts.size > 1000)
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const value = attempts.get(key);
  if (!value || value.until < now) {
    attempts.set(key, { count: 1, until: now + 600000 });
    return;
  }
  if (++value.count > limit) throw new HttpError("尝试次数过多，请十分钟后重试", 429);
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, currentUser, revokeSession, SESSION_AGE, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { body, errorResponse, HttpError, rateLimit, sameOrigin } from "@/lib/http";
import type { User } from "@/lib/types";

export const runtime = "nodejs";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(24).optional(),
});
/** GET /api/auth/me：返回会话验证后的公开用户字段，不缓存账号响应。 */
export async function GET(_request: Request, context: { params: Promise<{ action: string }> }) {
  if ((await context.params).action !== "me")
    return errorResponse(new HttpError("接口不存在", 404));
  return NextResponse.json(
    { user: await currentUser() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
/** POST /api/auth/{register,login,logout}：校验来源及凭证，管理数据库会话和 HttpOnly Cookie。 */
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    sameOrigin(request);
    const { action } = await context.params;
    if (action === "logout") {
      await revokeSession();
      const response = NextResponse.json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    if (!["login", "register"].includes(action)) throw new HttpError("接口不存在", 404);
    const input = credentials.safeParse(await body(request));
    if (!input.success)
      throw new HttpError("请填写有效邮箱，密码需为 8 至 128 个字符，昵称不超过 24 个字符");
    const email = input.data.email.trim().toLowerCase();
    rateLimit(`${action}:${email}`);
    let user: User;
    if (action === "register") {
      if (!input.data.name) throw new HttpError("请填写昵称");
      if (db().prepare("SELECT id FROM users WHERE email = ?").get(email))
        throw new HttpError("该邮箱已注册，请直接登录", 409);
      const passwordHash = await hashPassword(input.data.password);
      user = { id: randomUUID(), email, name: input.data.name };
      try {
        db()
          .prepare(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(user.id, email, user.name, passwordHash, Date.now());
      } catch (error) {
        // Node SQLite 使用扩展错误编号 2067 表示唯一约束冲突，包括并发注册。
        if ((error as { errcode?: number }).errcode === 2067)
          throw new HttpError("该邮箱已注册，请直接登录", 409);
        throw error;
      }
    } else {
      const record = db()
        .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
        .get(email) as (User & { password_hash: string }) | undefined;
      // Keep the password verification work identical when the account does not exist.
      const dummy = "scrypt:00000000000000000000000000000000:" + "00".repeat(64);
      const valid = await verifyPassword(input.data.password, record?.password_hash || dummy);
      if (!record || !valid) throw new HttpError("邮箱或密码不正确", 401);
      user = { id: record.id, email: record.email, name: record.name };
    }
    await revokeSession();
    const token = createSession(user.id);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_AGE,
    });
    return response;
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("Authentication error", error);
    return errorResponse(
      error instanceof HttpError ? error : new HttpError("账号服务暂不可用，请稍后重试", 500),
    );
  }
}

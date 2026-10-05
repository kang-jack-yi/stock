"use client";

import Link from "next/link";
import { App, Button, Form, Input } from "antd";
import { MailOutlined, LockOutlined, UserOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./providers";
import { fetchJson } from "@/lib/api";

interface Credentials {
  /** 用于登录的邮箱地址，服务端会规范化为小写。 */
  email: string;
  /** 明文仅通过同源请求传输，服务端保存 scrypt 哈希。 */
  password: string;
  /** 注册昵称；登录时不传。 */
  name?: string;
}
/** 登录与注册共享表单校验，但各自使用独立路由和服务端操作。 */
export function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const register = mode === "register",
    router = useRouter();
  const { refreshUser } = useApp(),
    { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  /** 登录成功后只允许跳转站内路径，阻止外部重定向地址。 */
  async function submit(values: Credentials) {
    setSubmitting(true);
    try {
      await fetchJson(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      await refreshUser();
      message.success(register ? "账号已创建，欢迎来到观澜" : "登录成功");
      router.replace(
        next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
          ? next
          : "/watchlist",
      );
      router.refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="auth-form">
      <div className="eyebrow">YOUR MARKET, YOUR PERSPECTIVE</div>
      <h1>{register ? "开启你的市场视角" : "欢迎回来"}</h1>
      <p>
        {register
          ? "创建账号，让你的自选股始终与你同步。"
          : "登录账号，继续关注你看好的每一家公司。"}
      </p>
      <Form layout="vertical" onFinish={submit} requiredMark={false} size="large">
        {register && (
          <Form.Item
            name="name"
            label="昵称"
            rules={[
              { required: true, message: "请输入昵称" },
              { max: 24, message: "昵称不超过 24 个字符" },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="如何称呼你"
              autoComplete="nickname"
              maxLength={24}
            />
          </Form.Item>
        )}
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: "请输入邮箱" },
            { type: "email", message: "请输入有效邮箱" },
          ]}
        >
          <Input
            prefix={<MailOutlined />}
            placeholder="you@example.com"
            autoComplete="email"
            maxLength={254}
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[
            { required: true, message: "请输入密码" },
            { min: 8, message: "密码至少 8 个字符" },
            { max: 128, message: "密码不超过 128 个字符" },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={register ? "至少 8 个字符" : "输入你的密码"}
            autoComplete={register ? "new-password" : "current-password"}
            maxLength={128}
          />
        </Form.Item>
        <Button
          htmlType="submit"
          type="primary"
          block
          size="large"
          loading={submitting}
          icon={<ArrowRightOutlined />}
          iconPlacement="end"
        >
          {register ? "创建账号" : "登录"}
        </Button>
      </Form>
      <div className="auth-switch">
        {register ? "已有账号？" : "还没有账号？"}
        <Link href={`/${register ? "login" : "register"}?next=${encodeURIComponent(next)}`}>
          {register ? "立即登录" : "创建账号"}
        </Link>
      </div>
      <div className="auth-note">
        <LockOutlined /> 密码加密保存 · 自选股随账号同步
      </div>
    </div>
  );
}

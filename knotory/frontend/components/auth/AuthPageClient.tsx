"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { loginUser, registerUser } from "@/lib/api";
import { setAuthSession } from "@/lib/auth";

export default function AuthPageClient({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await loginUser(email.trim(), password)
          : await registerUser(email.trim(), password, displayName.trim());
      setAuthSession(res.token, res.user);
      router.replace(nextPath.startsWith("/") ? nextPath : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <p className="auth-card__eyebrow">Knotory Cloud</p>
        <h1 className="auth-card__title">{mode === "login" ? "登录" : "注册"}</h1>
        <p className="auth-card__lead">
          {mode === "login" ? "登录后你的文库与闪卡仅自己可见。" : "创建账号，独立文库与推荐流。"}
        </p>
        <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
          {mode === "register" ? (
            <label className="auth-form__field">
              <span>昵称（可选）</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
                placeholder="如何称呼你"
              />
            </label>
          ) : null}
          <label className="auth-form__field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label className="auth-form__field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              placeholder="至少 8 位"
            />
          </label>
          {error ? (
            <p className="auth-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary auth-form__submit" disabled={busy}>
            {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并进入"}
          </button>
        </form>
        <p className="auth-card__switch">
          {mode === "login" ? (
            <>
              还没有账号？ <Link href="/register">注册</Link>
            </>
          ) : (
            <>
              已有账号？ <Link href="/login">登录</Link>
            </>
          )}
        </p>
        <p className="auth-card__foot">
          <Link href="/welcome">返回首页介绍</Link>
        </p>
      </div>
    </main>
  );
}

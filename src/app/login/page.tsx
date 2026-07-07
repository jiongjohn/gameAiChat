"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `登录失败：HTTP ${response.status}`);
      }
      router.push("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="phoneStage">
      <section className="authScreen">
        <h1>登录</h1>
        <p className="authSubtitle">欢迎回来，继续你的陪伴旅程</p>
        <form className="authForm" onSubmit={submit}>
          <label>
            用户名
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="你的用户名"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="你的密码"
            />
          </label>
          {error ? <p className="authError">{error}</p> : null}
          <button type="submit" disabled={busy || !username || !password}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
        <p className="authSwitch">
          还没有账号？<a href="/register">用邀请码注册</a>
        </p>
      </section>
    </main>
  );
}

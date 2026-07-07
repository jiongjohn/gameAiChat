"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode, username, password })
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `注册失败：HTTP ${response.status}`);
      }
      router.push("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="phoneStage">
      <section className="authScreen">
        <h1>注册</h1>
        <p className="authSubtitle">输入邀请码，创建你的专属账号</p>
        <form className="authForm" onSubmit={submit}>
          <label>
            邀请码
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="管理员发放的邀请码"
            />
          </label>
          <label>
            用户名
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3-20 位字母、数字或下划线"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
            />
          </label>
          {error ? <p className="authError">{error}</p> : null}
          <button type="submit" disabled={busy || !inviteCode || !username || !password}>
            {busy ? "注册中…" : "注册并登录"}
          </button>
        </form>
        <p className="authSwitch">
          已有账号？<a href="/login">去登录</a>
        </p>
      </section>
    </main>
  );
}

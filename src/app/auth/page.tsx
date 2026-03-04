"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/dashboard");
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError("비밀번호는 6자 이상이어야 합니다.");
    if (!companyName.trim()) return setError("회사명을 입력해주세요.");
    setError("");
    setLoading(true);

    // 1. Sign up auth user (이메일 확인 없이 바로 사용)
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { email_confirmed: true } },
    });
    if (authErr) { setLoading(false); return setError(authErr.message); }
    if (!authData.user) { setLoading(false); return setError("가입 처리 중 오류가 발생했습니다."); }

    // 1-1. 이메일 미확인 시 자동 로그인 시도
    if (!authData.session) {
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (loginErr) { setLoading(false); return setError("가입은 되었으나 이메일 인증이 필요합니다. 이메일을 확인해주세요."); }
    }

    // 2. Create company
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .insert({ name: companyName.trim() })
      .select()
      .single();
    if (compErr) { setLoading(false); return setError(compErr.message); }

    // 3. Create user record
    const { error: userErr } = await supabase.from("users").insert({
      auth_id: authData.user?.id,
      company_id: company.id,
      email,
      name: email.split("@")[0],
      role: "owner",
    });
    if (userErr) { setLoading(false); return setError(userErr.message); }

    // 4. Create cash snapshot
    await supabase.from("cash_snapshot").insert({
      company_id: company.id,
      current_balance: 0,
      monthly_fixed_cost: 0,
    });

    setLoading(false);
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--primary)] text-white text-2xl font-black mb-4">
            L
          </div>
          <h1 className="text-2xl font-extrabold">LeanOS</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">딜 중심 재무·성과 관리 OS</p>
        </div>

        {/* Card */}
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8">
          {/* Tabs */}
          <div className="flex gap-1 bg-[var(--bg)] rounded-xl p-1 mb-6">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  mode === m
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                {m === "login" ? "로그인" : "회원가입"}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={mode === "login" ? handleLogin : handleSignup}>
            {mode === "signup" && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">회사명</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="(주)모티브이노베이션"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition"
                  required
                />
              </div>
            )}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ceo@company.com"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition"
                required
              />
            </div>
            <div className="mb-6">
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6자 이상"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
            >
              {loading ? "처리 중..." : mode === "login" ? "로그인" : "무료 시작하기"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-dim)] mt-6">
          Survival-grade business OS
        </p>
      </div>
    </div>
  );
}

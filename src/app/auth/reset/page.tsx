"use client";

import { useState, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function translateAuthError(msg: string): string {
  const map: [RegExp | string, string][] = [
    ["User already registered", "이미 가입된 이메일입니다."],
    ["Email not confirmed", "이메일 인증이 완료되지 않았습니다."],
    ["Invalid login credentials", "이메일 또는 비밀번호가 올바르지 않습니다."],
    ["Email rate limit exceeded", "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요."],
    ["For security purposes, you can only request this after", "보안을 위해 잠시 후 다시 시도해주세요."],
    ["Password should be at least", "비밀번호는 영문+숫자+특수기호 조합 8자 이상이어야 합니다."],
    [/over_email_send_rate_limit/i, "이메일 발송 한도를 초과했습니다. 1분 후 다시 시도해주세요."],
    [/rate_limit/i, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."],
    ["New password should be different", "새 비밀번호는 이전과 달라야 합니다."],
    ["Auth session missing", "인증 세션이 만료되었습니다. 재설정 링크를 다시 요청해주세요."],
  ];
  for (const [pattern, korean] of map) {
    if (typeof pattern === "string" ? msg.includes(pattern) : pattern.test(msg)) return korean;
  }
  if (/^[a-zA-Z\s.,!?:;()\-]+$/.test(msg)) return `오류가 발생했습니다: ${msg}`;
  return msg;
}

function getPasswordStrength(pw: string): { label: string; color: string; width: string; missing: string[] } {
  if (!pw) return { label: "", color: "", width: "0%", missing: [] };
  const missing: string[] = [];
  if (pw.length < 8) missing.push("8자 이상");
  if (!/[a-zA-Z]/.test(pw)) missing.push("영문자");
  if (!/[0-9]/.test(pw)) missing.push("숫자");
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push("특수기호");

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-zA-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 2) return { label: "약함", color: "var(--danger)", width: "33%", missing };
  if (score <= 3) return { label: "보통", color: "#f59e0b", width: "66%", missing };
  return { label: "강함", color: "var(--success, #22c55e)", width: "100%", missing };
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = searchParams.get("step");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [success, setSuccess] = useState(false);

  const isNewStep = step === "new";
  const strength = getPasswordStrength(password);

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://www.owner-view.com/auth/reset?step=new",
    });

    setLoading(false);
    if (error) return setError(translateAuthError(error.message));
    setSent(true);
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (!/[a-zA-Z]/.test(password)) return setError("비밀번호에 영문자를 포함해주세요.");
    if (!/[0-9]/.test(password)) return setError("비밀번호에 숫자를 포함해주세요.");
    if (!/[^A-Za-z0-9]/.test(password)) return setError("비밀번호에 특수기호를 포함해주세요.");
    if (password !== confirmPassword) return setError("비밀번호가 일치하지 않습니다.");

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) return setError(translateAuthError(error.message));
    setSuccess(true);
    setTimeout(() => router.push("/auth"), 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[var(--bg)]">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4">
            <svg width="56" height="56" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="#111"/>
              <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none"/>
              <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"/>
              <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="22" cy="14" r="1.5" fill="#3b82f6"/>
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">비밀번호 재설정</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            {isNewStep ? "새 비밀번호를 설정하세요" : "등록된 이메일로 재설정 링크를 보내드립니다"}
          </p>
        </div>

        {/* Card */}
        <div
          className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/20 text-[var(--danger)] text-sm">
              {error}
            </div>
          )}

          {/* Success after password update */}
          {success && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-[var(--text)] font-semibold text-lg mb-2">비밀번호가 변경되었습니다</p>
              <p className="text-[var(--text-muted)] text-sm">로그인 페이지로 이동합니다...</p>
            </div>
          )}

          {/* Email sent confirmation */}
          {sent && !isNewStep && !success && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-4">
                <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-[var(--text)] font-semibold text-lg mb-2">이메일을 확인해주세요</p>
              <p className="text-[var(--text-muted)] text-sm leading-relaxed">
                비밀번호 재설정 링크를 보냈습니다.<br />
                이메일이 도착하지 않으면 스팸 폴더를 확인해주세요.
              </p>
            </div>
          )}

          {/* Request reset form */}
          {!sent && !isNewStep && !success && (
            <form onSubmit={handleRequestReset}>
              <div className="mb-6">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">이메일</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ceo@company.com"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 shadow-sm"
              >
                {loading ? "발송 중..." : "재설정 링크 발송"}
              </button>
            </form>
          )}

          {/* New password form */}
          {isNewStep && !success && (
            <form onSubmit={handleUpdatePassword}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">새 비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문+숫자+특수기호 8자 이상"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                  required
                />
                {/* Password strength indicator */}
                {password && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-muted)]">비밀번호 강도</span>
                      <span className="text-xs font-semibold" style={{ color: strength.color }}>
                        {strength.label}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: strength.width, backgroundColor: strength.color }}
                      />
                    </div>
                    {strength.missing.length > 0 && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        필요: {strength.missing.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="mb-6">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호를 다시 입력하세요"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                  required
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-[var(--danger)] mt-1.5">비밀번호가 일치하지 않습니다</p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !password || password !== confirmPassword}
                className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 shadow-sm"
              >
                {loading ? "변경 중..." : "비밀번호 변경"}
              </button>
            </form>
          )}
        </div>

        {/* Back to login */}
        <div className="text-center mt-6">
          <Link
            href="/auth"
            className="text-sm text-[var(--primary)] hover:underline font-medium"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}

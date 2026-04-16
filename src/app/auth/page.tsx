"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { RollingBrandText } from "@/components/brand-logo";
import { createTrialingSubscription } from "@/lib/billing";
import Link from "next/link";

// Supabase 영어 에러 → 한글 변환
function translateAuthError(msg: string): string {
  const map: [RegExp | string, string][] = [
    ["User already registered", "이미 가입된 이메일입니다. 로그인을 시도해주세요."],
    ["Email not confirmed", "이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요."],
    ["Invalid login credentials", "이메일 또는 비밀번호가 올바르지 않습니다."],
    ["Email rate limit exceeded", "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요."],
    ["For security purposes, you can only request this after", "보안을 위해 잠시 후 다시 시도해주세요."],
    ["Password should be at least", "비밀번호는 영문+숫자+특수기호 조합 8자 이상이어야 합니다."],
    ["Unable to validate email address", "유효하지 않은 이메일 주소입니다."],
    ["Signups not allowed for this instance", "현재 회원가입이 비활성화되어 있습니다."],
    ["Email link is invalid or has expired", "인증 링크가 만료되었거나 유효하지 않습니다."],
    [/over_email_send_rate_limit/i, "이메일 발송 한도를 초과했습니다. 1분 후 다시 시도해주세요."],
    [/rate_limit/i, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."],
    ["Network request failed", "네트워크 연결을 확인해주세요."],
    [/fetch/i, "서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요."],
  ];
  for (const [pattern, korean] of map) {
    if (typeof pattern === "string" ? msg.includes(pattern) : pattern.test(msg)) return korean;
  }
  // 영어로만 된 메시지면 기본 안내
  if (/^[a-zA-Z\s.,!?:;()\-]+$/.test(msg)) return `오류가 발생했습니다: ${msg}`;
  return msg;
}

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showPw, setShowPw] = useState(false);
  const router = useRouter();

  // C1 Fix: redirectTo 파라미터 존중
  function getRedirectPath(): string {
    if (typeof window === "undefined") return "/dashboard";
    const params = new URLSearchParams(window.location.search);
    const redirectTo = params.get("redirectTo");
    if (redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
      return redirectTo;
    }
    return "/dashboard";
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(translateAuthError(error.message));
    router.push(getRedirectPath());
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return setError("이용약관 및 개인정보처리방침에 동의해주세요.");
    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (!/[a-zA-Z]/.test(password)) return setError("비밀번호에 영문자를 포함해주세요.");
    if (!/[0-9]/.test(password)) return setError("비밀번호에 숫자를 포함해주세요.");
    if (!/[^A-Za-z0-9]/.test(password)) return setError("비밀번호에 특수기호를 포함해주세요.");
    if (!companyName.trim()) return setError("회사명을 입력해주세요.");
    setError("");
    setLoading(true);

    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: "https://www.owner-view.com/auth/verify",
        data: {
          company_name: companyName.trim(),
          display_name: email.split("@")[0],
        },
      },
    });

    setLoading(false);

    if (authErr) return setError(translateAuthError(authErr.message));
    if (!authData.user) return setError("가입 처리 중 오류가 발생했습니다.");

    // 이메일 인증이 필요한 경우 (세션이 없음)
    if (!authData.session) {
      setEmailSent(true);
      return;
    }

    // 이메일 인증 없이 바로 세션이 생긴 경우 (Supabase 설정에 따라)
    const created = await createCompanyAndUser(authData.user.id, email, companyName.trim());
    if (created) router.push(getRedirectPath());
  }

  async function createCompanyAndUser(authId: string, userEmail: string, name: string): Promise<boolean> {
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .insert({ name })
      .select()
      .single();
    if (compErr) {
      setError("회사 정보 생성에 실패했습니다. 다시 시도해주세요.");
      return false;
    }

    const { error: userErr } = await supabase.from("users").insert({
      id: authId,
      auth_id: authId,
      company_id: company.id,
      email: userEmail,
      name: userEmail.split("@")[0],
      role: "owner",
    });
    if (userErr) {
      // C3 Fix: 사용자 생성 실패 시 고아 회사 정리
      await supabase.from("companies").delete().eq("id", company.id);
      setError("계정 설정에 실패했습니다. 다시 시도해주세요.");
      return false;
    }

    const { error: snapErr } = await supabase.from("cash_snapshot").insert({
      company_id: company.id,
      current_balance: 0,
      monthly_fixed_cost: 0,
    });
    if (snapErr) console.error("cash_snapshot 생성 실패:", snapErr.message);

    // 런칭 블로커: 신규 가입자 자동 starter 플랜 30일 trialing 구독
    await createTrialingSubscription(company.id, "starter", 30);

    return true;
  }

  async function handleResendEmail() {
    if (resendCooldown > 0) return;
    setLoading(true);

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: "https://www.owner-view.com/auth/verify",
      },
    });

    setLoading(false);
    if (error) return setError(translateAuthError(error.message));

    // 60초 쿨다운
    setResendCooldown(60);
    const timer = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  // 이메일 발송 완료 화면
  if (emailSent) {
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
          </div>

          {/* Card */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8"
            style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="text-center">
              {/* 이메일 아이콘 */}
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6"
                style={{ background: 'linear-gradient(135deg, #DBEAFE, #E0E7FF)' }}>
                <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>

              <h2 className="text-xl font-extrabold text-[var(--text)] mb-2">
                인증 메일을 보냈습니다
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-1">
                <span className="font-semibold text-[var(--text)]">{email}</span>
              </p>
              <p className="text-sm text-[var(--text-muted)] mb-6">
                메일함에서 인증 버튼을 클릭하시면 가입이 완료됩니다.
              </p>

              {/* 안내사항 */}
              <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-6 text-left">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-blue-600">1</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">메일함을 확인하세요</p>
                      <p className="text-xs text-[var(--text-muted)]">OwnerView에서 보낸 인증 메일을 찾아주세요</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-blue-600">2</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">&ldquo;이메일 인증하기&rdquo; 버튼 클릭</p>
                      <p className="text-xs text-[var(--text-muted)]">메일 본문의 파란색 인증 버튼을 눌러주세요</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-blue-600">3</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">가입 완료!</p>
                      <p className="text-xs text-[var(--text-muted)]">자동으로 OwnerView에 로그인됩니다</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 스팸 안내 */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-left">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-xs text-amber-800">
                    메일이 보이지 않으면 <span className="font-semibold">스팸/프로모션</span> 폴더를 확인해주세요.
                    Gmail의 경우 &ldquo;프로모션&rdquo; 탭에 분류될 수 있습니다.
                  </p>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/20 text-[var(--danger)] text-sm">
                  {error}
                </div>
              )}

              {/* 재발송 버튼 */}
              <button
                onClick={handleResendEmail}
                disabled={loading || resendCooldown > 0}
                className="w-full py-3 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] rounded-xl font-semibold text-sm transition border border-[var(--border)] disabled:opacity-50 mb-3"
              >
                {loading ? "발송 중..." : resendCooldown > 0 ? `${resendCooldown}초 후 재발송 가능` : "인증 메일 다시 보내기"}
              </button>

              {/* 뒤로 */}
              <button
                onClick={() => { setEmailSent(false); setError(""); }}
                className="w-full py-3 text-[var(--text-muted)] hover:text-[var(--text)] text-sm font-medium transition"
              >
                다른 이메일로 가입하기
              </button>
            </div>
          </div>

          <p className="text-center text-xs text-[var(--text-dim)] mt-6">
            대표를 위한 회사 상황판 OS
          </p>
        </div>
      </div>
    );
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
          <h1 className="text-2xl font-extrabold text-[var(--text)]"><RollingBrandText /></h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">대표를 위한 회사 상황판 OS</p>
        </div>

        {/* Card */}
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8"
          style={{ boxShadow: 'var(--shadow-lg)' }}>
          {/* Tabs */}
          <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  mode === m
                    ? "bg-[var(--primary)] text-white shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {m === "login" ? "로그인" : "회원가입"}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/20 text-[var(--danger)] text-sm">
              {error}
            </div>
          )}

          {/* OAuth 소셜 로그인 */}
          <div className="space-y-2.5 mb-5">
            <button
              type="button"
              onClick={async () => {
                setError("");
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "kakao",
                  options: { redirectTo: "https://www.owner-view.com/auth/verify" },
                });
                if (error) setError(translateAuthError(error.message));
              }}
              className="w-full flex items-center justify-center gap-2.5 py-3 bg-[#FEE500] hover:bg-[#F5DC00] text-[#191919] rounded-xl font-semibold text-sm transition shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.63 5.17l-.93 3.42c-.08.29.25.52.5.35l4.09-2.72c.24.02.47.03.71.03 4.42 0 8-2.79 8-6.25S13.42 1 9 1z" fill="#191919"/>
              </svg>
              카카오로 시작하기
            </button>
            <button
              type="button"
              onClick={async () => {
                setError("");
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo: "https://www.owner-view.com/auth/verify" },
                });
                if (error) setError(translateAuthError(error.message));
              }}
              className="w-full flex items-center justify-center gap-2.5 py-3 bg-white hover:bg-gray-50 text-gray-700 rounded-xl font-semibold text-sm transition shadow-sm border border-gray-200"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Google로 시작하기
            </button>
          </div>

          {/* 구분선 */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="text-xs text-[var(--text-dim)]">또는 이메일로</span>
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>

          <form onSubmit={mode === "login" ? handleLogin : handleSignup}>
            {mode === "signup" && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">회사명</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="(주)모티브이노베이션"
                  maxLength={50}
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
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
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                required
              />
            </div>
            <div className="mb-6">
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">비밀번호</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문+숫자+특수기호 8자 이상"
                  className="w-full px-4 py-3 pr-12 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                  required
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-xs font-medium transition">
                  {showPw ? "숨기기" : "보기"}
                </button>
              </div>
              {mode === "signup" && password && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { ok: password.length >= 8, label: "8자 이상" },
                      { ok: /[a-zA-Z]/.test(password), label: "영문" },
                      { ok: /[0-9]/.test(password), label: "숫자" },
                      { ok: /[^A-Za-z0-9]/.test(password), label: "특수기호" },
                    ].map((r) => (
                      <span key={r.label} className={`text-xs px-2 py-0.5 rounded-full ${r.ok ? "bg-green-100 text-green-700" : "bg-gray-100 text-[var(--text-muted)]"}`}>
                        {r.ok ? "\u2713" : "\u2022"} {r.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {mode === "signup" && (
              <div className="mb-4">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)]"
                  />
                  <span className="text-xs text-[var(--text-muted)] leading-relaxed">
                    <Link href="/terms" target="_blank" className="text-[var(--primary)] hover:underline">이용약관</Link>,{" "}
                    <Link href="/privacy" target="_blank" className="text-[var(--primary)] hover:underline">개인정보처리방침</Link>,{" "}
                    <Link href="/refund" target="_blank" className="text-[var(--primary)] hover:underline">환불규정</Link>에 동의합니다.
                  </span>
                </label>
              </div>
            )}
            <button
              type="submit"
              disabled={loading || (mode === "signup" && !agreed)}
              className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 shadow-sm"
            >
              {loading ? "처리 중..." : mode === "login" ? "로그인" : "무료 시작하기"}
            </button>
          </form>

          {mode === "login" && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <Link href="/auth/find-email" className="text-xs text-[var(--primary)] hover:underline">
                이메일 찾기
              </Link>
              <span className="text-xs text-[var(--text-dim)]">|</span>
              <Link href="/auth/reset" className="text-xs text-[var(--primary)] hover:underline">
                비밀번호 재설정
              </Link>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-[var(--text-dim)] mt-6">
          대표를 위한 회사 상황판 OS
        </p>
      </div>
    </div>
  );
}

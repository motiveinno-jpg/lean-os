"use client";

import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { validateInviteToken } from "@/lib/invitations";
import { RollingBrandText } from "@/components/brand-logo";

type InviteInfo = {
  type: "partner" | "employee";
  data: any;
};

export default function InvitePage() {
  return (
    <Suspense fallback={
      <div className="invite-loading-screen min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <InviteContent />
    </Suspense>
  );
}

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [validating, setValidating] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setValidating(false);
      return;
    }
    validateInviteToken(token).then((result) => {
      if (!result) {
        setInvalid(true);
      } else {
        setInvite(result);
        setEmail(result.data.email || "");
        setName(result.data.name || "");
      }
      setValidating(false);
    });
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    // 비밀번호 정책: auth/page.tsx와 동일 (8자 이상 + 영문/숫자/특수기호 조합)
    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (!/[a-zA-Z]/.test(password)) return setError("비밀번호에 영문자를 포함해주세요.");
    if (!/[0-9]/.test(password)) return setError("비밀번호에 숫자를 포함해주세요.");
    if (!/[^A-Za-z0-9]/.test(password)) return setError("비밀번호에 특수기호를 포함해주세요.");
    if (!invite) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/invite-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, token }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "가입 처리 실패");

      if (result.existingUser) {
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (loginErr) throw loginErr;
      } else {
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (loginErr) throw loginErr;
      }

      setLoading(false);
      router.push("/dashboard");
    } catch (err: any) {
      setLoading(false);
      setError(err.message || "오류가 발생했습니다.");
    }
  }

  if (validating) {
    return (
      <div className="invite-validating-screen min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-[var(--text-muted)]">초대 확인 중...</p>
        </div>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="invite-invalid-screen min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--danger-dim)] text-[var(--danger)] text-xl font-black mb-4">
            !
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--text)] mb-2">유효하지 않은 초대</h1>
          <p className="text-[var(--text-muted)] text-sm mb-6">
            초대 링크가 만료되었거나 이미 사용되었습니다.
          </p>
          <button
            onClick={() => router.push("/auth")}
            className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition"
          >
            로그인 페이지로
          </button>
        </div>
      </div>
    );
  }

  const roleLabel = invite?.type === "partner" ? "파트너" : invite?.data.role === "admin" ? "관리자" : "직원";
  const roleColor = invite?.type === "partner" ? "#7C3AED" : "#2563EB";

  return (
    <div className="invite-accept-screen min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="invite-logo text-center mb-6 md:mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl mb-3">
            <svg width="56" height="56" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="#111"/>
              <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none"/>
              <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"/>
              <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="22" cy="14" r="1.5" fill="#3b82f6"/>
            </svg>
          </div>
          <h1 className="text-xl md:text-2xl font-extrabold text-[var(--text)]"><RollingBrandText /></h1>
          <p className="text-[var(--text-muted)] text-xs md:text-sm mt-1">회사 상황판 OS</p>
        </div>

        {/* Card */}
        <div
          className="invite-accept-card glass-card p-6 md:p-8 shadow-[var(--shadow-lg)]"
        >
          {/* Invite Badge */}
          <div className="invite-badge text-center mb-6">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-white"
              style={{ background: roleColor }}
            >
              {invite?.type === "partner" ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
              )}
              {roleLabel} 초대
            </span>
            <p className="text-sm text-[var(--text-muted)] mt-3">
              <strong className="text-[var(--text)]">{invite?.data.email}</strong> 님을
              <br />
              {roleLabel}(으)로 초대합니다.
            </p>
          </div>

          {error && (
            <div role="alert" className="invite-error-banner mb-4 p-3 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/20 text-[var(--danger)] text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleAccept} className="invite-accept-form">
            <div className="mb-4">
              <label className="field-label">이름</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full px-4 py-3.5 md:py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-base md:text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
              />
            </div>
            <div className="mb-4">
              <label className="field-label">이메일</label>
              <input
                type="email"
                value={email}
                readOnly
                className="w-full px-4 py-3.5 md:py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-base md:text-sm text-[var(--text-muted)] cursor-not-allowed"
              />
            </div>
            <div className="mb-6">
              <label className="field-label">비밀번호 설정</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="영문+숫자+특수기호 8자 이상"
                className="w-full px-4 py-3.5 md:py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-base md:text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 md:py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] active:scale-[0.98] text-white rounded-xl font-semibold text-base md:text-sm transition disabled:opacity-50 shadow-sm touch-btn"
            >
              {loading ? "처리 중..." : "초대 수락 및 가입"}
            </button>
          </form>
        </div>

        <p className="invite-login-link text-center text-xs text-[var(--text-dim)] mt-6">
          이미 계정이 있으신가요?{" "}
          <button onClick={() => router.push("/auth")} className="text-[var(--primary)] hover:underline">
            로그인
          </button>
        </p>
      </div>
    </div>
  );
}

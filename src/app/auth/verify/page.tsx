"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

type VerifyState = "loading" | "success" | "already" | "error";

export default function VerifyEmailPage() {
  const [state, setState] = useState<VerifyState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [countdown, setCountdown] = useState(3);
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    let handled = false; // 이중 실행 방지

    async function handleVerification() {
      if (handled) return;
      try {
        // Supabase가 URL hash에서 토큰을 자동 처리
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          setErrorMessage(error.message);
          setState("error");
          return;
        }

        if (data.session) {
          if (handled) return;
          handled = true;
          await setupCompanyIfNeeded(data.session.user);
          setState("success");
          startRedirectCountdown();
          return;
        }

        // 세션이 아직 없으면 잠시 대기 후 재시도
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (handled) return;
        const { data: retryData, error: retryError } = await supabase.auth.getSession();

        if (retryError || !retryData.session) {
          if (!handled) {
            setErrorMessage("인증 토큰이 유효하지 않거나 만료되었습니다.");
            setState("error");
          }
        } else {
          if (!handled) {
            handled = true;
            await setupCompanyIfNeeded(retryData.session.user);
            setState("success");
            startRedirectCountdown();
          }
        }
      } catch {
        if (!handled) {
          setErrorMessage("인증 처리 중 오류가 발생했습니다.");
          setState("error");
        }
      }
    }

    function startRedirectCountdown() {
      let count = 3;
      setCountdown(count);
      timer = setInterval(() => {
        count -= 1;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(timer);
          router.push("/dashboard");
        }
      }, 1000);
    }

    // onAuthStateChange로 토큰 교환 감지
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (handled) return;
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session?.user) {
        handled = true;
        await setupCompanyIfNeeded(session.user);
        setState("success");
        startRedirectCountdown();
      }
    });

    handleVerification();

    return () => {
      subscription.unsubscribe();
      if (timer) clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 회사+유저 레코드가 없으면 생성 (signUp 시 metadata에 저장한 company_name 사용)
  async function setupCompanyIfNeeded(user: { id: string; email?: string; user_metadata?: Record<string, string> }) {
    // 이미 users 테이블에 있는지 확인
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (existingUser) return; // 이미 설정 완료

    const companyName = user.user_metadata?.company_name || user.email?.split("@")[0] || "내 회사";
    const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "사용자";
    const userEmail = user.email || "";

    // 회사 생성
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .insert({ name: companyName })
      .select()
      .single();
    if (compErr) {
      console.warn("회사 생성 실패:", compErr.message);
      return;
    }

    // 유저 레코드 생성
    await supabase.from("users").insert({
      auth_id: user.id,
      company_id: company.id,
      email: userEmail,
      name: displayName,
      role: "owner",
    });

    // 초기 현금 스냅샷
    await supabase.from("cash_snapshot").insert({
      company_id: company.id,
      current_balance: 0,
      monthly_fixed_cost: 0,
    });
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
        </div>

        {/* Card */}
        <div
          className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          {/* Loading */}
          {state === "loading" && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 mb-5">
                <svg className="animate-spin w-10 h-10 text-[var(--primary)]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <p className="text-[var(--text)] font-semibold text-lg">이메일 인증 확인 중...</p>
              <p className="text-[var(--text-muted)] text-sm mt-2">잠시만 기다려주세요</p>
            </div>
          )}

          {/* Success */}
          {state === "success" && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6"
                style={{ background: 'linear-gradient(135deg, #D1FAE5, #DCFCE7)' }}>
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-extrabold text-[var(--text)] mb-2">
                가입이 완료되었습니다!
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-6">
                환영합니다! OwnerView의 모든 기능을 이용할 수 있습니다.
              </p>
              <div className="w-full bg-[var(--bg-surface)] rounded-full h-1.5 mb-4">
                <div
                  className="bg-[var(--primary)] h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: `${((3 - countdown) / 3) * 100}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                {countdown}초 후 대시보드로 이동합니다...
              </p>
              <button
                onClick={() => router.push("/dashboard")}
                className="mt-4 w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition shadow-sm"
              >
                바로 시작하기
              </button>
            </div>
          )}

          {/* Error */}
          {state === "error" && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-50 mb-6">
                <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c-.866 1.5.217 3.374 1.948 3.374H2.697c-1.73 0-2.813-1.874-1.948-3.374L12 3.378c.866-1.5 3.032-1.5 3.898 0L21.303 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <h2 className="text-xl font-extrabold text-[var(--text)] mb-2">
                인증 링크가 만료되었습니다
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-6">
                {errorMessage || "링크가 유효하지 않거나 이미 사용되었습니다."}
              </p>
              <Link
                href="/auth"
                className="inline-flex items-center justify-center w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition shadow-sm"
              >
                다시 가입하기
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

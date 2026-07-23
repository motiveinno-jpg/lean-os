"use client";
import { logRead } from "@/lib/log-read";

// 회사 설정 단계 — 카카오/구글 소셜 가입 등 사업자번호 없이 계정만 생긴 사용자의 필수 관문.
//   이메일 가입과 동일한 규칙: 사업자번호 필수 → 형식/중복/국세청 3중 검증 →
//   미등록이면 회사 개설(+14일 트라이얼), 기등록이면 합류 요청(승인제)으로 전환.
//   public.users 가 이미 있으면(기존 회원) 대시보드로 통과.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { bizNoDigits, formatBizNo, isValidBizNo, checkBusinessNumberRegistered, submitJoinRequest, createCompanyWithOwner, assertBizNoOwnerValid } from "@/lib/company-signup";

export default function CompanySetupPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authUser, setAuthUser] = useState<{ id: string; email?: string; user_metadata?: Record<string, string> } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [bizNo, setBizNo] = useState("");
  // 대표자 인증 (2026-07-06) — 국세청 진위확인(번호+대표자성명+개업일자)으로 선점 방지
  const [ownerName, setOwnerName] = useState("");
  const [openDate, setOpenDate] = useState(""); // YYYY-MM-DD
  const [joinPrompt, setJoinPrompt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // 명시적 중복 확인 — available 전에는 회사 개설 제출 불가.
  const [bizCheck, setBizCheck] = useState<"unchecked" | "checking" | "available" | "registered" | "error">("unchecked");
  const [bizCheckedDigits, setBizCheckedDigits] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/auth"); return; }
      // 이미 회사 소속(기존 회원·승인 완료)이면 통과
      const existing = logRead('company-setup/page:existing', await supabase.from("users").select("id").eq("auth_id", user.id).maybeSingle());
      if (existing) { router.push("/dashboard"); return; }
      setAuthUser(user as any);
      setCompanyName(user.user_metadata?.company_name || "");
      setReady(true);
    })();
  }, [router]);

  // 명시적 중복 확인 — 입력이 바뀌면 이전 결과 무효화.
  const runBizCheck = async () => {
    setError("");
    setJoinPrompt(null);
    const digits = bizNoDigits(bizNo);
    if (digits.length !== 10) { setBizCheck("unchecked"); return setError("사업자번호 10자리를 입력해주세요."); }
    setBizCheck("checking");
    try {
      const dup = await checkBusinessNumberRegistered(bizNo);
      setBizCheckedDigits(digits);
      if (dup.registered) { setBizCheck("registered"); setJoinPrompt(dup.companyNameMasked || "등록된 회사"); }
      else setBizCheck("available");
    } catch (err: any) {
      setBizCheck("error");
      setError(err?.message || "사업자번호 확인 중 오류가 발생했습니다.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    if (!isValidBizNo(bizNo)) return setError("사업자번호 10자리를 입력해주세요.");
    if (bizCheck !== "available" || bizCheckedDigits !== bizNoDigits(bizNo)) {
      return setError("사업자번호 '중복 확인'을 먼저 진행해주세요.");
    }
    if (!companyName.trim()) return setError("회사명을 입력해주세요.");
    setError("");
    setLoading(true);
    try {
      // ① 제출 시점 재확인(레이스) — 확인 후 다른 사용자가 같은 번호로 회사를 만들었을 수 있음
      const dup = await checkBusinessNumberRegistered(bizNo);
      if (dup.registered) {
        setBizCheck("registered");
        setJoinPrompt(dup.companyNameMasked || "등록된 회사");
        return;
      }
      // ② 국세청 진위확인 + 상태 — 대표자성명·개업일자까지 일치해야 개설(선점 방지).
      const gate = await assertBizNoOwnerValid(bizNo, ownerName, openDate);
      if (!gate.ok) {
        return setError(gate.error || "사업자번호를 확인할 수 없습니다.");
      }
      // ③ 회사 개설 (+owner 연결, 14일 트라이얼) — 유니크 충돌 시 합류 전환
      const displayName = authUser.user_metadata?.display_name || authUser.user_metadata?.name || authUser.email?.split("@")[0] || "사용자";
      const r = await createCompanyWithOwner(authUser.id, authUser.email || "", companyName.trim(), displayName, bizNoDigits(bizNo));
      if (r.ok) { router.push("/onboarding"); return; }
      if (r.duplicate) { setJoinPrompt("등록된 회사"); return; }
      setError(r.error || "회사 생성에 실패했습니다. 다시 시도해주세요.");
    } catch (err: any) {
      setError(err?.message || "처리 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  const sendJoin = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await submitJoinRequest(bizNo, authUser?.user_metadata?.display_name || authUser?.user_metadata?.name);
      if (!r.ok) { setError(r.error || "합류 요청 전송에 실패했습니다."); return; }
      router.push("/join-pending");
    } finally { setLoading(false); }
  };

  const logout = async () => { await supabase.auth.signOut(); router.push("/auth"); };

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text-muted)]">확인 중...</div>;
  }

  return (
    <div className="company-setup-page">
      <div className="w-full max-w-md">
        <div className="company-setup-header">
          <div className="text-4xl mb-3" aria-hidden>🏢</div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">회사 정보를 설정해주세요</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1.5 leading-relaxed">
            오너뷰는 회사(사업자번호)마다 하나의 전용 공간을 사용합니다.<br />
            회사를 새로 개설하거나, 이미 등록된 회사라면 합류 요청을 보냅니다.
          </p>
        </div>

        <div className="company-setup-card glass-card">
          {error && (
            <div role="alert" className="form-error-alert">{error}</div>
          )}

          <form onSubmit={submit}>
            {/* 사업자번호 + 명시적 중복 확인 (available 전에는 회사 개설 정보 미노출) */}
            <div className="mb-4">
              <label htmlFor="setup-biz-no" className="field-label">사업자등록번호</label>
              <div className="biz-no-check-row">
                <input id="setup-biz-no" type="text" inputMode="numeric" value={bizNo}
                  onChange={(e) => { setBizNo(formatBizNo(bizNoDigits(e.target.value))); setBizCheck("unchecked"); setJoinPrompt(null); }}
                  placeholder="123-45-67890" maxLength={12}
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] mono-number biz-no-check-input focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" required />
                <button type="button" onClick={runBizCheck} disabled={bizCheck === "checking" || !isValidBizNo(bizNo)} className="biz-no-check-btn">
                  {bizCheck === "checking" ? "확인 중..." : "중복 확인"}
                </button>
              </div>
              {bizCheck === "unchecked" && (
                <p className="text-[11px] text-[var(--text-dim)] mt-1">먼저 사업자번호 중복 확인을 진행해주세요. 이미 등록된 회사면 합류 요청으로 이어집니다.</p>
              )}
              {bizCheck === "available" && (
                <p className="text-[11px] text-[var(--success)] mt-1">사용 가능한 사업자번호입니다. 아래 정보를 입력해 새 회사를 개설하세요.</p>
              )}
              {bizCheck === "error" && (
                <p className="text-[11px] text-[var(--danger)] mt-1">확인 중 오류가 발생했습니다. 다시 시도해주세요.</p>
              )}
            </div>
            {bizCheck === "available" && (
              <>
              <div className="mb-4">
                <label htmlFor="setup-company-name" className="field-label">회사명</label>
                <input id="setup-company-name" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="(주)모티브이노베이션" maxLength={50} autoComplete="organization"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" required />
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="setup-owner-name" className="field-label">대표자 성명</label>
                  <input id="setup-owner-name" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="홍길동" maxLength={30} autoComplete="name"
                    className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" required />
                </div>
                <div>
                  <label htmlFor="setup-open-date" className="field-label">개업일자</label>
                  <input id="setup-open-date" type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" required />
                  <p className="text-[11px] text-[var(--text-dim)] mt-1">사업자등록증의 개업연월일 — 국세청 대표자 인증에 사용됩니다.</p>
                </div>
              </div>
              </>
            )}

            {bizCheck === "registered" && joinPrompt && (
              <div className="join-prompt-box">
                <p className="text-sm font-semibold text-[var(--info)] mb-1">이미 오너뷰에 가입된 사업자번호입니다 — <b>{joinPrompt}</b></p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
                  회사를 새로 만들 수 없습니다. 이 회사의 대표/관리자에게 <b>가입 요청</b>을 보내고, 승인되면 가입 완료 메일을 보내드립니다.
                  (초대 링크를 받았다면 그 링크로 합류하는 것이 가장 빠릅니다)
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={sendJoin} disabled={loading}
                    className="flex-1 py-2.5 bg-[var(--info)] hover:opacity-90 text-white rounded-lg font-semibold text-xs transition disabled:opacity-50">
                    {loading ? "처리 중..." : "이 회사에 가입 요청"}
                  </button>
                  <button type="button" onClick={() => { setJoinPrompt(null); setBizNo(""); setBizCheck("unchecked"); setBizCheckedDigits(""); }}
                    className="px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--info)]/30 text-[var(--info)] rounded-lg font-semibold text-xs transition hover:bg-[var(--info-dim)]">
                    번호 다시 입력
                  </button>
                </div>
              </div>
            )}

            {bizCheck !== "registered" && (
              <button type="submit" disabled={loading || bizCheck !== "available"}
                className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 shadow-sm">
                {loading ? "확인 중..." : "회사 개설하고 시작하기 (14일 무료)"}
              </button>
            )}
          </form>

          <button onClick={logout} className="w-full mt-3 py-2.5 text-[var(--text-muted)] hover:text-[var(--text)] text-xs font-medium transition">
            다른 계정으로 로그인
          </button>
        </div>

        <p className="text-center text-xs text-[var(--text-dim)] mt-6">대표를 위한 회사 상황판 OS</p>
      </div>
    </div>
  );
}

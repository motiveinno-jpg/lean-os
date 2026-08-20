"use client";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

// 회사 설정 단계 — 카카오/구글 소셜 가입 등 사업자번호 없이 계정만 생긴 사용자의 필수 관문.
//   이메일 가입과 동일한 규칙: 사업자번호 필수 → 형식/중복/국세청 3중 검증 →
//   미등록이면 회사 개설(+14일 트라이얼), 기등록이면 합류 요청(승인제)으로 전환.
//   public.users 가 이미 있으면(기존 회원) 대시보드로 통과.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { bizNoDigits, formatBizNo, isValidBizNo, checkBusinessNumberRegistered, submitJoinRequest, createCompanyWithOwner, assertBizNoActive } from "@/lib/company-signup";
import { logError } from "@/lib/error-logger";
import { formatPhone, isValidMobile } from "@/lib/phone";

export default function CompanySetupPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authUser, setAuthUser] = useState<{ id: string; email?: string; user_metadata?: Record<string, string> } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [bizNo, setBizNo] = useState("");
  // 2026-08-05 관문 단순화(사장님 — 소셜 가입자 절반이 이 화면에서 1~2초 만에 이탈):
  //   대표자성명·개업일자 진위확인 제거(번호 상태 확인만 유지), 휴대전화는 선택으로.
  const [phone, setPhone] = useState(""); // 휴대전화(선택) — 알림톡 대상(2026-07-29). 소셜 가입자는 메타에 없어 여기서 받는다.
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
      // 이미 회사 소속(기존 회원·승인 완료)이면 통과.
      //   2026-07-28 P0: company_id 까지 확인해야 한다 — 행만 있고 회사가 NULL 인 레거시 계정을
      //   대시보드로 보내면 앱 셸 가드(getCurrentUser null → /company-setup)와 무한 리다이렉트 루프.
      const existing = logRead('company-setup/page:existing', await supabase.from("users").select("id, company_id").eq("auth_id", user.id).maybeSingle());
      if (existing?.company_id) { router.push("/dashboard"); return; }
      setAuthUser(user as any);
      setCompanyName(user.user_metadata?.company_name || "");
      setReady(true);
    })();
  }, [router]);

  // 10자리 입력 즉시 자동 중복확인 — 버튼 클릭 단계 제거(2026-08-05 관문 단순화). 버튼은 재시도용으로 유지.
  useEffect(() => {
    if (bizNoDigits(bizNo).length !== 10 || bizCheck !== "unchecked") return;
    const t = setTimeout(() => { void runBizCheck(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizNo, bizCheck]);

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
    if (!companyName.trim()) return setError("회사명을 입력해주세요.");
    // 2026-08-20 사장님 지시 — 사업자번호는 **선택**. 가입 2초 시점엔 등록증을 손에 든 사람이 거의 없어
    //   소셜 가입자의 80%가 이 칸 하나에서 사라졌다(운영 실측). 번호가 실제로 필요한 건
    //   통장·카드 수집 / 세금계산서 / 결제 뿐이라, 그 기능에 들어갈 때 그 자리에서 받는다.
    const hasBiz = bizNoDigits(bizNo).length === 10;
    if (bizNo.trim() && !hasBiz) return setError("사업자번호는 10자리로 입력하거나 비워두세요.");
    if (hasBiz && (bizCheck !== "available" || bizCheckedDigits !== bizNoDigits(bizNo))) {
      return setError("사업자번호 '중복 확인'을 먼저 진행해주세요.");
    }
    setError("");
    setLoading(true);
    try {
      if (hasBiz) {
        // ① 제출 시점 재확인(레이스) — 확인 후 다른 사용자가 같은 번호로 회사를 만들었을 수 있음
        const dup = await checkBusinessNumberRegistered(bizNo);
        if (dup.registered) {
          setBizCheck("registered");
          setJoinPrompt(dup.companyNameMasked || "등록된 회사");
          return;
        }
        // ② 국세청 상태 확인 — 번호만으로 폐업·휴업·미등록 차단 (진위확인은 관문에서 제거, 2026-08-05)
        const gate = await assertBizNoActive(bizNo);
        if (!gate.ok) {
          // 확인 실패도 로그 — 여기서 이탈하는 가입자가 얼마나 되는지 운영자가 봐야 한다(2026-07-29)
          try { logError({ source: "manual", message: `[간편가입] 국세청 확인 통과 실패: ${gate.error || "사유 미상"}`, context: { step: "nts_gate", biz: bizNoDigits(bizNo).slice(0, 3) + "-**-*****" } }); } catch { /* 무시 */ }
          return setError(gate.error || "사업자번호를 확인할 수 없습니다.");
        }
      }
      // ③ 회사 개설 (+owner 연결) — 유니크 충돌 시 합류 전환.
      //   사업자번호가 비면 createCompanyWithOwner 가 companies.business_number 를 아예 안 넣는다.
      //   유니크 인덱스가 부분 인덱스(WHERE business_number IS NOT NULL)라 빈 회사끼리는 충돌하지 않고,
      //   나중에 회사설정에서 번호를 넣는 순간 중복 검사가 정상 작동한다.
      const displayName = authUser.user_metadata?.display_name || authUser.user_metadata?.name || authUser.email?.split("@")[0] || "사용자";
      // 소셜 가입은 메타에 phone 이 없을 수 있어 이 화면에서 받은 값을 우선 사용한다.
      const phoneToSave = isValidMobile(phone) ? phone : (authUser.user_metadata?.phone || null);
      const r = await createCompanyWithOwner(authUser.id, authUser.email || "", companyName.trim(), displayName, bizNoDigits(bizNo), phoneToSave);
      if (r.ok) { router.push("/onboarding"); return; }
      if (r.duplicate) { setJoinPrompt("등록된 회사"); return; }
      setError(r.error || "회사 생성에 실패했습니다. 다시 시도해주세요.");
    } catch (err: any) {
      try { logError({ source: "manual", message: `[간편가입] 회사 개설 처리 예외: ${err?.message || err}`, context: { step: "submit_exception" } }); } catch { /* 무시 */ }
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
          <div className="text-4xl mb-3" aria-hidden><Ico e="🏢" /></div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">회사 정보를 설정해주세요</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1.5 leading-relaxed">
            회사 이름만 알려주시면 바로 시작할 수 있어요.<br />
            사업자번호는 통장·세금계산서를 쓰실 때 등록하셔도 됩니다.
          </p>
        </div>

        <div className="company-setup-card glass-card">
          {error && (
            <div role="alert" className="form-error-alert">{error}</div>
          )}

          <form onSubmit={submit}>
            {/* 2026-08-20: 회사명이 먼저 온다. 종전엔 사업자번호 칸 하나만 보였고 그걸 통과해야
                회사명이 나타나, 등록증이 없는 사람은 아무것도 못 하고 나갔다. */}
            <div className="mb-4">
              <label htmlFor="setup-company-name" className="field-label">회사명</label>
              <input id="setup-company-name" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                placeholder="(주)모티브이노베이션" maxLength={50} autoComplete="organization"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" required />
            </div>

            {/* 사업자번호 — 선택. 넣으면 지금처럼 중복·국세청 확인을 거친다. */}
            <div className="mb-4">
              <label htmlFor="setup-biz-no" className="field-label">
                사업자등록번호 <span className="text-[var(--text-dim)] font-normal">(선택 · 나중에 등록해도 됩니다)</span>
              </label>
              <div className="biz-no-check-row">
                <input id="setup-biz-no" type="text" inputMode="numeric" value={bizNo}
                  onChange={(e) => { setBizNo(formatBizNo(bizNoDigits(e.target.value))); setBizCheck("unchecked"); setJoinPrompt(null); }}
                  placeholder="123-45-67890 (비워둬도 됩니다)" maxLength={12}
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] mono-number biz-no-check-input focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" />
                <button type="button" onClick={runBizCheck} disabled={bizCheck === "checking" || !isValidBizNo(bizNo)} className="biz-no-check-btn">
                  {bizCheck === "checking" ? "확인 중..." : "중복 확인"}
                </button>
              </div>
              {bizCheck === "unchecked" && (
                <p className="text-[11px] text-[var(--text-dim)] mt-1">
                  통장·카드 자동수집, 세금계산서 발행, 결제에는 사업자번호가 필요합니다 — 그때 등록하셔도 됩니다.
                </p>
              )}
              {bizCheck === "available" && (
                <p className="text-[11px] text-[var(--success)] mt-1">사용 가능한 사업자번호입니다.</p>
              )}
              {bizCheck === "error" && (
                <p className="text-[11px] text-[var(--danger)] mt-1">확인 중 오류가 발생했습니다. 다시 시도하거나, 비워두고 시작해도 됩니다.</p>
              )}
            </div>
            {bizCheck !== "registered" && (
              <div className="mb-4">
                <label htmlFor="setup-phone" className="field-label">휴대전화 <span className="text-[var(--text-dim)] font-normal">(선택)</span></label>
                <input id="setup-phone" type="tel" inputMode="numeric" value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  placeholder="010-1234-5678" autoComplete="tel"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition" />
                {phone && !isValidMobile(phone) && (
                  <p className="text-[11px] text-[var(--danger)] mt-1">휴대전화 번호 형식이 올바르지 않습니다.</p>
                )}
                <p className="text-[11px] text-[var(--text-dim)] mt-1">결재·계약 알림을 카카오톡으로 받는 데 사용됩니다. 나중에 설정에서 입력해도 됩니다.</p>
              </div>
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
              <>
                {/* 번호를 넣었으면 확인을 통과해야 하고, 비웠으면 회사명만으로 시작할 수 있다. */}
                <button type="submit" disabled={loading || !companyName.trim() || (!!bizNo.trim() && bizCheck !== "available")}
                  className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 shadow-sm">
                  {/* 2026-08-11 무료체험 폐지(f825e35) 후에도 '(14일 무료)' 가 남아 있었다 —
                      환불규정("별도의 무료체험 기간은 제공되지 않습니다")과 정면으로 어긋나는 약속이었다. */}
                  {loading ? "확인 중..." : bizNo.trim() ? "회사 개설하고 시작하기" : "사업자번호 없이 먼저 둘러보기"}
                </button>
                {!bizNo.trim() && (
                  <p className="text-[11px] text-[var(--text-dim)] mt-2 text-center leading-relaxed">
                    결재·일정·게시판·파일보관함은 바로 쓸 수 있어요.<br />
                    통장 연결·세금계산서·결제는 사업자번호를 등록하면 열립니다.
                  </p>
                )}
              </>
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

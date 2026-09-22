"use client";

// 2단계 인증 관문 — 앱 진입 시 (2026-09-22 ERP 공백 2차 ②). ip-gate 와 같은 자리·같은 모양(전체 화면 덮개).
//   ① 켜진 계정인데 이번 세션이 아직 6자리를 안 넣었다 → 6자리 입력(맞으면 세션이 aal2 가 되어 덮개가 걷힌다).
//   ② 회사가 필수(mfa_policy)로 정했는데 대상자가 아직 안 켰다 → 등록 폼(QR·6자리). 등록을 마치면 들어간다.
//   · 판정 불가(조회 실패)면 막지 않는다(fail-open — 장애로 전 직원이 잠기지 않게, ip-gate 와 같은 원칙).
//   · 탈출구는 로그아웃뿐. 기기를 잃어버린 경우는 브라우저에서 풀 수 없다(관리 키 필요) — 고객센터로 안내.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { needsLoginVerification, loadMfaPolicy, verifyLogin, mfaErrorText } from "@/lib/mfa";
import { MfaEnrollForm } from "@/components/mfa-enroll-form";

type Mode = { kind: "verify"; factorId: string } | { kind: "enroll" } | null;

export function MfaGate() {
  const { role } = useUser();
  const { isMaster, loading: permsLoading } = useMyPermissions();
  const [mode, setMode] = useState<Mode>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (permsLoading || role === "partner") return;
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const v = await needsLoginVerification();
        if (!alive) return;
        if (v.needed && v.factorId) { setMode({ kind: "verify", factorId: v.factorId }); return; }
        if (v.needed) return;                       // 인증기 목록을 못 읽었다 — 막지 않는다
        const policy = await loadMfaPolicy();
        if (!alive) return;
        const target = policy.required_for === "all" || (policy.required_for === "masters" && isMaster);
        if (target) {
          //   nextLevel 이 aal1 이면 켜진 인증기가 없다는 뜻 — 등록부터
          const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (alive && data?.nextLevel !== "aal2") setMode({ kind: "enroll" });
        }
      } catch { /* 판정 불가 — 막지 않음 */ }
    })();
    return () => { alive = false; };
  }, [permsLoading, isMaster, role]);

  if (!mode) return null;

  const submit = async () => {
    if (mode.kind !== "verify" || busy) return;
    if (!/^\d{6}$/.test(code)) { setErr("인증 앱의 6자리 숫자를 넣어 주세요."); return; }
    setBusy(true); setErr(null);
    try { await verifyLogin(mode.factorId, code); setMode(null); }
    catch (e) { setErr(mfaErrorText(e)); setBusy(false); }
  };
  const logout = () => supabase.auth.signOut({ scope: "local" }).then(() => { window.location.href = "/auth"; });

  return (
    <div className="ip-gate-overlay" role="dialog" aria-label="2단계 인증">
      <div className="ip-gate-card glass-card mfa-gate-card">
        {mode.kind === "verify" ? (
          <>
            <div className="text-[15px] font-bold text-[var(--text)] mb-1.5">2단계 인증</div>
            <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed break-keep">휴대폰 인증 앱에 뜬 6자리 숫자를 넣어 주세요.</p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="qk-input mfa-code-input mfa-gate-input" autoFocus aria-label="인증 앱 6자리" />
            {err && <p className="mfa-err">{err}</p>}
            <p className="text-[11px] text-[var(--text-dim)] mt-2">기기를 잃어버렸다면 고객센터에 알려 주세요. 본인 확인 뒤 풀어 드립니다.</p>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={logout} className="btn-secondary btn-sm flex-1">로그아웃</button>
              <button type="button" onClick={() => void submit()} disabled={busy || code.length !== 6} className="btn-primary btn-sm flex-1">{busy ? "확인 중…" : "확인"}</button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[15px] font-bold text-[var(--text)] mb-1.5">2단계 인증을 켜 주세요</div>
            <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed break-keep">회사 보안 설정에 따라 {isMaster ? "마스터 계정" : "구성원"}은 2단계 인증이 필요합니다. 한 번만 등록하면 됩니다.</p>
            <MfaEnrollForm compact onDone={() => setMode(null)} />
            <div className="mt-3"><button type="button" onClick={logout} className="btn-secondary btn-sm w-full">로그아웃</button></div>
          </>
        )}
      </div>
    </div>
  );
}

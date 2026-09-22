"use client";

// 마이페이지 › 내 정보·설정 › 2단계 인증 카드 (2026-09-22 ERP 공백 2차 ②)
//   꺼짐: 「켜기」 → 등록 폼(QR·6자리). 켜짐: 등록일 + 「끄기」(6자리 다시 넣어야 꺼진다).
//   회사가 필수로 정했으면 끄기를 막고 이유를 적는다.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useMyPermissions } from "@/lib/permissions";
import { listVerifiedTotp, disableTotp, loadMfaPolicy, mfaErrorText } from "@/lib/mfa";
import { MfaEnrollForm } from "@/components/mfa-enroll-form";

export function MfaCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster } = useMyPermissions();
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: factors = [], isLoading, error: loadErr } = useQuery({ queryKey: ["mfa-factors"], queryFn: listVerifiedTotp, staleTime: 30_000 });
  const { data: policy } = useQuery({ queryKey: ["mfa-policy"], queryFn: loadMfaPolicy, staleTime: 60_000 });
  const on = factors.length > 0;
  const required = policy?.required_for === "all" || (policy?.required_for === "masters" && isMaster);
  useEffect(() => { if (!on) setDisabling(false); }, [on]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa-factors"] });

  const doDisable = async () => {
    if (!on || busy) return;
    if (!/^\d{6}$/.test(code)) { setErr("인증 앱의 6자리 숫자를 넣어 주세요."); return; }
    setBusy(true); setErr(null);
    try {
      await disableTotp(factors[0].id, code);
      toast("2단계 인증을 껐습니다.", "success");
      setDisabling(false); setCode(""); refresh();
    } catch (e) { setErr(mfaErrorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mfa-card glass-card">
      <div className="mfa-card-head">
        <span className={on ? "kpi-icon success" : "kpi-icon"}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
        </span>
        <div className="mfa-card-title">
          <div className="text-sm font-bold text-[var(--text)]">2단계 인증 <span className={on ? "mfa-badge mfa-badge-on" : "mfa-badge"}>{isLoading ? "확인 중" : on ? "켜짐" : "꺼짐"}</span></div>
          <div className="text-xs text-[var(--text-muted)]">비밀번호가 새어도 휴대폰 인증 앱의 6자리가 없으면 로그인할 수 없습니다. 통장·급여를 다루는 계정에 권합니다.</div>
        </div>
        {!isLoading && !enrolling && !disabling && (
          on
            ? <button type="button" className="btn-secondary btn-sm" onClick={() => { setDisabling(true); setErr(null); }} disabled={required} title={required ? "회사 설정에서 필수로 정해 끌 수 없습니다" : undefined}>끄기</button>
            : <button type="button" className="btn-primary btn-sm" onClick={() => setEnrolling(true)}>켜기</button>
        )}
      </div>
      {loadErr && <p className="mfa-err">{mfaErrorText(loadErr)}</p>}
      {on && !disabling && (
        <p className="mfa-card-note">등록일 {String(factors[0].created_at).slice(0, 10)} · 기기를 잃어버려 6자리를 넣을 수 없으면 고객센터에 알려 주세요(본인 확인 뒤 풀어 드립니다).{required && " 회사 설정에서 필수로 정해 끌 수 없습니다."}</p>
      )}
      {!on && !enrolling && required && <p className="mfa-card-note mfa-card-note-warn">회사 설정에서 필수로 정했습니다. 켜지 않으면 다음 로그인부터 등록 화면이 먼저 뜹니다.</p>}
      {enrolling && (
        <MfaEnrollForm onCancel={() => setEnrolling(false)} onDone={() => { setEnrolling(false); toast("2단계 인증을 켰습니다. 다음 로그인부터 6자리를 묻습니다.", "success"); refresh(); }} />
      )}
      {disabling && (
        <div className="mfa-disable">
          <label className="mfa-enroll-label">끄려면 인증 앱의 6자리를 넣어 주세요</label>
          <div className="mfa-disable-row">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") void doDisable(); }}
              inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="qk-input mfa-code-input" autoFocus />
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setDisabling(false); setCode(""); setErr(null); }} disabled={busy}>취소</button>
            <button type="button" className="btn-secondary btn-sm text-[var(--danger)]" onClick={() => void doDisable()} disabled={busy || code.length !== 6}>{busy ? "끄는 중…" : "2단계 인증 끄기"}</button>
          </div>
          {err && <p className="mfa-err">{err}</p>}
        </div>
      )}
    </div>
  );
}

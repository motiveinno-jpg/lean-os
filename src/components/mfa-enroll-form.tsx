"use client";

// 2단계 인증 등록 폼 — QR + 수동 키 + 6자리 확인. 마이페이지 카드와 로그인 관문(회사 강제)이 같이 쓴다 (2026-09-22).
//   흐름: 켜기 → 인증 앱(Google Authenticator·Authy·1Password 등)으로 QR 찍기 → 앱이 보여 주는 6자리 입력 → 켜짐.
//   QR 은 Supabase 가 준 svg data URI 를 그대로 <img> 로 그린다 — 라이브러리 없음.

import { useEffect, useState } from "react";
import { startEnrollment, verifyEnrollment, mfaErrorText } from "@/lib/mfa";

export function MfaEnrollForm({ onDone, onCancel, compact }: { onDone: () => void; onCancel?: () => void; compact?: boolean }) {
  const [step, setStep] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let alive = true;
    startEnrollment().then((s) => { if (alive) setStep(s); }).catch((e) => { if (alive) setErr(mfaErrorText(e)); });
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    if (!step || busy) return;
    if (!/^\d{6}$/.test(code.trim())) { setErr("인증 앱의 6자리 숫자를 넣어 주세요."); return; }
    setBusy(true); setErr(null);
    try { await verifyEnrollment(step.factorId, code); onDone(); }
    catch (e) { setErr(mfaErrorText(e)); setBusy(false); }
  };

  return (
    <div className={compact ? "mfa-enroll mfa-enroll-compact" : "mfa-enroll"}>
      {!step && !err && <div className="mfa-enroll-loading">등록 준비 중…</div>}
      {step && (
        <>
          <ol className="mfa-enroll-steps">
            <li>휴대폰에 인증 앱(Google Authenticator·Authy·1Password 등)을 엽니다.</li>
            <li>아래 QR 을 찍습니다. 찍을 수 없으면 키를 직접 입력합니다.</li>
            <li>앱이 보여 주는 6자리 숫자를 넣고 확인을 누릅니다.</li>
          </ol>
          <div className="mfa-enroll-body">
            <img src={step.qr} alt="2단계 인증 QR" className="mfa-enroll-qr" />
            <div className="mfa-enroll-side">
              <button type="button" className="mfa-enroll-secret-btn" onClick={() => setShowSecret((v) => !v)}>{showSecret ? "키 숨기기" : "QR 을 못 찍나요? 키 보기"}</button>
              {showSecret && <code className="mfa-enroll-secret">{step.secret}</code>}
              <label className="mfa-enroll-label">인증 앱의 6자리</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="qk-input mfa-code-input" autoFocus />
              <div className="mfa-enroll-actions">
                {onCancel && <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>취소</button>}
                <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy || code.length !== 6}>{busy ? "확인 중…" : "확인하고 켜기"}</button>
              </div>
            </div>
          </div>
        </>
      )}
      {err && <p className="mfa-err">{err}</p>}
    </div>
  );
}

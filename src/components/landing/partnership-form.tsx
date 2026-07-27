"use client";

// 랜딩 제휴·도입 문의 폼 (2026-07-27 실동작화).
//   이전 구현은 input 이 uncontrolled 이고 버튼이 setSent(true) 만 호출하는 더미였다 —
//   방문자에겐 "접수되었습니다" 가 뜨지만 서버로 전송되는 값이 없어 리드가 전부 유실됐다.
//   이제 /api/partnership 으로 POST → partnership_inquiries 적재 → /platform/partnership 에서 확인.

import { useState } from "react";

type Fields = { companyName: string; contactName: string; email: string; phone: string; message: string };
const EMPTY: Fields = { companyName: "", contactName: "", email: "", phone: "", message: "" };

export function PartnershipForm() {
  const [v, setV] = useState<Fields>(EMPTY);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!v.companyName.trim()) return setError("회사명을 입력해주세요.");
    if (!v.contactName.trim()) return setError("담당자명을 입력해주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return setError("올바른 이메일 주소를 입력해주세요.");
    if (v.message.trim().length < 5) return setError("문의 내용을 5자 이상 입력해주세요.");

    setBusy(true);
    try {
      const res = await fetch("/api/partnership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, website: honeypot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "접수에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "접수에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="lp4-form lp4-form-done">
        <div className="lp4-form-done-mark">✓</div>
        <div className="lp4-form-done-title">문의가 접수되었습니다</div>
        <p className="lp4-form-done-desc">영업일 기준 1일 이내에 회신드리겠습니다.</p>
      </div>
    );
  }

  return (
    <form className="lp4-form" onSubmit={submit} noValidate>
      <div className="lp4-form-grid">
        <div>
          <label className="lp4-flabel" htmlFor="pf-company">회사명 *</label>
          <input id="pf-company" className="lp4-input" placeholder="(주)회사명" value={v.companyName} onChange={set("companyName")} autoComplete="organization" required />
        </div>
        <div>
          <label className="lp4-flabel" htmlFor="pf-name">담당자명 *</label>
          <input id="pf-name" className="lp4-input" placeholder="홍길동" value={v.contactName} onChange={set("contactName")} autoComplete="name" required />
        </div>
        <div>
          <label className="lp4-flabel" htmlFor="pf-email">이메일 *</label>
          <input id="pf-email" type="email" className="lp4-input" placeholder="email@company.com" value={v.email} onChange={set("email")} autoComplete="email" required />
        </div>
        <div>
          <label className="lp4-flabel" htmlFor="pf-phone">연락처</label>
          <input id="pf-phone" type="tel" className="lp4-input" placeholder="010-0000-0000" value={v.phone} onChange={set("phone")} autoComplete="tel" />
        </div>
      </div>

      <div className="lp4-form-message">
        <label className="lp4-flabel" htmlFor="pf-message">문의 내용 *</label>
        <textarea id="pf-message" className="lp4-input lp4-textarea" rows={4} placeholder="도입 규모, 필요 기능, 연동 요구사항 등을 알려주세요" value={v.message} onChange={set("message")} required />
      </div>

      {/* 허니팟 — 사람에게는 숨겨진 필드. 봇이 채우면 서버가 조용히 버린다. */}
      <input
        type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        className="lp4-honeypot" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
      />

      {error && <p className="lp4-form-error" role="alert">{error}</p>}

      <button type="submit" disabled={busy} className="lp4-btn lp4-btn-dark lp4-form-submit">
        {busy ? "보내는 중…" : "문의 보내기"}
      </button>
      <p className="lp4-form-note">제출된 정보는 상담 목적으로만 사용되며, 개인정보처리방침에 따라 관리됩니다.</p>
    </form>
  );
}

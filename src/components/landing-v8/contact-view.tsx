"use client";
// ══════════════════════════════════════════════════════════════
//  /contact 도입 상담 신청 — 랜딩 v8 의 「전문 상담 예약」 두 버튼이 여기로 온다 (2026-09-14)
//
//  ▸ 전에는 mailto 였다. 신청이 회사에 남지 않았고, 메일 앱이 없는 PC 에서는 눌러도 아무 일이 없었다.
//  ▸ 접수는 옛 랜딩 폼과 같은 /api/partnership → partnership_inquiries → 운영자 문의함(/platform/partnership).
//  ▸ 머리는 랜딩보다 덜어냈다(로고 · 로그인 · 무료 체험). 신청하러 온 사람을 다른 곳으로 흘리지 않는다.
//  ▸ 스타일은 landing-v8.css 의 `.lp8` 안 `lp8-ct-*` 규칙.
// ══════════════════════════════════════════════════════════════
import { useState } from "react";
import Link from "next/link";
import "@/app/landing-v8.css";
import { CONTACT, FOOTER } from "./content";

type Fields = { companyName: string; contactName: string; email: string; phone: string; message: string };
const EMPTY: Fields = { companyName: "", contactName: "", email: "", phone: "", message: "" };

export default function ContactView() {
  const [v, setV] = useState<Fields>(EMPTY);
  const [size, setSize] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [agree, setAgree] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  const toggleInterest = (t: string) =>
    setInterests((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!v.companyName.trim()) return setError("회사명을 입력해주세요.");
    if (!v.contactName.trim()) return setError("담당자명을 입력해주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return setError("올바른 이메일 주소를 입력해주세요.");
    if (!agree) return setError("개인정보 수집·이용에 동의해주세요.");

    setBusy(true);
    try {
      const res = await fetch("/api/partnership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, size, interests, agree, source: "contact", website: honeypot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "접수에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "접수에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lp8">
      <header className="nav">
        <div className="container nav-in">
          <Link className="brand" href="/">
            <i>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />
              </svg>
            </i>
            오너뷰
          </Link>
          <div className="nav-cta lp8-ct-nav-cta">
            <Link className="btn btn-sm btn-line" href="/auth">로그인</Link>
            <Link className="btn btn-sm btn-fill" href="/auth">무료 체험하기</Link>
          </div>
        </div>
      </header>

      <main className="sec-100 lp8-ct-main">
        <div className="container lp8-ct-grid">
          {/* ── 왼쪽: 무엇을 하게 되는지 ── */}
          <section className="lp8-ct-intro">
            <h1 className="lp8-ct-h1">{CONTACT.h1}</h1>
            <p className="p20 lp8-ct-lead">{CONTACT.lead[0]}<br className="brk" />{CONTACT.lead[1]}</p>
            <ol className="lp8-ct-steps">
              {CONTACT.steps.map(([h, body], i) => (
                <li key={h}>
                  <span className="lp8-ct-no">{i + 1}</span>
                  <div>
                    <b>{h}</b>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="lp8-ct-alt">
              바로 사용해 보시려면 <Link href="/auth">무료로 시작하세요</Link>.<br className="brk" />
              메일 문의는 <a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a> 에서 받습니다.
            </p>
          </section>

          {/* ── 오른쪽: 신청서 ── */}
          <section className="lp8-ct-card" aria-live="polite">
            {sent ? (
              <div className="lp8-ct-done">
                <span className="lp8-ct-done-mark" aria-hidden="true">✓</span>
                <h2 className="lp8-ct-done-h">상담 신청이 접수되었습니다</h2>
                <p>영업일 기준 1일 이내에 <b>{v.email.trim()}</b> 으로 연락드립니다.</p>
                <p>기다리시는 동안 무료 플랜으로 먼저 사용해 보세요!</p>
                <div className="lp8-ct-done-cta">
                  <Link className="btn btn-fill" href="/auth">무료로 시작하기</Link>
                  <Link className="btn btn-soft" href="/">처음 화면으로</Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <div className="lp8-ct-fields">
                  <label className="lp8-ct-field">
                    <span>회사명 <em>*</em></span>
                    <input value={v.companyName} onChange={set("companyName")} placeholder="(주)회사명" autoComplete="organization" required />
                  </label>
                  <label className="lp8-ct-field">
                    <span>담당자명 <em>*</em></span>
                    <input value={v.contactName} onChange={set("contactName")} placeholder="홍길동" autoComplete="name" required />
                  </label>
                  <label className="lp8-ct-field">
                    <span>이메일 <em>*</em></span>
                    <input type="email" value={v.email} onChange={set("email")} placeholder="email@company.com" autoComplete="email" required />
                  </label>
                  <label className="lp8-ct-field">
                    <span>연락처</span>
                    <input type="tel" value={v.phone} onChange={set("phone")} placeholder="010-0000-0000" autoComplete="tel" />
                  </label>
                </div>

                <fieldset className="lp8-ct-set">
                  <legend>인원</legend>
                  <div className="lp8-ct-chips">
                    {CONTACT.sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={size === s}
                        onClick={() => setSize((prev) => (prev === s ? "" : s))}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="lp8-ct-set">
                  <legend>관심 있는 업무 <small>복수 선택</small></legend>
                  <div className="lp8-ct-chips">
                    {CONTACT.interests.map((t) => (
                      <button key={t} type="button" aria-pressed={interests.includes(t)} onClick={() => toggleInterest(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="lp8-ct-field lp8-ct-field-full">
                  <span>업종과 문의 내용</span>
                  <textarea
                    rows={4}
                    value={v.message}
                    onChange={set("message")}
                    placeholder="예) 스마트스토어 판매 업체입니다. 주문과 장부를 엑셀로 관리하고 있어, 세무사 사무실과 자료를 공유하는 방법이 궁금합니다."
                  />
                </label>

                {/* 허니팟 — 사람에게는 숨겨진 칸. 봇이 채우면 서버가 조용히 버린다. */}
                <input
                  type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                  className="lp8-ct-honeypot" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                />

                <label className="lp8-ct-agree">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>
                    <b>개인정보 수집·이용에 동의합니다 <em>*</em></b>
                    <small>
                      {CONTACT.consent.map(([k, val]) => <span key={k}>{k}: {val}</span>)}
                      <span>자세한 내용은 <Link href="/privacy">개인정보처리방침</Link>에서 확인하실 수 있습니다.</span>
                    </small>
                  </span>
                </label>

                {error && <p className="lp8-ct-error" role="alert">{error}</p>}

                <button type="submit" disabled={busy} className="btn btn-fill lp8-ct-submit">
                  {busy ? "보내는 중…" : "상담 신청하기"}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>

      <footer className="foot">
        <div className="container foot-row">
          <div>
            {FOOTER.company}<br />
            {FOOTER.addr} · {FOOTER.email}
          </div>
          <div className="lp8-foot-links">
            {FOOTER.links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </div>
        </div>
      </footer>
    </div>
  );
}

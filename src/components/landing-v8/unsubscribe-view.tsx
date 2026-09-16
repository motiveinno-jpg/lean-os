"use client";
// ══════════════════════════════════════════════════════════════
//  /unsubscribe 광고 메일 수신거부 (2026-09-16)
//
//  ▸ 정보통신망법 제50조가 요구하는 「수신거부 방법」. 소개 메일 푸터의 링크가 여기로 온다.
//  ▸ 접수는 /api/unsubscribe → email_optouts (service_role). 확인 메일은 보내지 않는다 —
//    남의 주소를 넣어 메일을 쏘게 만드는 통로가 되기 때문. 제50조 제7항의 처리 결과 통지는
//    신청 즉시 이 화면에 결과와 처리 시각을 띄우는 것으로 갈음한다.
//  ▸ 머리에 가입 버튼을 두지 않는다. 메일을 끊으러 온 사람에게 가입을 권하지 않는다.
//  ▸ 스타일은 landing-v8.css 의 `.lp8` 안 `lp8-ct-*`(상담 신청과 공용) + `lp8-un-*`.
// ══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import "@/app/landing-v8.css";
import { FOOTER } from "./content";
import { SiteFooter } from "./site-shell";
import { useLandingLightTheme } from "@/components/theme-context";

export default function UnsubscribeView() {
  useLandingLightTheme(); // 공개 페이지는 늘 밝게
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState("");

  // 메일 푸터 링크가 ?email= 로 주소를 들고 올 수 있다. 채워만 두고, 처리는 사람이 버튼을 눌러야 한다
  //   (열기만 해도 처리되면 메일 미리보기·스팸 검사기가 대신 눌러 버린다).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("email");
    if (q) setEmail(q.trim().slice(0, 160));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError("올바른 이메일 주소를 입력해주세요.");

    setBusy(true);
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v, website: honeypot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setDoneEmail(v);
      setDoneAt(new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
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
        </div>
      </header>

      <main className="sec-100 lp8-ct-main">
        <div className="container lp8-un-wrap">
          <section className="lp8-ct-card" aria-live="polite">
            {doneAt ? (
              <div className="lp8-ct-done">
                <span className="lp8-ct-done-mark" aria-hidden="true">✓</span>
                <h1 className="lp8-ct-done-h">수신거부가 처리되었습니다</h1>
                <p><b>{doneEmail}</b> 주소로 오너뷰의 광고·소개 메일을 더 이상 보내지 않습니다.</p>
                <p className="lp8-un-stamp">처리 시각 {doneAt}</p>
                <p className="lp8-un-note">
                  오너뷰를 사용 중이시라면 계약서·급여명세서·결재 알림 같은 <b>업무 메일은 그대로 받습니다.</b>{" "}
                  업무 메일까지 끊으려면 오너뷰에 로그인해 알림 설정에서 바꾸시면 됩니다.
                </p>
                <div className="lp8-ct-done-cta">
                  <Link className="btn btn-soft" href="/">처음 화면으로</Link>
                </div>
              </div>
            ) : (
              <>
                <h1 className="lp8-un-h1">광고 메일 수신거부</h1>
                <p className="lp8-un-lead">
                  메일을 받으신 주소를 넣고 누르시면 발송 목록에서 바로 빼 드립니다.
                  비용은 들지 않고, 로그인도 필요 없습니다.
                </p>

                <form onSubmit={submit} noValidate>
                  <label className="lp8-ct-field">
                    <span>메일을 받으신 이메일 주소</span>
                    <input
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@company.com" autoComplete="email" required
                    />
                  </label>

                  {/* 허니팟 — 사람에게는 숨겨진 칸. 봇이 채우면 서버가 조용히 버린다. */}
                  <input
                    type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                    className="lp8-ct-honeypot" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                  />

                  {error && <p className="lp8-ct-error">{error}</p>}

                  <button type="submit" className="btn btn-fill lp8-un-submit" disabled={busy}>
                    {busy ? "처리 중…" : "수신거부하기"}
                  </button>
                </form>

                <p className="lp8-un-note">
                  오너뷰를 사용 중이시라면 계약서·급여명세서·결재 알림 같은 <b>업무 메일은 그대로 받습니다.</b>{" "}
                  여기서 빠지는 것은 광고·소개 메일뿐입니다.
                </p>
                <p className="lp8-un-note">
                  잘 되지 않으면 <a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a> 으로 알려 주세요. 직접 처리해 드립니다.
                </p>
              </>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

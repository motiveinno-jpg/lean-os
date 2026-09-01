"use client";

// 설문 응답 페이지 — 로그인 없는 외부 공개 (2026-09-01 프로젝트 v3 설문 발송)
//   내용은 전부 project-survey 엣지 함수가 토큰을 검증해 내려준다(anon 은 DB 직접 접근 불가).
//   모바일 우선. 배너 → 제목 → 장문 안내 → 이미지들 → 질문 → 보내기.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type Q = { key: string; name: string; type: string; options: { id: string; label: string; color?: string }[]; required: boolean };
type Survey = {
  title: string; intro: string; name_label: string; banner: string | null; images: string[]; questions: Q[];
  //   2차 — 받는 조건. closes_at·remaining 은 안내용, 실제 거절은 서버(엣지)가 한다
  closes_at: string | null; remaining: number | null; prevent_dup: boolean;
};

//   마감 사유별 문장 — 서버가 reason 만 주고 문장은 여기서(외부인이 읽는 화면이라 한국어 고정)
const CLOSED_MSG: Record<string, string> = {
  date: "마감일이 지나 접수가 끝났습니다.",
  full: "정원이 다 차서 접수가 끝났습니다.",
  off: "이 설문은 마감됐거나 주소가 올바르지 않습니다.",
};

//   1인 1회 이중 가드(브라우저 쪽) — 서버 IP 해시와 별개로, 이 기기의 재제출을 기억한다.
//   localStorage 는 없을 수 있으니(시크릿 창 등) 전부 try — 실패해도 서버 가드가 남는다.
const sentKey = (token: string) => `ov.sv.sent.${token}`;
const wasSent = (token: string) => { try { return localStorage.getItem(sentKey(token)) === "1"; } catch { return false; } };
const markSent = (token: string) => { try { localStorage.setItem(sentKey(token), "1"); } catch { /* 무시 */ } };

const FN_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/project-survey`;

export default function SurveyPage() {
  const params = useParams();
  const token = String(params?.token || "");
  const [sv, setSv] = useState<Survey | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "closed" | "done" | "already">("loading");
  const [closedMsg, setClosedMsg] = useState(CLOSED_MSG.off);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) { setState("closed"); return; }
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setClosedMsg(CLOSED_MSG[d.reason as string] || CLOSED_MSG.off); setState("closed"); return; }
        setSv(d);
        //   1인 1회 설문인데 이 기기에서 이미 보냈으면 폼을 다시 열지 않는다
        setState(d.prevent_dup && wasSent(token) ? "already" : "ready");
      })
      .catch(() => setState("closed"));
  }, [token]);

  const set = (key: string, v: unknown) => { setAnswers((a) => ({ ...a, [key]: v })); setErr(null); };

  const missing = useMemo(() => {
    if (!sv) return [];
    const m: string[] = [];
    if (!name.trim()) m.push("__name");
    for (const q of sv.questions) {
      const v = answers[q.key];
      if (q.required && (v == null || String(v).trim() === "" || (q.type === "check" && v !== true))) m.push(q.key);
    }
    return m;
  }, [sv, name, answers]);

  const submit = async () => {
    if (!sv || sending) return;
    if (missing.length > 0) {
      const first = missing[0];
      setErr(first === "__name" ? `'${sv.name_label}' 은(는) 꼭 채워주세요` : `'${sv.questions.find((q) => q.key === first)?.name}' 은(는) 꼭 답해주세요`);
      document.getElementById(`svq-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSending(true);
    try {
      const r = await fetch(FN_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), answers }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.error === "dup") { markSent(token); setState("already"); return; }
        if (d.error === "closed") { setClosedMsg(CLOSED_MSG[d.reason as string] || CLOSED_MSG.off); setState("closed"); return; }
        setErr(d.error === "busy" ? "지금 응답이 몰리고 있어요 — 잠시 후 다시 눌러주세요" : "제출에 실패했어요 — 잠시 후 다시 시도해주세요");
        return;
      }
      markSent(token);
      setState("done");
    } finally {
      setSending(false);
    }
  };

  if (state === "loading") return <div className="svp-shell"><div className="svp-note">불러오는 중…</div></div>;
  if (state === "closed") return <div className="svp-shell"><div className="svp-note">{closedMsg}</div></div>;
  if (state === "already") return <div className="svp-shell"><div className="svp-note">이미 응답하셨어요 — 이 설문은 1인 1회입니다. 고치실 내용이 있으면 보내주신 분께 직접 연락해주세요.</div></div>;
  if (state === "done") return (
    <div className="svp-shell">
      <div className="svp-card svp-done">
        <div className="svp-done-ico">✅</div>
        <h2>접수됐습니다 — 감사합니다!</h2>
        <p>응답은 담당자에게 바로 전달됐습니다.</p>
      </div>
      <div className="svp-foot">이 설문은 오너뷰로 만들어졌습니다</div>
    </div>
  );
  if (!sv) return null;

  return (
    <div className="svp-shell">
      <div className="svp-card">
        {sv.banner && <img className="svp-banner" src={sv.banner} alt="" />}
        <div className="svp-head">
          <h1>{sv.title || "설문"}</h1>
          {(sv.closes_at || sv.remaining != null) && (
            <p className="svp-meta">
              {sv.closes_at && <>마감 {sv.closes_at.slice(5, 7)}/{sv.closes_at.slice(8, 10)}까지</>}
              {sv.closes_at && sv.remaining != null && " · "}
              {sv.remaining != null && <>남은 자리 {sv.remaining}</>}
            </p>
          )}
        </div>
        <div className="svp-body">
          {sv.intro && <div className="svp-intro">{sv.intro}</div>}
          {sv.images.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer"><img className="svp-img" src={u} alt="" /></a>
          ))}
          <div className="svp-q" id="svq-__name">
            <label>{sv.name_label} <i>*</i></label>
            <input type="text" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="예: 김민수 / 든든상회" />
          </div>
          {sv.questions.map((q) => (
            <div key={q.key} className="svp-q" id={`svq-${q.key}`}>
              <label>{q.name} {q.required && <i>*</i>}</label>
              {q.type === "rating" ? (
                <div className="svp-stars">
                  {[1, 2, 3, 4, 5].map((k) => (
                    <span key={k} className={Number(answers[q.key]) >= k ? "on" : ""} onClick={() => set(q.key, k)}>★</span>
                  ))}
                </div>
              ) : q.type === "select" ? (
                <div className="svp-opts">
                  {q.options.map((o) => (
                    <button key={o.id} type="button" className={answers[q.key] === o.id ? "on" : ""}
                      onClick={() => set(q.key, answers[q.key] === o.id ? null : o.id)}>{o.label}</button>
                  ))}
                </div>
              ) : q.type === "check" ? (
                <label className="svp-check">
                  <input type="checkbox" checked={answers[q.key] === true} onChange={(e) => set(q.key, e.target.checked)} /> 예
                </label>
              ) : q.type === "longtext" ? (
                <textarea rows={3} value={String(answers[q.key] ?? "")} onChange={(e) => set(q.key, e.target.value)} placeholder="자유롭게 적어주세요" />
              ) : q.type === "date" ? (
                <input type="date" value={String(answers[q.key] ?? "")} onChange={(e) => set(q.key, e.target.value)} />
              ) : q.type === "number" ? (
                <input type="text" inputMode="decimal" value={String(answers[q.key] ?? "")} onChange={(e) => set(q.key, e.target.value)} />
              ) : (
                <input type="text" value={String(answers[q.key] ?? "")} onChange={(e) => set(q.key, e.target.value)}
                  placeholder={q.type === "tel" ? "010-0000-0000" : q.type === "url" ? "https://" : ""} />
              )}
            </div>
          ))}
          {err && <div className="svp-err">{err}</div>}
          <button type="button" className="svp-submit" disabled={sending} onClick={submit}>
            {sending ? "보내는 중…" : "보내기"}
          </button>
        </div>
      </div>
      <div className="svp-foot">이 설문은 오너뷰로 만들어졌습니다 · 응답은 요청한 회사에만 전달됩니다</div>
    </div>
  );
}

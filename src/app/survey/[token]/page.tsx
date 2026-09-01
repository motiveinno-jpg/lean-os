"use client";

// 설문 응답 페이지 — 로그인 없는 외부 공개 (2026-09-01 프로젝트 v3 설문 발송)
//   내용은 전부 project-survey 엣지 함수가 토큰을 검증해 내려준다(anon 은 DB 직접 접근 불가).
//   모바일 우선. 배너 → 제목 → 장문 안내 → 이미지들 → 질문 → 보내기.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type Q = { key: string; name: string; type: string; options: { id: string; label: string; color?: string }[]; required: boolean };
type Survey = { title: string; intro: string; name_label: string; banner: string | null; images: string[]; questions: Q[] };

const FN_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/project-survey`;

export default function SurveyPage() {
  const params = useParams();
  const token = String(params?.token || "");
  const [sv, setSv] = useState<Survey | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "closed" | "done">("loading");
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) { setState("closed"); return; }
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setSv(d); setState("ready"); })
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
        setErr(d.error === "busy" ? "지금 응답이 몰리고 있어요 — 잠시 후 다시 눌러주세요" : "제출에 실패했어요 — 잠시 후 다시 시도해주세요");
        return;
      }
      setState("done");
    } finally {
      setSending(false);
    }
  };

  if (state === "loading") return <div className="svp-shell"><div className="svp-note">불러오는 중…</div></div>;
  if (state === "closed") return <div className="svp-shell"><div className="svp-note">이 설문은 마감됐거나 주소가 올바르지 않습니다.</div></div>;
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

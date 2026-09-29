"use client";
// AI 커넥터 연결 허용 화면 — Claude 에서 오너뷰 커넥터 "연결"을 누르면 여기로 온다(먼데이 커넥터와 같은 흐름).
//   로그인 안 했으면 로그인 뒤 이 주소 그대로 돌아온다. 허용하면 5분짜리 코드를 들고 Claude 로 돌아간다.
//   무엇을 누구 권한으로 보게 되는지 먼저 보여 준다 — 모르고 허용하면 회사 데이터가 밖으로 나가는 통로가 된다.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Info = {
  client_name: string; redirect_host: string; enabled: boolean;
  user: { name: string | null; email: string | null; company: string | null; scope: string };
};

function Consent() {
  const sp = useSearchParams();
  const q = (k: string) => sp.get(k) || "";
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ client_id: q("client_id"), redirect_uri: q("redirect_uri") });
    fetch(`/api/oauth/authorize/?${params}`, { credentials: "same-origin" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.status === 401 && d.login) {
          window.location.replace(`/auth?redirectTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        if (!r.ok) { setErr(d.error || "연결 정보를 확인하지 못했습니다."); return; }
        setInfo(d as Info);
      })
      .catch(() => setErr("연결 정보를 확인하지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (decision: "allow" | "deny") => {
    setBusy(true);
    const r = await fetch("/api/oauth/authorize/", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision, client_id: q("client_id"), redirect_uri: q("redirect_uri"), state: q("state"),
        response_type: q("response_type") || "code", code_challenge: q("code_challenge"),
        code_challenge_method: q("code_challenge_method"), scope: q("scope"), resource: q("resource"),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.redirect) { setErr(d.error || "처리하지 못했습니다."); setBusy(false); return; }
    window.location.assign(d.redirect);
  };

  return (
    <div className="oauth-consent-page">
      <div className="oauth-consent-card">
        <div className="oauth-consent-brand">오너뷰</div>
        {err ? (
          <>
            <h1 className="oauth-consent-title">연결할 수 없습니다</h1>
            <p className="oauth-consent-error">{err}</p>
          </>
        ) : !info ? (
          <p className="oauth-consent-muted">확인하는 중…</p>
        ) : (
          <>
            <h1 className="oauth-consent-title"><b>{info.client_name}</b> 이(가) 오너뷰에 연결하려고 합니다</h1>
            <dl className="oauth-consent-facts">
              <dt>계정</dt><dd>{info.user.name || "-"} · {info.user.email || "-"}</dd>
              <dt>회사</dt><dd>{info.user.company || "-"}</dd>
              <dt>볼 수 있는 범위</dt><dd>{info.user.scope}</dd>
              <dt>할 수 있는 일</dt><dd>조회만 — 오너뷰 데이터를 고치거나 지우지 않습니다</dd>
              <dt>허용 후 돌아갈 곳</dt><dd>{info.redirect_host}</dd>
            </dl>
            <p className="oauth-consent-muted">
              허용하면 이 AI 가 대화 중에 오너뷰의 회사 데이터(직원·근태·급여·미수금·통장·결재 등)를 조회해 답에 씁니다.
              계좌번호·카드번호는 내보내지 않습니다. 연결은 설정 › 연동 · API 키에서 언제든 끊을 수 있습니다.
            </p>
            {!info.enabled ? (
              <p className="oauth-consent-error">이 회사는 아직 AI 커넥터가 켜져 있지 않습니다. 오너뷰 운영팀에 문의해 주세요.</p>
            ) : (
              <div className="oauth-consent-actions">
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => decide("deny")}>거절</button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => decide("allow")}>{busy ? "연결 중…" : "허용"}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  return <Suspense fallback={null}><Consent /></Suspense>;
}

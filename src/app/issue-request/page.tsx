"use client";

// 세금계산서 발행 요청 — 공급자가 메일 링크(/issue-request?token=…)로 여는 화면. 로그인 없이 열린다.
//   내용은 토큰 RPC(issue_request_by_token)로만 읽는다(anon 은 표를 직접 못 읽는다).
//   문서를 종이처럼 늘 밝게 보여 준다 — /sign 과 같은 원칙(뷰어 다크모드와 무관).
//
//   발행 길
//     · 로그인한 공급자 회사 사람  → 오너뷰 세금·증빙 › 받은 발행 요청으로 보낸다
//     · (가) 홈택스에서 직접 발행  → 칸마다 복사 → 홈택스에서 발행 → 작성일자·승인번호를 적어 알린다
//     · (나) 이 화면에서 바로 발행 → ① 공급자 정보 + 인증서 등록(윈도우·30초) ② 작성일자 → 발행 (엣지 issue-request-public)

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DateField } from "@/components/date-field";
import { appConfirm } from "@/components/global-confirm";
import { IssueRequestInvoice } from "@/components/issue-request-invoice";
import { todayKst } from "@/lib/kst";
import {
  loadRequestByToken, markRequestManual, validateConfirmNo, validateWriteDate, formatBizNo, formatConfirmNo,
  ISSUED_VIA_LABEL, type PublicRequest,
} from "@/lib/tax-invoice-request";

const FN_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/issue-request-public`;

type Msg = { tone: "ok" | "err" | "info"; text: string } | null;

async function callPublic(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, string> }> {
  const res = await fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <div className={msg.tone === "ok" ? "irp-msg irp-msg-ok" : msg.tone === "err" ? "irp-msg irp-msg-err" : "irp-msg"}>{msg.text}</div>;
}

function IssueRequestInner() {
  const params = useSearchParams();
  const token = String(params?.get("token") || "");
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "ready">("loading");
  const [mode, setMode] = useState<"hometax" | "here">("hometax");

  const load = useCallback(async () => {
    if (!token) { setState("invalid"); return; }
    try {
      const r = await loadRequestByToken(token);
      if (!r) { setState("invalid"); return; }
      setReq(r); setState("ready");
    } catch { setState("invalid"); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") {
    return <div className="irp-center"><p className="irp-dim">요청서를 불러오는 중…</p></div>;
  }
  if (state === "invalid" || !req) {
    return (
      <div className="irp-center">
        <div className="irp-card irp-card-narrow">
          <h1 className="irp-h1">유효하지 않은 링크</h1>
          <p className="irp-dim">주소가 잘못됐거나 더 이상 열 수 없는 요청입니다. 요청한 회사에 문의해 주세요.</p>
        </div>
      </div>
    );
  }
  if (req.state === "canceled" || req.state === "expired") {
    return (
      <div className="irp-center">
        <div className="irp-card irp-card-narrow">
          <h1 className="irp-h1">{req.state === "canceled" ? "취소된 요청" : "기한이 지난 요청"}</h1>
          <p className="irp-dim">
            {req.buyer_name || "요청 회사"}
            {req.state === "canceled" ? "에서 이 발행 요청을 취소했습니다." : "에서 보낸 이 발행 요청은 기한이 지났습니다. 필요하면 다시 보내 달라고 해 주세요."}
          </p>
        </div>
      </div>
    );
  }

  const issued = req.state === "issued";
  return (
    <div className="irp-shell">
      <header className="irp-header">
        <div className="irp-wrap irp-header-in">
          <div>
            <h1 className="irp-h1">{req.buyer_name}에서 세금계산서 발행을 요청했습니다</h1>
            <p className="irp-dim">
              공급자 {req.supplier_name} ({formatBizNo(req.supplier_business_number)})
              {req.expires_at && !issued && ` · ${String(req.expires_at).slice(0, 10)}까지 열립니다`}
            </p>
          </div>
          {issued && <span className="irp-badge irp-badge-ok">발행 완료</span>}
        </div>
      </header>

      <main className="irp-wrap irp-main">
        {issued && (
          <div className="irp-msg irp-msg-ok">
            작성일 {req.write_date || "-"}로 발행 완료가 기록됐습니다
            {req.issued_via ? ` (${ISSUED_VIA_LABEL[req.issued_via]})` : ""}
            {req.nts_confirm_no ? ` · 승인번호 ${formatConfirmNo(req.nts_confirm_no)}` : " · 국세청 승인번호는 전송 뒤(다음 영업일) 붙습니다"}.
          </div>
        )}

        {!issued && req.is_supplier_member && req.request_id && (
          <div className="irp-member">
            <div>
              <b>오너뷰를 쓰는 회사입니다.</b>
              <span className="irp-dim"> 오너뷰에서 작성일자만 넣고 바로 발행할 수 있습니다.</span>
            </div>
            <a className="irp-btn irp-btn-primary" href={`/tax-invoices?tab=received&request=${encodeURIComponent(req.request_id)}`}>오너뷰에서 발행하기</a>
          </div>
        )}

        {!issued && !req.is_supplier_member && (
          <div className="irp-modes" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "hometax"}
              className={mode === "hometax" ? "irp-mode irp-mode-on" : "irp-mode"} onClick={() => setMode("hometax")}>
              (가) 홈택스에서 직접 발행
            </button>
            <button type="button" role="tab" aria-selected={mode === "here"}
              className={mode === "here" ? "irp-mode irp-mode-on" : "irp-mode"} onClick={() => setMode("here")}>
              (나) 이 화면에서 바로 발행
            </button>
          </div>
        )}

        <IssueRequestInvoice data={req} copyable={!issued && !req.is_supplier_member && mode === "hometax"} />

        {!issued && !req.is_supplier_member && mode === "hometax" && <HometaxManual token={token} onDone={load} />}
        {!issued && !req.is_supplier_member && mode === "here" && <IssueHere token={token} req={req} onDone={load} />}
      </main>

      <footer className="irp-footer">
        <div className="irp-wrap"><p className="irp-dim">오너뷰를 통해 {req.buyer_name}에서 보낸 발행 요청입니다. 세금계산서는 공급자 명의로 발행됩니다.</p></div>
      </footer>
    </div>
  );
}

// (가) 홈택스에서 직접 발행한 뒤 알리기
function HometaxManual({ token, onDone }: { token: string; onDone: () => void }) {
  const [writeDate, setWriteDate] = useState(todayKst());
  const [confirmNo, setConfirmNo] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = validateWriteDate(writeDate, todayKst()) || validateConfirmNo(confirmNo, writeDate);
    if (e) { setMsg({ tone: "err", text: e }); return; }
    setBusy(true); setMsg(null);
    try {
      await markRequestManual(token, writeDate, confirmNo);
      setMsg({ tone: "ok", text: "발행 완료를 알렸습니다. 요청 회사에도 발행됨으로 표시됩니다." });
      onDone();
    } catch (err) {
      setMsg({ tone: "err", text: (err as { message?: string })?.message || "기록하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally { setBusy(false); }
  };

  return (
    <section className="irp-card">
      <h2 className="irp-h2">홈택스에서 직접 발행하기</h2>
      <ol className="irp-steps">
        <li>
          <a href="https://www.hometax.go.kr" target="_blank" rel="noopener noreferrer" className="irp-link">홈택스 바로가기</a>
          {" "}→ 전자(세금)계산서 발행에서 위 칸을 [복사]해 그대로 옮겨 적습니다.
        </li>
        <li>발행을 마치면 작성일자와 국세청 승인번호(24자리)를 아래에 적어 알려 주세요.</li>
      </ol>
      <div className="irp-form">
        <label className="irp-fld"><span>작성일자</span>
          <DateField value={writeDate} max={todayKst()} onChange={(e) => setWriteDate(e.target.value)} /></label>
        <label className="irp-fld irp-fld-wide"><span>국세청 승인번호</span>
          <input className="irp-input" value={confirmNo} placeholder="20261008-41000000-00000000"
            onChange={(e) => setConfirmNo(e.target.value)} /></label>
      </div>
      <Notice msg={msg} />
      <div className="irp-actions">
        <button type="button" className="irp-btn irp-btn-primary" onClick={submit} disabled={busy}>
          {busy ? "기록 중…" : "발행 완료 알리기"}
        </button>
      </div>
    </section>
  );
}

// (나) 이 화면에서 바로 발행 — ① 공급자 정보 + 인증서 등록 ② 작성일자 → 발행
function IssueHere({ token, req, onDone }: { token: string; req: PublicRequest; onDone: () => void }) {
  const saved = req.supplier_profile || null;
  const [f, setF] = useState({
    corp_name: saved?.corp_name || req.supplier_name || "",
    ceo_name: saved?.ceo_name || req.supplier_representative || "",
    addr: saved?.addr || "",
    biz_type: saved?.biz_type || "",
    biz_class: saved?.biz_class || "",
    tel: saved?.tel || "",
    contact_name: saved?.contact_name || "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const [registered, setRegistered] = useState(!!saved?.registered_at);
  const [regMsg, setRegMsg] = useState<Msg>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [writeDate, setWriteDate] = useState(todayKst());
  const [msg, setMsg] = useState<Msg>(
    req.public_issue_status === "pending"
      ? { tone: "info", text: "앞서 누른 발행이 아직 결과를 기다리고 있습니다. 다시 누르지 말고 잠시 뒤 새로고침해 주세요." }
      : null,
  );
  const [busy, setBusy] = useState(false);

  const missing = [
    !f.corp_name.trim() && "상호", !f.ceo_name.trim() && "대표자", !f.addr.trim() && "주소",
    !f.biz_type.trim() && "업태", !f.biz_class.trim() && "종목", !f.tel.trim() && "전화번호",
  ].filter(Boolean) as string[];

  //   인증서 등록 주소는 30초만 유효하고, 응답 뒤에 창을 열면 팝업 차단에 걸린다 — 누르는 순간 빈 창부터 연다
  const register = async () => {
    if (missing.length) { setRegMsg({ tone: "err", text: `빠진 칸이 있습니다: ${missing.join(", ")}` }); return; }
    setRegBusy(true); setRegMsg(null);
    const popup = window.open("", "_blank");
    if (popup) popup.document.write('<p style="font-family:sans-serif;padding:24px;color:#555">인증서 등록 페이지를 불러오는 중입니다…</p>');
    try {
      const { ok, data } = await callPublic({
        action: "register", token, business_number: req.supplier_business_number, profile: f,
      });
      if (!ok || !data.certURL) {
        popup?.close();
        setRegMsg({ tone: "err", text: data.error || "인증서 등록 주소를 받지 못했습니다." });
        return;
      }
      if (popup && !popup.closed) popup.location.href = data.certURL; else window.open(data.certURL, "_blank");
      setRegistered(true);
      setRegMsg({ tone: "ok", text: data.message || "인증서 등록 창을 열었습니다. 등록을 마친 뒤 ② 단계에서 발행하세요." });
    } catch {
      popup?.close();
      setRegMsg({ tone: "err", text: "연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally { setRegBusy(false); }
  };

  const issue = async () => {
    const e = validateWriteDate(writeDate, todayKst());
    if (e) { setMsg({ tone: "err", text: e }); return; }
    if (!(await appConfirm(`작성일자 ${writeDate}로 ${req.buyer_name}에 세금계산서를 발행할까요? 발행한 뒤에는 수정세금계산서로만 고칠 수 있습니다.`, { confirmLabel: "발행", title: "세금계산서 발행" }))) return;
    setBusy(true); setMsg(null);
    try {
      const { ok, data } = await callPublic({ action: "issue", token, write_date: writeDate });
      if (!ok) { setMsg({ tone: "err", text: [data.error, data.hint].filter(Boolean).join(" — ") || "발행하지 못했습니다." }); return; }
      setMsg({ tone: "ok", text: data.message || "발행했습니다." });
      onDone();
    } catch {
      setMsg({ tone: "err", text: "응답을 받지 못했습니다. 다시 누르지 말고 잠시 뒤 새로고침해 결과를 확인해 주세요." });
    } finally { setBusy(false); }
  };

  return (
    <section className="irp-card">
      <h2 className="irp-h2">① 공급자 정보 입력 · 인증서 등록</h2>
      <p className="irp-dim">
        처음 한 번만 합니다. 전자세금계산서 발행 대행(팝빌)에 공급자로 가입하고 <b>공동인증서</b>(전자세금용·범용)를 등록합니다.
        인증서 등록 창은 <b>윈도우 PC</b>에서만 열리고, 주소는 <b>30초</b> 동안만 유효합니다.
      </p>
      <div className="irp-form">
        <label className="irp-fld"><span>사업자등록번호</span>
          <input className="irp-input" value={formatBizNo(req.supplier_business_number)} readOnly /></label>
        <label className="irp-fld"><span>상호 *</span><input className="irp-input" value={f.corp_name} onChange={set("corp_name")} /></label>
        <label className="irp-fld"><span>대표자 *</span><input className="irp-input" value={f.ceo_name} onChange={set("ceo_name")} /></label>
        <label className="irp-fld irp-fld-wide"><span>사업장 주소 *</span><input className="irp-input" value={f.addr} onChange={set("addr")} /></label>
        <label className="irp-fld"><span>업태 *</span><input className="irp-input" value={f.biz_type} onChange={set("biz_type")} /></label>
        <label className="irp-fld"><span>종목 *</span><input className="irp-input" value={f.biz_class} onChange={set("biz_class")} /></label>
        <label className="irp-fld"><span>전화번호 *</span><input className="irp-input" value={f.tel} inputMode="tel" onChange={set("tel")} /></label>
        <label className="irp-fld"><span>담당자 이름</span><input className="irp-input" value={f.contact_name} onChange={set("contact_name")} /></label>
        <label className="irp-fld irp-fld-wide"><span>담당자 이메일</span>
          <input className="irp-input" value={req.supplier_email || ""} readOnly /></label>
      </div>
      <p className="irp-dim">이메일은 요청을 받은 주소로 고정됩니다. 다른 주소로 받으려면 요청 회사에 다시 보내 달라고 해 주세요.</p>
      <Notice msg={regMsg} />
      <div className="irp-actions">
        <button type="button" className="irp-btn" onClick={register} disabled={regBusy}>
          {regBusy ? "여는 중…" : registered ? "인증서 등록 창 다시 열기" : "가입하고 인증서 등록 창 열기"}
        </button>
      </div>

      <hr className="irp-hr" />

      <h2 className="irp-h2">② 작성일자 넣고 발행</h2>
      <p className="irp-dim">인증서 등록을 마친 뒤 누르세요. 국세청 전송은 다음 영업일에 이뤄지고 그때 승인번호가 붙습니다.</p>
      <div className="irp-form">
        <label className="irp-fld"><span>작성일자 *</span>
          <DateField value={writeDate} max={todayKst()} onChange={(e) => setWriteDate(e.target.value)} /></label>
      </div>
      <Notice msg={msg} />
      <div className="irp-actions">
        <button type="button" className="irp-btn irp-btn-primary" onClick={issue}
          disabled={busy || !registered || req.public_issue_status === "pending"}
          title={!registered ? "먼저 ① 단계를 해 주세요" : undefined}>
          {busy ? "발행 중…" : "세금계산서 발행"}
        </button>
      </div>
    </section>
  );
}

export default function IssueRequestPage() {
  return (
    <Suspense fallback={<div className="irp-center"><p className="irp-dim">불러오는 중…</p></div>}>
      <IssueRequestInner />
    </Suspense>
  );
}

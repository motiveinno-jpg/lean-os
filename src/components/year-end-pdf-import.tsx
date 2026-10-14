"use client";

// ── 연말정산 간소화 PDF 불러오기 팝업 (2026-10-14 연말정산 5단계) ──
//   직원 브라우저 안에서만 읽는다(서버·AI 전송 없음, 원본 저장 없음). 찾은 금액은 '제안' — 사람·칸을 보고 고른 것만 공제 칸에 넣는다.
//   넣으면 고른 칸은 PDF 합계로 바뀌고, 나머지 칸은 그대로다(직접 넣은 값 보존).

import { useState } from "react";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { extractPdfLines, PdfPasswordError } from "@/lib/hometax-pdf-extract";
import { parseHometaxLines, sumPdfItems, PDF_TARGET_LABEL, type PdfParsed, type PdfTarget } from "@/lib/tax-forms/hometax-pdf";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const TARGETS = Object.keys(PDF_TARGET_LABEL) as PdfTarget[];

export function YearEndPdfImport({ year, onClose, onApply }: {
  year: number; onClose: () => void; onApply: (sums: Partial<Record<PdfTarget, number>>) => void;
}) {
  useModalKeys(true, onClose);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPw, setNeedPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<PdfParsed | null>(null);

  const read = async (f: File, pw?: string) => {
    setBusy(true); setError(null);
    try {
      const r = parseHometaxLines(await extractPdfLines(f, pw));
      if (!r.items.length && !r.info.length) setError("간소화 자료를 찾지 못했습니다. 홈택스 › 연말정산 간소화에서 내려받은 PDF인지 확인하세요.");
      else { setParsed(r); setNeedPw(false); }
    } catch (e) {
      if (e instanceof PdfPasswordError) { setNeedPw(true); setError(e.wrong ? "비밀번호가 맞지 않습니다." : null); }
      else setError("PDF를 읽지 못했습니다. 파일이 손상됐거나 간소화 PDF가 아닐 수 있습니다.");
    } finally { setBusy(false); }
  };
  const setItem = (i: number, patch: Partial<PdfParsed["items"][number]>) =>
    setParsed((p) => (p ? { ...p, items: p.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) } : p));
  const sums = parsed ? sumPdfItems(parsed.items) : {};
  const unresolved = parsed ? parsed.items.filter((x) => x.use && !x.target).length : 0;

  return (
    <div className="rtf-drill-overlay" onClick={onClose}>
      <div className="rtf-form ye-pdf" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="간소화 PDF 불러오기">
        <div className="rtf-drill-head"><b>간소화 PDF 불러오기</b><span>PDF는 이 브라우저 안에서만 읽고, 어디에도 올리거나 저장하지 않습니다.</span></div>
        {!parsed ? (
          <div className="ye-pdf-pick">
            <p className="rtf-legend">홈택스 › 연말정산 간소화 › <b>PDF 일괄 내려받기</b> 파일을 고르세요. 부양가족 자료는 동의를 받은 뒤 함께 내려받으면 같이 읽습니다.</p>
            <input type="file" accept="application/pdf,.pdf" className="field-input" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setParsed(null); setNeedPw(false); setPassword(""); if (f) void read(f); }} />
            {needPw && (
              <label className="rtf-form-field"><span>PDF 비밀번호 (내려받을 때 정한 것)</span>
                <input type="password" className="field-input" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && file && password) void read(file, password); }} /></label>
            )}
            {busy && <p className="rtf-legend">읽는 중…</p>}
            {error && <p className="rtf-legend vr-warn">{error}</p>}
          </div>
        ) : (
          <div className="ye-pdf-result">
            <p className="rtf-legend">
              {parsed.year ? `${parsed.year}년 귀속` : "귀속연도 모름"}{parsed.self ? ` · 본인 ${parsed.self}` : ""} · 찾은 항목 {parsed.items.length}건.
              {parsed.year && parsed.year !== year && <b className="vr-warn"> 이 정산은 {year}년 귀속입니다 — 다른 해 자료인지 확인하세요.</b>}
              {parsed.overIncome.length > 0 && <> 소득기준 초과 부양가족({parsed.overIncome.join(", ")})은 의료비만 넣고 나머지는 뺐습니다.</>}
            </p>
            <div className="stg-table-wrap vr-scroll ye-pdf-table">
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr><th>넣기</th><th>항목</th><th>사람</th><th>금액</th><th>넣을 칸</th></tr></thead>
                <tbody>
                  {parsed.items.map((it, i) => (
                    <tr key={i}>
                      <td className="tc"><input type="checkbox" checked={it.use} aria-label="넣기" onChange={(e) => setItem(i, { use: e.target.checked })} /></td>
                      <td className="text-left">{it.section}{it.note && <div className="ev-dim ye-pdf-note">{it.note}</div>}</td>
                      <td className="tc">{it.person}{it.self ? " (본인)" : ""}</td>
                      <td className="tr mono-number">{won(it.amount)}</td>
                      <td className="text-left">
                        <select className={`field-input ye-pdf-select ${it.use && !it.target ? "vr-warn" : ""}`} value={it.target || ""} aria-label="넣을 칸"
                          onChange={(e) => setItem(i, { target: (e.target.value || null) as PdfTarget | null, use: !!e.target.value })}>
                          <option value="">{it.target ? "넣지 않음" : "확인 필요 — 칸 고르기"}</option>
                          {TARGETS.map((t) => <option key={t} value={t}>{PDF_TARGET_LABEL[t]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.info.length > 0 && (
              <p className="rtf-legend">급여에서 이미 잡히는 것(넣지 않음): {parsed.info.map((x) => `${x.section} ${won(x.amount)}`).join(" · ")}.
                국민연금 지역가입자·추납 납부분이 있으면 담당자에게 알려 주세요.</p>
            )}
            {parsed.missed.length > 0 && <p className="rtf-legend vr-warn">금액을 찾지 못한 항목: {parsed.missed.join(", ")} — 직접 넣으세요.</p>}
            <div className="ye-pdf-sums">
              {Object.entries(sums).map(([k, v]) => <span key={k}>{PDF_TARGET_LABEL[k as PdfTarget]} <b className="mono-number">{won(v || 0)}</b></span>)}
            </div>
          </div>
        )}
        <div className="rtf-form-actions">
          {parsed && <button type="button" className="btn-secondary btn-sm mr-auto" onClick={() => { setParsed(null); setFile(null); }}>다른 파일</button>}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          {needPw && !parsed && <button type="button" className="btn-primary btn-sm" disabled={!password || busy || !file} onClick={() => file && void read(file, password)}>열기</button>}
          {parsed && (
            <button type="button" className="btn-primary btn-sm" disabled={!Object.keys(sums).length || unresolved > 0}
              title={unresolved ? `칸을 고르지 않은 항목 ${unresolved}건이 있습니다` : undefined}
              onClick={() => { onApply(sums); onClose(); }}>공제 칸에 넣기</button>
          )}
        </div>
      </div>
    </div>
  );
}

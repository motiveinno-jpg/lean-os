"use client";
// 거래처 등록 폼 상단 "사업자등록증으로 채우기" — PDF·이미지를 올리면 AI 가 읽어 칸을 채운다. 사람이 확인 후 저장.
import { useRef, useState } from "react";
import { BIZ_CERT_ACCEPT, extractBizCert, type BizCertFields } from "@/lib/biz-cert";
import { Ico } from "@/components/ui-icon";

export function BizCertUpload({ onExtracted, compact }: { onExtracted: (f: BizCertFields, meta: { confidence: number; notes: string }) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const handle = async (file: File | null | undefined) => {
    if (!file || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await extractBizCert(file);
      const filled = Object.entries(r.fields).filter(([k, v]) => k !== "doc_kind" && v).length;
      if (r.fields.doc_kind === "unknown" && filled === 0) {
        setMsg({ tone: "err", text: "사업자등록증으로 보이지 않습니다. 다른 파일을 올려 주세요." });
        return;
      }
      onExtracted(r.fields, { confidence: r.confidence, notes: r.notes });
      const low = r.confidence < 0.7 || !!r.notes;
      setMsg({ tone: low ? "warn" : "ok", text: low
        ? `${filled}개 칸을 채웠습니다. 확인이 필요한 부분: ${r.notes || "일부 글자가 흐릿합니다"} — 저장 전에 한 번 더 봐 주세요.`
        : `${filled}개 칸을 채웠습니다. 내용을 확인하고 저장하세요.` });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "사업자등록증을 읽지 못했습니다." });
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  return (
    <div className={`bizcert ${compact ? "bizcert-compact" : ""}`}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); void handle(e.dataTransfer.files?.[0]); }}>
      <input ref={inputRef} type="file" accept={BIZ_CERT_ACCEPT} className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      <button type="button" className="bizcert-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Ico e={busy ? "⏳" : "📄"} /> {busy ? "사업자등록증 읽는 중…" : "사업자등록증으로 채우기"}
      </button>
      {!compact && <span className="bizcert-hint">PDF·JPG·PNG 를 올리거나 여기에 끌어다 놓으면 상호·사업자번호·대표자·주소·업태·종목이 자동으로 들어갑니다. 저장 전에 확인·수정할 수 있습니다.</span>}
      {msg && <div className={`bizcert-msg bizcert-msg-${msg.tone}`}>{msg.text}</div>}
    </div>
  );
}

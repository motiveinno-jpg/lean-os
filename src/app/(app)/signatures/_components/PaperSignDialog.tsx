"use client";
//   종이 서명 등록 (2026-10-01 사장님: 추천 (나)) — 거래처가 종이에 서명해 돌려준 계약을 '서명 완료(종이)'로 남긴다.
//   스캔본 필수 · 문서 수정 권한자만(서버가 거절하면 그 문구를 그대로 보여 준다) · 전자서명과 따로 표시.
import { useState } from "react";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { registerPaperSignature } from "@/lib/signatures";
import { todayKst } from "@/lib/kst";

export function PaperSignDialog({ row, companyId, userId, onClose, onDone }: {
  row: { id: string; signer_name: string | null; title: string | null };
  companyId: string;
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [signedDate, setSignedDate] = useState(todayKst());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useModalKeys(true, onClose);

  const submit = async () => {
    if (!file) { toast("서명된 종이 스캔본을 올려 주세요", "error"); return; }
    setBusy(true);
    try {
      await registerPaperSignature({ id: row.id, companyId, userId, file, signedDate, note });
      toast("종이 서명을 등록했습니다", "success");
      onDone();
      onClose();
    } catch (e) {
      toast(friendlyError(e, "종이 서명 등록 실패"), "error");
    }
    setBusy(false);
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box paper-sign-box" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-head"><b>종이 서명 등록</b><span className="paper-sign-who">{row.signer_name || "서명자"} · {row.title || "계약"}</span></div>
        <p className="inv-modal-desc">
          거래처가 종이에 서명해 돌려준 계약을 등록합니다. 서명된 종이를 스캔(또는 촬영)한 파일이 꼭 있어야 하고,
          등록하면 <b>서명 완료(종이)</b>로 바뀌어 되돌릴 수 없습니다. 전자서명과 구분해 표시되고 스캔본이 증빙으로 남습니다.
        </p>
        <label className="inv-field">
          <span>서명된 스캔본 (PDF·JPG·PNG, 20MB까지) *</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" className="paper-sign-file"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <label className="inv-field">
          <span>종이에 서명한 날짜 *</span>
          <DateField value={signedDate} max={todayKst()} onChange={(e) => setSignedDate(e.target.value)} />
        </label>
        <label className="inv-field">
          <span>메모</span>
          <textarea className="paper-sign-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 원본은 경영지원팀 캐비닛 보관" />
        </label>
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !file} onClick={submit}>{busy ? "등록 중…" : "등록"}</button>
        </div>
      </div>
    </div>
  );
}

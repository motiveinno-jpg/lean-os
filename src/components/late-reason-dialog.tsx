"use client";
// 지각 사유 쓰기 (2026-10-01 사장님) — 본인이 지각으로 기록된 날에 사유를 남긴다.
//   사유는 판정을 바꾸지 않는다(지각 여부는 attendance_judge 트리거 하나). 시각이 잘못 찍힌 거면 정정 요청이 맡는다.
//   저장은 set_late_reason RPC — 본인 행·지각인 날만, 빈 값 = 지움.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useModalKeys } from "@/hooks/use-modal-keys";

export type LateReasonRecord = { id: string; date: string; check_in: string | null; late_minutes: number | null; late_reason?: string | null };

const MAX = 500;
const QUICK = ["교통 지연", "병원 진료", "가족 돌봄", "외부 미팅 후 출근"];

function hm(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

export function LateReasonDialog({ record, onClose }: { record: LateReasonRecord; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(record.late_reason || "");
  const [busy, setBusy] = useState(false);
  useModalKeys(true, onClose);

  const save = async (value: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("set_late_reason", { p_record_id: record.id, p_reason: value });
      if (error) throw error;
      toast(value.trim() ? "지각 사유를 저장했습니다" : "지각 사유를 지웠습니다", "success");
      // 같은 행을 보는 화면들 — 사이드바·마이페이지 오늘 카드·내 근태 표·근태 관리
      qc.invalidateQueries({ queryKey: ["my-att-today"] });
      qc.invalidateQueries({ queryKey: ["mypage-attendance-records"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    } catch (e) {
      toast(friendlyError(e, "지각 사유 저장 실패"), "error");
    }
    setBusy(false);
  };

  const m = Number(record.late_minutes || 0);
  const body = (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box late-reason-box" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-head">
          <b>지각 사유</b>
          <span className="late-reason-when mono-number">{record.date} · {hm(record.check_in)} 출근{m > 0 ? ` · ${m}분 늦음` : ""}</span>
        </div>
        <p className="inv-modal-desc">근태 관리자가 지각 내역에서 이 사유를 봅니다. 사유를 적어도 지각 기록은 그대로 남습니다. 출근 시각이 잘못 찍혔다면 마이페이지 › 내 근태에서 정정 요청을 보내세요.</p>
        <span className="qk-quicks late-reason-quicks">
          {QUICK.map((q) => <button key={q} type="button" className="qk-quick" onClick={() => setText((t) => (t.trim() ? `${t.trim()} · ${q}` : q).slice(0, MAX))}>{q}</button>)}
        </span>
        <textarea className="late-reason-input" rows={3} maxLength={MAX} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 지하철 2호선 운행 지연으로 15분 늦었습니다" />
        <span className="late-reason-count mono-number">{text.length} / {MAX}</span>
        <div className="inv-modal-actions">
          {record.late_reason && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => save("")}>사유 지우기</button>}
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onClose}>나중에</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => save(text)}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return null;
  // 사이드바(backdrop-filter) 안에서 열면 fixed 가 사이드바에 갇힌다 — zoom 상자에 붙여 다른 팝업과 같은 크기로
  return createPortal(body, document.querySelector(".app-zoom") || document.body);
}

// 오늘 지각인데 사유가 없으면 한 번 자동으로 묻는다. '나중에'로 닫으면 그날은 다시 안 묻는다(이 브라우저).
const dismissKey = (recordId: string) => `late-reason-dismissed:${recordId}`;
export function wasLateReasonDismissed(recordId: string): boolean {
  try { return localStorage.getItem(dismissKey(recordId)) === "1"; } catch { return false; }
}
export function markLateReasonDismissed(recordId: string) {
  try { localStorage.setItem(dismissKey(recordId), "1"); } catch { /* 저장소 막힘 — 다음에 또 물어도 무해 */ }
}

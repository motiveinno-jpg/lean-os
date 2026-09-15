"use client";
//   회사설정 › 회계·세무 › 상실사유 — 퇴사 처리(구성원 상세)에서 고르는 4대보험 상실신고 사유.
//   저장이 없으면 표준(DEFAULT_LOSS_REASONS)을 그대로 보여 주고, 저장하면 회사 값이 된다.
//   회사는 문구 수정·표시여부(사용)·항목 추가/삭제를 할 수 있다. 코드는 고용보험 신고에 그대로 들어가므로
//   표준 코드는 되도록 유지하도록 안내만 한다(막지는 않는다).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { Ico } from "@/components/ui-icon";
import { fetchLossReasons, saveLossReasons, resetLossReasons, DEFAULT_LOSS_REASONS, type LossReason } from "@/lib/loss-reasons";

const GROUPS = ["자진퇴사", "회사사정과 근로자 귀책사유", "정년 등 기간만료", "기타"];

export function LossReasonsTab({ companyId }: { companyId: string; userId?: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isFetching } = useQuery({ queryKey: ["loss-reasons", companyId], queryFn: () => fetchLossReasons(companyId) });
  const [rows, setRows] = useState<LossReason[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRows(data.reasons.map((r) => ({ ...r }))); }, [data]);

  if (!rows) return <div className="collect-empty">상실사유를 읽는 중…</div>;

  const set = (i: number, patch: Partial<LossReason>) => setRows((rs) => (rs ? rs.map((r, k) => (k === i ? { ...r, ...patch } : r)) : rs));
  const remove = (i: number) => setRows((rs) => (rs ? rs.filter((_, k) => k !== i) : rs));
  const add = () => setRows((rs) => [...(rs || []), { code: "", label: "", group: "기타", enabled: true }]);

  const save = async () => {
    if (isFetching) { toast("목록을 읽는 중입니다. 잠시 후 저장하세요", "info"); return; }
    const cleaned = rows.map((r) => ({ ...r, code: r.code.trim(), label: r.label.trim(), group: (r.group || "기타").trim() || "기타" }));
    if (cleaned.some((r) => !r.code || !r.label)) { toast("코드와 문구를 모두 채워 주세요", "error"); return; }
    const codes = cleaned.map((r) => r.code);
    if (new Set(codes).size !== codes.length) { toast("코드가 겹칩니다. 코드는 서로 달라야 합니다", "error"); return; }
    if (!cleaned.some((r) => r.enabled !== false)) { toast("최소 한 개는 '사용'으로 두세요", "error"); return; }
    setBusy(true);
    try {
      await saveLossReasons(companyId, cleaned);
      await qc.invalidateQueries({ queryKey: ["loss-reasons", companyId] });
      toast("상실사유를 저장했습니다", "success");
    } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await resetLossReasons(companyId);
      await qc.invalidateQueries({ queryKey: ["loss-reasons", companyId] });
      toast("표준 상실사유로 되돌렸습니다", "success");
    } catch (e) { toast(friendlyError(e, "되돌리지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  //   표준에 없는 코드(회사가 추가/변경) 표시용 — 신고 코드 확인을 돕는다
  const stdCodes = new Set(DEFAULT_LOSS_REASONS.map((r) => r.code));

  return (
    <div className="ins-rates">
      <p className="inv-hint">퇴사 처리 창에서 고르는 상실사유입니다. 문구는 회사에 맞게 고칠 수 있고, 안 쓰는 사유는 <b>사용</b>을 꺼 두면 목록에서 숨습니다. <b>코드</b>는 고용보험 상실신고에 그대로 들어가니 표준 코드를 되도록 유지하세요.</p>
      <div className="stg-table-wrap">
        <table className="ev-table ev-lined table-loss-reasons">
          <thead>
            <tr>
              <th>사용</th><th>코드</th><th>상실사유(문구)</th><th>묶음</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="text-center">
                  <input type="checkbox" className="lr-check" checked={r.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} />
                </td>
                <td>
                  <input className="field-input lr-code" value={r.code} onChange={(e) => set(i, { code: e.target.value.replace(/[^0-9A-Za-z]/g, "") })} placeholder="예: 11" />
                  {r.code && !stdCodes.has(r.code) && <span className="lr-custom">회사 코드</span>}
                </td>
                <td><input className="field-input" value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="예: 개인 사정으로 인한 자진 퇴사" /></td>
                <td>
                  <select className="field-input lr-group" value={GROUPS.includes(r.group) ? r.group : "기타"} onChange={(e) => set(i, { group: e.target.value })}>
                    {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td className="text-center">
                  <button type="button" className="lr-del" onClick={() => remove(i)} title="이 사유 삭제" aria-label="삭제"><Ico e="🗑" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lr-addrow">
        <button type="button" className="btn-secondary btn-sm" onClick={add}>+ 사유 추가</button>
      </div>
      <div className="inv-modal-actions">
        <span className="doc-sums-sp" />
        {!data?.isDefault && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={reset}>표준으로 되돌리기</button>}
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>상실사유 저장</button>
      </div>
    </div>
  );
}

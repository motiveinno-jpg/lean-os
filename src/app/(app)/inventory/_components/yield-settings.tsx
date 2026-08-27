"use client";

// ── 수율·로스 임계값 설정 팝업 (결정 32, 2026-08-27) — 생산 › 도구 ▾ › 수율 임계값 ──
//   양품률이 이 아래로, 자재 로스율이 이 위로 가면 생산현황이 붉게 표시하고 AI 브리핑이 알린다. 조치는 사람.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { loadInventorySettings, saveInventorySettings, INVENTORY_DEFAULTS } from "@/lib/inventory-settings";

export function YieldSettingsDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [y, setY] = useState(String(INVENTORY_DEFAULTS.yield_warn * 100));
  const [l, setL] = useState(String(INVENTORY_DEFAULTS.loss_warn * 100));
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadInventorySettings(companyId).then((s) => { setY(String(Math.round(s.yield_warn * 1000) / 10)); setL(String(Math.round(s.loss_warn * 1000) / 10)); }); }, [companyId]);
  const save = async () => {
    const yv = Number(y) / 100, lv = Number(l) / 100;
    if (!(yv > 0 && yv <= 1) || !(lv >= 0 && lv < 1)) { toast("양품률은 0 초과 100 이하, 로스율은 0 이상 100 미만으로 넣으세요", "error"); return; }
    setBusy(true);
    try { await saveInventorySettings(companyId, { yield_warn: yv, loss_warn: lv }); toast("수율 임계값을 저장했습니다 — 생산현황과 AI 브리핑에 바로 적용됩니다", "success"); qc.invalidateQueries({ queryKey: ["inv-settings"] }); onClose(); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">수율 임계값</h3>
        <p className="inv-modal-desc">양품률이 아래 값 <b>미만</b>이거나 자재 로스율이 아래 값 <b>초과</b>면 재고 › 현황 › 생산현황에 붉게 표시하고, AI 브리핑이 최근 7일 기준으로 알립니다. 알림만 하고 조치는 사람이 합니다. 기본값 95% / 5%.</p>
        <div className="inv-form-grid">
          <label className="inv-field"><span>양품률 경고 (미만, %)</span>
            <input className="field-input" inputMode="decimal" value={y} onChange={(e) => setY(e.target.value)} /></label>
          <label className="inv-field"><span>자재 로스율 경고 (초과, %)</span>
            <input className="field-input" inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} /></label>
        </div>
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

"use client";

// ── 거래처 간편 등록 팝업 (2026-09-02 사장님: "등록되어 있지 않은 거래처, 매입매출전표에서 바로 등록") ──
//   전표를 치다가 거래처가 없으면 거래처 화면으로 나갔다 와야 했다 — 입력 흐름이 끊긴다.
//   여기서는 전표에 필요한 최소(이름·사업자번호·유형)만 받고, 나머지는 거래처 화면에서 보완한다.
//   같은 이름/사업자번호가 이미 있으면 새로 만들지 않고 그걸 쓰라고 알려 준다(중복 거래처 방지 — DB 에 유니크 제약이 없다).
//   코드는 DB 트리거(partners_assign_code)가 붙인다.

import { useEffect, useMemo, useState } from "react";
import { upsertPartner, normalizeBizNo } from "@/lib/partners";
import { friendlyError } from "@/lib/friendly-error";

export type QuickPartner = { id: string; code: string | number | null; name: string; business_number: string | null; type?: string | null };

export const PARTNER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "client", label: "고객사(매출처)" },
  { value: "vendor", label: "공급업체(매입처)" },
  { value: "partner", label: "파트너" },
  { value: "government", label: "정부/공공기관" },
  { value: "other", label: "기타" },
];

export function PartnerQuickCreate({ companyId, initialName = "", initialBizNo = "", defaultType = "client", existing = [], onCreated, onPickExisting, onClose }: {
  companyId: string;
  initialName?: string;
  initialBizNo?: string;
  /** 매출 전표에서 열면 client, 매입이면 vendor 로 미리 고른다 */
  defaultType?: string;
  /** 중복 확인용 — 화면이 이미 들고 있는 거래처 목록 */
  existing?: QuickPartner[];
  onCreated: (p: QuickPartner) => void;
  /** 중복이 있을 때 "기존 거래처 쓰기" — 없으면 안내만 */
  onPickExisting?: (p: QuickPartner) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [bizNo, setBizNo] = useState(initialBizNo);
  const [type, setType] = useState(defaultType);
  const [representative, setRepresentative] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const dup = useMemo(() => {
    const n = name.trim().toLowerCase();
    const b = normalizeBizNo(bizNo);
    return existing.find((p) => (b && normalizeBizNo(p.business_number) === b) || (n && p.name.trim().toLowerCase() === n)) || null;
  }, [name, bizNo, existing]);

  const submit = async () => {
    const nm = name.trim();
    if (!nm) { setErr("거래처명을 입력해 주세요."); return; }
    const b = bizNo.replace(/\D/g, "");
    if (b && b.length !== 10) { setErr("사업자등록번호는 숫자 10자리입니다."); return; }
    setSaving(true); setErr(null);
    try {
      const row = await upsertPartner({
        companyId, name: nm, type,
        businessNumber: b || undefined,
        representative: representative.trim() || undefined,
        contactPhone: phone.trim() || undefined,
        isActive: true,
      }) as any;
      onCreated({ id: row.id, code: row.code ?? null, name: row.name, business_number: row.business_number ?? null, type: row.type ?? null });
    } catch (e) {
      setErr(friendlyError(e, "거래처를 등록하지 못했습니다."));
    } finally { setSaving(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box pqc-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="새 거래처 등록">
        <div className="inv-modal-head">
          <h3 className="inv-modal-title">새 거래처 등록</h3>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="pqc-body">
          <div className="text-[11px] text-[var(--text-dim)]">전표에 필요한 것만 받습니다. 주소·담당자·계좌 등은 나중에 <b>거래처</b> 화면에서 보완하면 됩니다.</div>
          <div>
            <label className="field-label">거래처명 *</label>
            <input autoFocus className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: (주)모티브이노베이션"
              onKeyDown={(e) => { if (e.key === "Enter" && !saving) void submit(); }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">사업자등록번호</label>
              <input className="field-input" value={bizNo} inputMode="numeric" onChange={(e) => setBizNo(e.target.value.replace(/[^\d-]/g, "").slice(0, 12))} placeholder="000-00-00000"
                onKeyDown={(e) => { if (e.key === "Enter" && !saving) void submit(); }} />
            </div>
            <div>
              <label className="field-label">유형</label>
              <select className="field-input" value={type} onChange={(e) => setType(e.target.value)}>
                {PARTNER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">대표자</label>
              <input className="field-input" value={representative} onChange={(e) => setRepresentative(e.target.value)} placeholder="선택" />
            </div>
            <div>
              <label className="field-label">연락처</label>
              <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="선택" />
            </div>
          </div>
          {dup && (
            <div className="pqc-dup">
              이미 등록된 거래처가 있습니다: <b>{dup.name}</b>{dup.business_number ? ` (${dup.business_number})` : ""}{dup.code != null ? ` · 코드 ${dup.code}` : ""}
              {onPickExisting && <button type="button" className="btn-secondary btn-sm ml-2" onClick={() => onPickExisting(dup)}>이 거래처 쓰기</button>}
            </div>
          )}
          {err && <div className="text-[11px] font-semibold" style={{ color: "var(--danger)" }}>{err}</div>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={saving}>취소</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? "등록 중…" : dup ? "그래도 새로 등록" : "등록하고 선택"}
          </button>
        </div>
      </div>
    </div>
  );
}

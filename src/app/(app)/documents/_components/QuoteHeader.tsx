"use client";

// 견적서 헤더 입력 — 거래처/거래유형/담당자/부서/결제조건/유효기간/참조/출하창고.
//   값은 content_json.header(object)에 저장. 거래처명/결제조건/유효기간은 문서 변수로도 반영.
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

export type QuoteHeaderData = {
  partnerId?: string;
  partnerName?: string;
  taxType?: "taxable" | "exempt" | "zero";
  manager?: string;
  department?: string;
  paymentTerms?: string;
  validUntil?: string;
  reference?: string;
  warehouse?: string;
  deliveryTerms?: string;
};

export const TAX_TYPE_LABEL: Record<string, string> = {
  taxable: "부가세 적용 (10%)",
  exempt: "부가세 미적용",
  zero: "영세율 (0%)",
};

const LB = "text-[11px] text-[var(--text-muted)] w-16 shrink-0";
const IN = "flex-1 h-8 px-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] disabled:opacity-60";

export function QuoteHeader({
  header, onChange, companyId, editable,
}: { header: QuoteHeaderData; onChange: (h: QuoteHeaderData) => void; companyId: string | null; editable: boolean }) {
  const [partners, setPartners] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [pSearch, setPSearch] = useState("");
  const [pOpen, setPOpen] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (async () => {
      const [{ data: ps }, { data: us }] = await Promise.all([
        (supabase as any).from("partners").select("id, name, business_number").eq("company_id", companyId).eq("is_active", true).order("name"),
        (supabase as any).from("users").select("id, name").eq("company_id", companyId),
      ]);
      if (!alive) return;
      setPartners(ps || []);
      setUsers(us || []);
    })();
    return () => { alive = false; };
  }, [companyId]);

  const set = (patch: Partial<QuoteHeaderData>) => onChange({ ...header, ...patch });
  const filtered = useMemo(
    () => partners.filter((p) => !pSearch || p.name?.toLowerCase().includes(pSearch.toLowerCase()) || (p.business_number || "").includes(pSearch)).slice(0, 10),
    [partners, pSearch],
  );

  const field = (label: string, node: React.ReactNode) => (
    <div className="flex items-center gap-2">
      <span className={LB}>{label}</span>
      {node}
    </div>
  );

  return (
    <div className="glass-card p-4 mb-3">
      <div className="text-xs text-[var(--text-dim)] font-medium mb-3">견적 정보</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
        {/* 거래처 — 검색 */}
        <div className="flex items-center gap-2 relative">
          <span className={LB}>거래처</span>
          <div className="flex-1 relative">
            <input
              value={header.partnerName || ""}
              disabled={!editable}
              onChange={(e) => { set({ partnerName: e.target.value, partnerId: "" }); setPSearch(e.target.value); setPOpen(true); }}
              onFocus={() => editable && setPOpen(true)}
              onBlur={() => setTimeout(() => setPOpen(false), 200)}
              placeholder="거래처 검색/입력"
              className={IN}
            />
            {pOpen && editable && filtered.length > 0 && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg max-h-44 overflow-y-auto">
                {filtered.map((p) => (
                  <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { set({ partnerId: p.id, partnerName: p.name }); setPOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface)] text-xs flex items-center justify-between">
                    <span className="font-medium">{p.name}</span>
                    {p.business_number && <span className="text-[10px] text-[var(--text-dim)]">{p.business_number}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 거래유형 */}
        {field("거래유형", (
          <select value={header.taxType || "taxable"} disabled={!editable} onChange={(e) => set({ taxType: e.target.value as any })} className={IN}>
            <option value="taxable">부가세 적용 (10%)</option>
            <option value="exempt">부가세 미적용</option>
            <option value="zero">영세율 (0%)</option>
          </select>
        ))}

        {/* 담당자 */}
        {field("담당자", (
          users.length > 0 ? (
            <select value={header.manager || ""} disabled={!editable} onChange={(e) => set({ manager: e.target.value })} className={IN}>
              <option value="">선택</option>
              {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          ) : (
            <input value={header.manager || ""} disabled={!editable} onChange={(e) => set({ manager: e.target.value })} placeholder="담당자" className={IN} />
          )
        ))}

        {/* 부서 */}
        {field("부서", <input value={header.department || ""} disabled={!editable} onChange={(e) => set({ department: e.target.value })} placeholder="부서" className={IN} />)}

        {/* 결제조건 */}
        {field("결제조건", <input value={header.paymentTerms || ""} disabled={!editable} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="예: 월말 현금" className={IN} />)}

        {/* 유효기간 */}
        {field("유효기간", <input value={header.validUntil || ""} disabled={!editable} onChange={(e) => set({ validUntil: e.target.value })} placeholder="예: 견적일로부터 30일" className={IN} />)}

        {/* 납품조건 */}
        {field("납품조건", <input value={header.deliveryTerms || ""} disabled={!editable} onChange={(e) => set({ deliveryTerms: e.target.value })} placeholder="예: 계약 후 2주" className={IN} />)}

        {/* 출하창고 */}
        {field("출하창고", <input value={header.warehouse || ""} disabled={!editable} onChange={(e) => set({ warehouse: e.target.value })} placeholder="출하창고" className={IN} />)}

        {/* 참조 */}
        {field("참조", <input value={header.reference || ""} disabled={!editable} onChange={(e) => set({ reference: e.target.value })} placeholder="참조" className={IN} />)}
      </div>
    </div>
  );
}

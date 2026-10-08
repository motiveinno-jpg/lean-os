"use client";

// ── 부가세 전자신고 파일 팝업 (베타, 2026-10-08 ERP 3차 D · 게이트 tax_efile_vat) ──
//   확정은 사람: 파일을 받아 홈택스 '신고서 파일 변환'에서 검증·제출한다. 첫 신고는 세무사 확인 후.
//   업종코드는 회사 정보에 칸이 없어 여기서 받는다 — 회사 상수라 이 브라우저에 기억한다(조회 조건이 아니라 설정값).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { downloadNtsBytes, type NtsIssue } from "@/lib/nts-efile";
import { buildVatEfile } from "@/lib/nts-vat-efile";
import { fetchVatRows, VAT_PERIODS, type VatPeriodKey } from "@/app/(app)/reports/vat/_components/VatReturn";

const read = (k: string) => { try { return window.localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* 시크릿 등 */ } };

export function VatEfileDialog({ companyId, year, period, onClose }: { companyId: string; year: number; period: VatPeriodKey; onClose: () => void }) {
  const { toast } = useToast();
  useModalKeys(true, onClose);
  const P = VAT_PERIODS.find((p) => p.key === period)!;
  const from = `${year}-${P.from}`, to = `${year}-${P.to}`;
  const [hometaxId, setHometaxId] = useState("");
  const [industryCode, setIndustryCode] = useState("");
  useEffect(() => { setHometaxId(read(`ov.hometax-id.${companyId}`)); setIndustryCode(read(`ov.industry-code.${companyId}`)); }, [companyId]);
  const [issues, setIssues] = useState<NtsIssue[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  const { data: company } = useQuery({
    queryKey: ["efile-company-vat", companyId],
    queryFn: async () => (logRead("vat-efile:company", await (supabase as any).from("companies")
      .select("name, business_number, representative, address, phone, business_type, business_category").eq("id", companyId).maybeSingle())) as
      { name: string; business_number: string | null; representative: string | null; address: string | null; phone: string | null; business_type: string | null; business_category: string | null } | null,
  });
  const { data: rows, isLoading } = useQuery({ queryKey: ["vat-return-rows", companyId, from, to], queryFn: () => fetchVatRows(companyId, from, to) });

  const make = () => {
    if (!company || !rows) return;
    write(`ov.hometax-id.${companyId}`, hometaxId.trim());
    write(`ov.industry-code.${companyId}`, industryCode.trim());
    const r = buildVatEfile({
      bizNo: company.business_number || "", hometaxId, companyName: company.name || "", ceoName: company.representative || "",
      address: company.address || "", phone: company.phone || "",
      bizType: company.business_type || "", bizItem: company.business_category || "", industryCode,
      year, period, from, to, madeOn: todayKst(),
      rows: rows.map((x) => ({ vatType: String(x.vat_type || ""), supply: x.supply_amount, vat: x.vat_amount, electronic: x.electronic, partnerBizno: x.partnerBizno, partnerName: x.partnerName })),
    });
    setIssues(r.issues); setNotes(r.notes);
    if (r.bytes) {
      downloadNtsBytes(r.bytes, r.fileName);
      toast(`${r.fileName} 을 내려받았습니다. 홈택스 › 신고서 파일 변환에서 검증·제출하세요`, "success");
    }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">부가세 전자신고 파일 (베타)</h3>
        <p className="inv-modal-desc" title="수정신고·기한후신고·조기환급·간이과세·부속서류가 필요한 경우는 홈택스에서 직접 합니다">
          {year}년 {P.label} 신고서를 홈택스 <b>신고서 파일 변환</b> 업로드용 파일로 만듭니다. 확정 매입매출전표 기준이며 <b>첫 신고는 세무사 확인 후 제출</b>하세요.
        </p>
        <div className="vef-fields">
          <label className="vef-field"><span>홈택스 사용자ID</span>
            <input className="inv-input" value={hometaxId} onChange={(e) => setHometaxId(e.target.value)} placeholder="홈택스에 로그인하는 ID" maxLength={20} /></label>
          <label className="vef-field"><span>주업종코드 6자리</span>
            <input className="inv-input mono-number" value={industryCode} onChange={(e) => setIndustryCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="예: 743002" inputMode="numeric" /></label>
        </div>
        <p className="inv-hint">
          {company
            ? <>사업자번호 <b className="mono-number">{company.business_number || "(없음)"}</b> · 상호 <b>{company.name}</b> · 대표 <b>{company.representative || "(없음)"}</b> · 업태 <b>{company.business_type || "(없음)"}</b> · 종목 <b>{company.business_category || "(없음)"}</b>. 업종코드는 사업자등록증명이나 홈택스 사업자 정보에 있습니다.</>
            : "회사 정보를 읽는 중…"}
        </p>
        <p className="inv-hint">{isLoading ? "전표를 읽는 중…" : `확정 매입매출전표 ${rows?.length ?? 0}건 · ${from} ~ ${to}`}</p>
        {notes.length > 0 && <ul className="vef-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        {issues.length > 0 && (
          <div className="vef-issues">
            <b>파일을 만들 수 없습니다</b>
            <ul>{issues.map((x, k) => <li key={k}><b>{x.field}</b> · {x.message}</li>)}</ul>
          </div>
        )}
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={!company || !rows} onClick={make}>파일 만들기</button>
        </div>
      </div>
    </div>
  );
}

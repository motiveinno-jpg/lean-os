"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function TaxAutomationTab({ companyId }: { companyId: string | null }) {
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({ auto_issue_on_deal_close: true, auto_issue_on_payment: false, auto_email_send: false, issue_schedule: "immediate", auto_cancel_on_refund: true, auto_cancel_on_deal_cancel: true, vat_auto_aggregate: true, advance_ratio: 30, matching_tolerance: 1 });
  const { data: companySettings } = useQuery({
    queryKey: ["tax-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("tax_settings").eq("id", companyId).maybeSingle(); return data?.tax_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => {
    if (!companySettings) return;
    // 알려진 필드만 추려서 적용 — 죽은 hometax_* 필드는 무시
    setSettings((prev) => ({
      ...prev,
      auto_issue_on_deal_close: companySettings.auto_issue_on_deal_close ?? prev.auto_issue_on_deal_close,
      auto_issue_on_payment: companySettings.auto_issue_on_payment ?? prev.auto_issue_on_payment,
      auto_email_send: companySettings.auto_email_send ?? prev.auto_email_send,
      issue_schedule: companySettings.issue_schedule ?? prev.issue_schedule,
      auto_cancel_on_refund: companySettings.auto_cancel_on_refund ?? prev.auto_cancel_on_refund,
      auto_cancel_on_deal_cancel: companySettings.auto_cancel_on_deal_cancel ?? prev.auto_cancel_on_deal_cancel,
      vat_auto_aggregate: companySettings.vat_auto_aggregate ?? prev.vat_auto_aggregate,
      advance_ratio: companySettings.advance_ratio ?? prev.advance_ratio,
      matching_tolerance: companySettings.matching_tolerance ?? prev.matching_tolerance,
    }));
  }, [companySettings]);
  async function saveTaxSettings() {
    if (!companyId) return;
    // 기존 tax_settings 와 머지하여 다른 키(예: 외부 시스템에서 쓰는 값)는 보존
    const merged = { ...(companySettings || {}), ...settings };
    // 죽은 hometax 필드는 명시적으로 제거 (사용자 혼란 방지)
    delete (merged as any).hometax_id;
    delete (merged as any).hometax_password;
    delete (merged as any).hometax_login_method;
    delete (merged as any).hometax_cert_password;
    await db2.from("companies").update({ tax_settings: merged }).eq("id", companyId);
    queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  const Tog = ({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
      <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-[var(--text-dim)] mt-0.5">{desc}</div></div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 rounded accent-[var(--primary)]" />
    </label>
  );
  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h2 className="section-title">세금계산서 자동발행</h2>
        <div className="space-y-3">
          <Tog label="프로젝트 완료 시 자동발행" desc="계약 완료 시 매출 세금계산서 자동 생성" checked={settings.auto_issue_on_deal_close} onChange={(v) => setSettings({ ...settings, auto_issue_on_deal_close: v })} />
          <Tog label="결제 완료 시 자동발행" desc="이체 완료 시 매입 세금계산서 자동 생성" checked={settings.auto_issue_on_payment} onChange={(v) => setSettings({ ...settings, auto_issue_on_payment: v })} />
          <Tog label="자동 이메일 발송" desc="발행된 세금계산서를 거래처에 자동 전송" checked={settings.auto_email_send} onChange={(v) => setSettings({ ...settings, auto_email_send: v })} />
          <div><label className="field-label">발행 주기</label><select value={settings.issue_schedule} onChange={(e) => setSettings({ ...settings, issue_schedule: e.target.value })} className="field-input"><option value="immediate">거래 즉시</option><option value="weekly">매주 월요일</option><option value="monthly">매월 말일</option></select></div>
        </div>
      </div>
      <div className="glass-card p-6">
        <h2 className="section-title">취소/수정 규칙</h2>
        <div className="space-y-3">
          <Tog label="환불 시 수정세금계산서" desc="환불 발생 시 수정본 자동 발행" checked={settings.auto_cancel_on_refund} onChange={(v) => setSettings({ ...settings, auto_cancel_on_refund: v })} />
          <Tog label="계약 취소 시 자동 취소" desc="프로젝트 취소 시 관련 세금계산서 void 처리" checked={settings.auto_cancel_on_deal_cancel} onChange={(v) => setSettings({ ...settings, auto_cancel_on_deal_cancel: v })} />
        </div>
      </div>
      <div className="glass-card p-6">
        <h2 className="section-title">결제/매칭 설정</h2>
        <div className="space-y-4">
          <div>
            <label className="field-label">선금 비율 (%)</label>
            <p className="text-[10px] text-[var(--text-dim)] mb-1">계약 승인 시 선금/잔금 자동 분할 비율 (예: 30 → 선금 30%, 잔금 70%)</p>
            <input type="number" min="0" max="100" value={settings.advance_ratio} onChange={(e) => setSettings({ ...settings, advance_ratio: Number(e.target.value) || 30 })} className="field-input" />
          </div>
          <div>
            <label className="field-label">3-way 매칭 허용오차 (%)</label>
            <p className="text-[10px] text-[var(--text-dim)] mb-1">계약↔세금계산서↔입금 비교 시 허용할 금액 차이 비율</p>
            <input type="number" min="0" max="10" step="0.1" value={settings.matching_tolerance} onChange={(e) => setSettings({ ...settings, matching_tolerance: Number(e.target.value) || 1 })} className="field-input" />
          </div>
        </div>
      </div>
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="kpi-icon success text-lg">🏛️</span>
          <div>
            <h2 className="text-sm font-bold">홈택스 연동</h2>
            <p className="text-xs text-[var(--text-dim)]">국세청 홈택스와 연동하여 세금계산서 자동 조회</p>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            홈택스 인증정보 등록은 <b className="text-[var(--text)]">설정 &gt; 은행연동 탭 → 금융기관 연결 → 홈택스</b>에서 통합 관리합니다.
            (공동인증서 또는 ID/PW 방식 모두 지원)
          </p>
          <a
            href="?tab=bank"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-2 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 border border-[var(--primary)]/30 rounded-lg text-xs font-semibold text-[var(--primary)] transition"
          >
            은행연동 탭으로 이동 →
          </a>
        </div>
        <label className="flex items-center gap-2 mt-4 text-xs text-[var(--text-muted)]"><input type="checkbox" checked={settings.vat_auto_aggregate} onChange={(e) => setSettings({ ...settings, vat_auto_aggregate: e.target.checked })} className="rounded" /> 부가세 자동 집계 (매 분기별)</label>
      </div>
      <button onClick={saveTaxSettings} className="btn-primary w-full">{saved ? "저장 완료" : "세무자동화 설정 저장"}</button>
    </div>
  );
}

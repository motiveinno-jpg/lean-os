"use client";

// 프로젝트 매출 기본 계정 (2026-08-31 프로젝트 개편 3단계, 기획 결정 6-4 안전판)
//   계약이 양측 서명 완료되면 판매전표를 자동 발행한다 — 단, 어떤 매출 계정으로 잡을지는
//   회사가 정하는 값이라 여기서 고른다. 설정 전에는 자동 발행 대신 '발행 준비됨' 알림만 간다.
//   저장 위치: company_settings.settings.project_sales_account (inventory-cost 의 jsonb merge 패턴)

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";

const db = supabase as any;

type Setting = { account_id: string; vat_type: "taxable" | "exempt" } | null;

export function ProjectSalesAccountCard({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["set-rev-accounts", companyId],
    queryFn: async () => (logRead("settings:rev-accounts", await db.from("chart_of_accounts")
      .select("id, code, name").eq("company_id", companyId).eq("account_type", "revenue")
      .order("code")) || []) as { id: string; code: string; name: string }[],
  });

  const { data: saved } = useQuery({
    queryKey: ["set-proj-sales-acct", companyId],
    queryFn: async () => {
      const row = logRead("settings:proj-sales", await db.from("company_settings")
        .select("id, settings").eq("company_id", companyId).maybeSingle());
      return { id: (row as any)?.id as string | undefined, cur: ((row as any)?.settings?.project_sales_account || null) as Setting };
    },
  });

  const [accountId, setAccountId] = useState("");
  const [vatType, setVatType] = useState<"taxable" | "exempt">("taxable");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (saved?.cur) { setAccountId(saved.cur.account_id || ""); setVatType(saved.cur.vat_type === "exempt" ? "exempt" : "taxable"); }
  }, [saved?.cur]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // jsonb merge — 다른 설정 키를 절대 덮지 않는다 (inventory-cost saveCostingMethod 와 동일 패턴)
      const { data: row } = await db.from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
      const prev = ((row as any)?.settings as Record<string, unknown>) || {};
      const settings = {
        ...prev,
        project_sales_account: accountId ? { account_id: accountId, vat_type: vatType } : null,
      };
      if ((row as any)?.id) {
        const { error } = await db.from("company_settings").update({ settings }).eq("id", (row as any).id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from("company_settings").insert({ company_id: companyId, settings });
        if (error) throw new Error(error.message);
      }
      toast(accountId
        ? "저장했습니다 — 이제 계약이 양측 서명 완료되면 이 계정으로 판매전표가 자동 발행됩니다"
        : "설정을 비웠습니다 — 서명 완료 시 자동 발행 대신 '발행 준비됨' 알림만 갑니다");
      qc.invalidateQueries({ queryKey: ["set-proj-sales-acct", companyId] });
    } catch (e: any) {
      toast(`저장 실패: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="proj-sales-card">
      <div className="proj-sales-head">
        <h3 className="proj-sales-title">프로젝트 매출 기본 계정</h3>
        <span className="proj-sales-sub">계약이 양측 서명 완료되면 이 계정으로 판매전표를 자동 발행합니다 — 비워 두면 발행하지 않고 &apos;발행 준비됨&apos; 알림만 갑니다(세금계산서는 언제나 초안까지 — 국세청 전송은 사람이).</span>
      </div>
      <div className="proj-sales-row">
        <select className="proj-sales-field" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="매출 계정">
          <option value="">사용 안 함 — 알림만 (기본값)</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
        </select>
        <select className="proj-sales-field" value={vatType} onChange={(e) => setVatType(e.target.value as "taxable" | "exempt")} aria-label="부가세">
          <option value="taxable">과세 — 공급가(계약금액)에 부가세 10% 별도</option>
          <option value="exempt">면세 — 부가세 0</option>
        </select>
        <button type="button" className="btn-secondary btn-sm" disabled={saving} onClick={save}>저장</button>
      </div>
    </div>
  );
}

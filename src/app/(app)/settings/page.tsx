"use client";
import { logRead } from "@/lib/log-read";
import { useMyPermissions } from "@/lib/permissions";
import { Ico } from "@/components/ui-icon";

import React, { useEffect, useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getBankAccounts, upsertBankAccount, deleteBankAccount, getRoutingRules, upsertRoutingRule } from "@/lib/queries";
import { COST_TYPES, BANK_ROLES } from "@/lib/routing";
import { ChartOfAccountsManager } from "@/components/chart-of-accounts-manager";
import type { BankAccount } from "@/types/models";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { QueryErrorBanner } from "@/components/query-status";
import { AccessDenied } from "@/components/access-denied";
import HrAttendanceSettingsPanel from "@/components/hr-attendance-settings";
import { TaxAutomationTab } from "./_components/TaxAutomationTab";
import { BankIntegrationTab } from "./_components/BankIntegrationTab";
import { AdAccountsTab } from "./_components/AdAccountsTab";
import { TeamManagement } from "./_components/TeamManagement";
import { DepartmentsTab } from "./_components/DepartmentsTab";
import { FormTemplateManager } from "@/components/form-template-manager";
import { DealClassificationManager } from "./_components/DealClassificationManager";
import { CompanyDeleteTab } from "./_components/CompanyDeleteTab";
import { CompanyInfoTab } from "./_components/CompanyInfoTab";
import { AccountingClosingTab } from "./_components/AccountingClosingTab";
// 계정·알림(개인)은 마이페이지로 이관됨(2026-07-08) — 여기선 import/렌더 제거.

// ── 2026-08-12 회사 설정 리디자인(사장님: 중복 제거 + 최신 레이아웃) ──
//    · 2단 가로 탭 → 좌측 세로 네비(데스크톱) / 가로 스크롤 필(모바일)
//    · '승인·결재' 탭 제거 — 결재 허브 > 정책 관리와 같은 approval_policies 를 다루는
//      구버전 중복이었다(참조·팀 지정 없음). 옛 딥링크는 결재 허브로 보낸다.
//    · 탭마다 제목+설명 헤더를 셸에서 일관 렌더.
type LeafKey =
  | "company-info" | "team"                       // 회사 기본
  | "cash" | "chart" | "closing" | "tax"          // 회계·세무
  | "bank" | "ads"                                // 연동·인증
  | "departments" | "attendance"                  // 인사·근태
  | "deal" | "forms"                              // 업무 규칙
  | "delete-company";                             // 시스템 (회사 삭제 — 마스터 전용)

const SETTINGS_GROUPS: { key: string; label: string; icon: string; tabs: { key: LeafKey; label: string; masterOnly?: boolean }[] }[] = [
  { key: "basic", label: "회사 기본", icon: "M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2", tabs: [
    { key: "company-info", label: "회사정보" },
    { key: "team", label: "팀·권한" },
  ] },
  { key: "accounting", label: "회계·세무", icon: "M9 7h6m-6 4h6m-6 4h4M5 3h14a1 1 0 011 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 011-1z", tabs: [
    { key: "cash", label: "자금·통장" },
    { key: "chart", label: "계정과목" },
    { key: "closing", label: "회계마감" },
    { key: "tax", label: "세무자동화" },
  ] },
  { key: "integration", label: "연동·인증", icon: "M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5", tabs: [
    { key: "bank", label: "은행연동" },
    { key: "ads", label: "광고 계정" },
  ] },
  { key: "hr", label: "인사·근태", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", tabs: [
    { key: "departments", label: "부서" },
    { key: "attendance", label: "근태·가산수당" },
  ] },
  { key: "rules", label: "업무 규칙", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", tabs: [
    { key: "deal", label: "딜 분류" },
    { key: "forms", label: "회사 양식" },
  ] },
  { key: "system", label: "시스템", icon: "M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m-1 0v14a1 1 0 01-1 1H9a1 1 0 01-1-1V6", tabs: [
    // 회사 자체를 지우는 탭 — 권한을 부여받은 멤버에게도 절대 노출하지 않는다(마스터 전용).
    //   '데이터 관리(초기화)' 는 2026-08-10 사장님 지시로 제거 — 회사 삭제만 남긴다.
    { key: "delete-company", label: "회사 삭제", masterOnly: true },
  ] },
];
const ALL_LEAVES: LeafKey[] = SETTINGS_GROUPS.flatMap((g) => g.tabs.map((t) => t.key));

// 콘텐츠 헤더 — 탭마다 무엇을 하는 곳인지 한 줄로. danger 는 붉은 톤.
const LEAF_META: Record<LeafKey, { title: string; desc: string; danger?: boolean }> = {
  "company-info": { title: "회사정보", desc: "사업자 정보와 대표 연락처, 세무 파트너 연결을 관리합니다." },
  team: { title: "팀·권한", desc: "구성원 초대와 합류 요청 승인, 메뉴·세부탭 권한을 관리합니다." },
  cash: { title: "자금·통장", desc: "가용 현금 집계와 미연동 통장, 비용 유형별 지급 통장을 설정합니다." },
  chart: { title: "계정과목", desc: "장부 분류에 쓰는 계정과목 체계를 관리합니다." },
  closing: { title: "회계마감", desc: "회계 마감시점과 계정별 기초잔액을 관리합니다." },
  tax: { title: "세무자동화", desc: "세금계산서 자동발행과 거래처 자동 전송을 설정합니다." },
  bank: { title: "은행연동", desc: "공동인증서로 은행·카드·홈택스 자동 수집을 연결합니다." },
  ads: { title: "광고 계정", desc: "광고 매체 API 키를 한 곳에 등록하고 프로젝트에서 골라 씁니다." },
  departments: { title: "부서", desc: "조직 부서를 만들고 구성원을 배치합니다." },
  attendance: { title: "근태·가산수당", desc: "출퇴근 기준 시각과 유예, 가산수당 규칙을 정합니다." },
  deal: { title: "딜 분류", desc: "거래 장부에 쓰는 딜 분류 체계를 관리합니다." },
  forms: { title: "회사 양식", desc: "회사 공용 PDF 양식을 등록하고 관리합니다." },
  "delete-company": { title: "회사 삭제", desc: "회사와 모든 데이터를 영구 삭제합니다. 되돌릴 수 없습니다.", danger: true },
};

// 옛 ?tab= 딥링크 호환 — 재편 전 키를 새 leaf 로 매핑. 다른 화면으로 이관된 키는 그 주소로 보낸다.
const TAB_COMPAT: Record<string, LeafKey> = {
  general: "team",          // 합류요청 알림이 팀관리(승인 UI)로 연결되던 링크
  company: "company-info", bank: "bank", tax: "tax",
  certificate: "bank", hr_attendance: "attendance", danger: "delete-company", data: "delete-company",
};
const TAB_MOVED: Record<string, string> = {
  account: "/mypage", notifications: "/mypage",          // 개인 설정 — 마이페이지로 이관(2026-07-08)
  approval: "/approvals?tab=policies",                    // 결재 정책 — 결재 허브로 일원화(2026-08-12)
};
function groupOfLeaf(leaf: LeafKey): string {
  return SETTINGS_GROUPS.find((g) => g.tabs.some((t) => t.key === leaf))?.key || "basic";
}

export default function SettingsPage() {
  const { role } = useUser();
  // 권한 게이트에서 early return 한 뒤에 나머지 훅들이 이어지면 role 이 바뀌는 렌더에서
  // 훅 개수가 달라져 React #310 크래시 — 본문을 별도 컴포넌트로 분리 (2026-08-03).
  if (role === "partner" /* (P3) 멤버는 권한 게이트가 판정 */) {
    return <AccessDenied detail="회사 설정은 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }
  return <SettingsPageInner />;
}

function SettingsPageInner() {
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams?.get("tab") || "";
  // 다른 화면으로 이관된 옛 키(계정·알림·결재정책) → 그 주소로 리다이렉트
  useEffect(() => {
    if (rawTab && TAB_MOVED[rawTab]) router.replace(TAB_MOVED[rawTab]);
  }, [rawTab, router]);
  const initialTab: LeafKey = (() => {
    if (ALL_LEAVES.includes(rawTab as LeafKey)) return rawTab as LeafKey;
    const mapped = TAB_COMPAT[rawTab];
    if (mapped) return mapped;
    return "company-info";
  })();
  const [tab, setTabState] = useState<LeafKey>(initialTab);
  // 탭 변경 시 URL ?tab= 동기화(북마크·뒤로가기 유지, 페이지 리로드 없음)
  const setTab = (next: LeafKey) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    }
  };
  // (2026-07-30 개편 P3) 설정 세부탭 권한 게이트 — 마스터=전체, 멤버=부여(/settings:leaf)만
  const { isMaster: permMaster, hasPerm: permHas } = useMyPermissions();
  const visibleGroups = SETTINGS_GROUPS
    .map((g) => ({ ...g, tabs: g.tabs.filter((t) => t.masterOnly ? permMaster : (permMaster || permHas(`/settings:${t.key}`))) }))
    .filter((g) => g.tabs.length > 0);
  const firstAllowedLeaf = visibleGroups[0]?.tabs[0]?.key;
  useEffect(() => {
    const allowed = visibleGroups.some((g) => g.tabs.some((t) => t.key === tab));
    if (!allowed && firstAllowedLeaf) setTabState(firstAllowedLeaf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, permMaster, firstAllowedLeaf, visibleGroups.map((g) => g.tabs.map((t) => t.key).join()).join()]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [balance, setBalance] = useState("");
  const [fixedCost, setFixedCost] = useState("");
  const [saved, setSaved] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: "", account_number: "", alias: "", role: "OPERATING", balance: "", is_primary: false });
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ cost_type: "default", bank_account_id: "" });
  const queryClient = useQueryClient();
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then(async (u) => {
      if (!u) { setPageLoading(false); return; }
      setCompanyId(u.company_id);
      const data = logRead('settings/page:data', await supabase
        .from("cash_snapshot")
        .select("*")
        .eq("company_id", u.company_id)
        .maybeSingle());
      if (data) {
        setBalance(String(data.current_balance || 0));
        setFixedCost(String(data.monthly_fixed_cost || 0));
      }
      setPageLoading(false);
    }).catch(() => setPageLoading(false));
  }, []);

  const { data: bankAccounts = [], error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId!),
    enabled: !!companyId,
  });

  const { data: routingRules = [] } = useQuery({
    queryKey: ["routing-rules", companyId],
    queryFn: () => getRoutingRules(companyId!),
    enabled: !!companyId,
  });

  const addBankMut = useMutation({
    mutationFn: () => upsertBankAccount({
      company_id: companyId!,
      bank_name: bankForm.bank_name.trim(),
      account_number: bankForm.account_number.trim(),
      alias: bankForm.alias.trim(),
      role: bankForm.role,
      balance: Number(bankForm.balance) || 0,
      is_primary: bankForm.is_primary,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowBankForm(false);
      setBankForm({ bank_name: "", account_number: "", alias: "", role: "OPERATING", balance: "", is_primary: false });
    },
    onError: (err: any) => toast("계좌 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteBankMut = useMutation({
    mutationFn: (id: string) => deleteBankAccount(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-accounts"] }),
    onError: (err: any) => toast(`삭제 실패: ${err.message || err}`, "error"),
  });

  const addRuleMut = useMutation({
    mutationFn: () => upsertRoutingRule({
      company_id: companyId!,
      cost_type: ruleForm.cost_type,
      bank_account_id: ruleForm.bank_account_id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      setShowRuleForm(false);
      setRuleForm({ cost_type: "default", bank_account_id: "" });
    },
    onError: (err: any) => toast(`규칙 저장 실패: ${err.message || err}`, "error"),
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowBankForm(false); setShowRuleForm(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function save() {
    if (!companyId) return;
    const { error } = await supabase.from("cash_snapshot").upsert({
      company_id: companyId,
      current_balance: Number(balance) || 0,
      monthly_fixed_cost: Number(fixedCost) || 0,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast(`저장 실패: ${error.message}`, "error");
      return;
    }
    setSaved(true);
    toast("현금 현황이 저장되었습니다. 대시보드에 즉시 반영됩니다.", "success");
    // 대시보드 즉시 갱신 — refetchQueries 로 캐시 무관 강제 fetch
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["cash-pulse"] }),
      queryClient.refetchQueries({ queryKey: ["real-burn"] }),
      queryClient.refetchQueries({ queryKey: ["founder-data"] }),
    ]);
    setTimeout(() => setSaved(false), 2000);
  }

  const totalBankBalance = bankAccounts.reduce((s: number, a: BankAccount) => s + Number(a.balance || 0), 0);
  const totalCash = totalBankBalance + (Number(balance) || 0);
  const runwayMonths = totalCash > 0 && Number(fixedCost) > 0 ? totalCash / Number(fixedCost) : null;

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">설정 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const meta = LEAF_META[tab];

  return (
    <div className="stg-shell">
      {/* ── 좌측 세로 네비 (데스크톱) ── */}
      <nav className="stg-nav">
        {visibleGroups.map((g) => (
          <div key={g.key}>
            <div className="stg-nav-group-label">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d={g.icon} /></svg>
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.tabs.map((t) => {
                const active = tab === t.key;
                const danger = !!LEAF_META[t.key].danger;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`stg-nav-item ${danger ? (active ? "stg-nav-item-danger-on" : "stg-nav-item-danger") : active ? "stg-nav-item-on" : ""}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── 모바일 네비 — 가로 스크롤, 그룹 경계는 세퍼레이터 ── */}
      <div className="stg-nav-m">
        {visibleGroups.map((g, gi) => (
          <React.Fragment key={g.key}>
            {gi > 0 && <span className="stg-nav-m-sep" aria-hidden />}
            {g.tabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  ref={(el) => { if (el && active) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }}
                  onClick={() => setTab(t.key)}
                  className={`stg-nav-m-item ${active ? (LEAF_META[t.key].danger ? "stg-nav-m-item-danger-on" : "stg-nav-m-item-on") : ""}`}
                >
                  {t.label}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* ── 콘텐츠 ── */}
      <div className="stg-main">
        <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

        {meta && (
          <header className="stg-head">
            <h2 className={`stg-head-title ${meta.danger ? "text-[var(--danger)]" : ""}`}>{meta.title}</h2>
            <p className="stg-head-desc">{meta.desc}</p>
          </header>
        )}

        {/* ═══ 자금·통장 — 가용 현금 집계 + 미연동 통장 + 비용 라우팅 ═══ */}
        {tab === "cash" && (
          <div className="space-y-5">
            {/* 요약 밴드 — 대시보드 숫자 문법(라벨 위·값 아래) */}
            <div className="stg-statband">
              <div className="stg-stat">
                <div className="stg-stat-label">연동 통장 합산</div>
                <div className="stg-stat-value">₩{totalBankBalance.toLocaleString()}</div>
                <div className="stg-stat-sub">{bankAccounts.length}개 계좌</div>
              </div>
              <div className="stg-stat">
                <div className="stg-stat-label">추가 현금</div>
                <div className="stg-stat-value">₩{(Number(balance) || 0).toLocaleString()}</div>
                <div className="stg-stat-sub">시재금·미연동 계좌</div>
              </div>
              <div className="stg-stat">
                <div className="stg-stat-label">총 가용 현금</div>
                <div className="stg-stat-value" style={{ color: "var(--primary)" }}>₩{totalCash.toLocaleString()}</div>
                <div className="stg-stat-sub">대시보드 반영</div>
              </div>
              <div className="stg-stat">
                <div className="stg-stat-label">예상 생존 개월수</div>
                <div className="stg-stat-value" style={runwayMonths != null ? { color: runwayMonths < 3 ? "var(--danger)" : "var(--success)" } : undefined}>
                  {runwayMonths != null ? `${runwayMonths.toFixed(1)}개월` : "—"}
                </div>
                <div className="stg-stat-sub">총 가용 현금 ÷ 월 고정비</div>
              </div>
            </div>

            {/* 수기 보정 입력 */}
            <section className="stg-card">
              <div className="stg-card-head">
                <div>
                  <h3 className="stg-card-title">현금 현황 보정</h3>
                  <p className="stg-card-desc">연동 밖의 현금과 추가 고정비를 더해 대시보드 수치를 실제에 맞춥니다.</p>
                </div>
              </div>
              <div className="stg-form-grid">
                <div>
                  <label className="field-label">추가 현금 — 시재금 / 미연동 계좌 (원)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={balance ? Number(balance).toLocaleString() : ""}
                    onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    className="field-input"
                  />
                  <p className="stg-field-help">연동되지 않은 통장이나 시재금이 있을 때만 입력합니다.</p>
                </div>
                <div>
                  <label className="field-label">추가 월 고정비 (원)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={fixedCost ? Number(fixedCost).toLocaleString() : ""}
                    onChange={(e) => setFixedCost(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    className="field-input"
                  />
                  <p className="stg-field-help">대시보드 월 고정비 = 반복결제 합 + 직원급여 합 + 이 값. 임대료·보험 등 추가분만 입력합니다.</p>
                </div>
              </div>
              <div className="mt-4">
                <button onClick={save} className="btn-primary">{saved ? "저장 완료" : "저장"}</button>
              </div>
            </section>

            {/* 미연동 통장 (수기) */}
            <section className="stg-card">
              <div className="stg-card-head">
                <div>
                  <h3 className="stg-card-title">미연동 통장</h3>
                  <p className="stg-card-desc">은행연동 밖의 계좌를 수기로 올려 잔고에 합산합니다 · 총 ₩{totalBankBalance.toLocaleString()}</p>
                </div>
                <button onClick={() => setShowBankForm(!showBankForm)} className="btn-secondary btn-sm shrink-0">+ 통장 추가</button>
              </div>

              {showBankForm && (
                <div className="stg-inline-form">
                  <div className="stg-form-grid">
                    <div>
                      <label className="field-label">은행명 *</label>
                      <input
                        value={bankForm.bank_name}
                        onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                        placeholder="국민은행"
                        className="field-input-sm"
                      />
                    </div>
                    <div>
                      <label className="field-label">계좌번호 *</label>
                      <input
                        value={bankForm.account_number}
                        onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })}
                        placeholder="123-456-789012"
                        className="field-input-sm"
                      />
                    </div>
                    <div>
                      <label className="field-label">별칭</label>
                      <input
                        value={bankForm.alias}
                        onChange={(e) => setBankForm({ ...bankForm, alias: e.target.value })}
                        placeholder="메인 운영통장"
                        className="field-input-sm"
                      />
                    </div>
                    <div>
                      <label className="field-label">용도</label>
                      <select
                        value={bankForm.role}
                        onChange={(e) => setBankForm({ ...bankForm, role: e.target.value })}
                        className="field-input-sm"
                      >
                        {BANK_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">잔고 (원)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={bankForm.balance ? Number(bankForm.balance).toLocaleString() : ""}
                        onChange={(e) => setBankForm({ ...bankForm, balance: e.target.value.replace(/[^0-9]/g, "") })}
                        placeholder="0"
                        className="field-input-sm"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <input
                          type="checkbox"
                          checked={bankForm.is_primary}
                          onChange={(e) => setBankForm({ ...bankForm, is_primary: e.target.checked })}
                          className="rounded"
                        />
                        주 통장
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => bankForm.bank_name.trim() && bankForm.account_number.trim() && addBankMut.mutate()}
                      disabled={!bankForm.bank_name.trim() || !bankForm.account_number.trim() || addBankMut.isPending}
                      className="btn-primary"
                    >
                      추가
                    </button>
                    <button onClick={() => setShowBankForm(false)} className="btn-ghost">취소</button>
                  </div>
                </div>
              )}

              {bankAccounts.length === 0 ? (
                <div className="stg-empty">
                  <div className="text-3xl mb-3"><Ico e="🏦" /></div>
                  <div className="stg-empty-t">등록된 통장이 없습니다</div>
                  <div className="stg-empty-d">자동 수집 계좌는 은행연동에서, 그 외 계좌는 &quot;+ 통장 추가&quot;로 올립니다.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bankAccounts.map((acc: BankAccount) => (
                    <div key={acc.id} className="stg-list-row">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{acc.alias || acc.bank_name}</span>
                          {acc.is_primary && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">주</span>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">
                            {BANK_ROLES.find(r => r.value === acc.role)?.label || acc.role}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-dim)] mt-0.5">
                          {acc.bank_name} {acc.account_number}
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        <span className="text-sm font-bold mono-number">₩{Number(acc.balance || 0).toLocaleString()}</span>
                        <button
                          onClick={async () => {
                            const { ok } = await confirm({ title: "통장 연결 삭제", desc: "기존 거래내역은 유지됩니다.", danger: true });
                            if (ok) deleteBankMut.mutate(acc.id);
                          }}
                          className="text-xs text-red-400/60 hover:text-red-400 transition"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 비용 라우팅 — 지출결의 승인 시 지급 통장 자동 결정 */}
            <section className="stg-card">
              <div className="stg-card-head">
                <div>
                  <h3 className="stg-card-title">비용 라우팅 규칙</h3>
                  <p className="stg-card-desc">지출결의가 승인되면 비용 유형에 맞는 통장에서 지급되도록 정합니다.</p>
                </div>
                <button onClick={() => setShowRuleForm(!showRuleForm)} className="btn-secondary btn-sm shrink-0">+ 규칙 추가</button>
              </div>

              {showRuleForm && bankAccounts.length > 0 && (
                <div className="stg-inline-form">
                  <div className="stg-form-grid">
                    <div>
                      <label className="field-label">비용 유형</label>
                      <select
                        value={ruleForm.cost_type}
                        onChange={(e) => setRuleForm({ ...ruleForm, cost_type: e.target.value })}
                        className="field-input-sm"
                      >
                        {COST_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">지급 통장</label>
                      <select
                        value={ruleForm.bank_account_id}
                        onChange={(e) => setRuleForm({ ...ruleForm, bank_account_id: e.target.value })}
                        className="field-input-sm"
                      >
                        <option value="">선택</option>
                        {bankAccounts.map((acc: BankAccount) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.alias || acc.bank_name} ({acc.account_number})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => ruleForm.bank_account_id && addRuleMut.mutate()}
                      disabled={!ruleForm.bank_account_id || addRuleMut.isPending}
                      className="btn-primary"
                    >
                      추가
                    </button>
                    <button onClick={() => setShowRuleForm(false)} className="btn-ghost">취소</button>
                  </div>
                </div>
              )}

              {routingRules.length === 0 ? (
                <div className="stg-empty">
                  <div className="stg-empty-t">라우팅 규칙이 없습니다 — 기본 통장으로 지급됩니다</div>
                  <div className="stg-empty-d">&quot;+ 규칙 추가&quot;로 비용 유형별 지급 통장을 지정할 수 있습니다.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {routingRules.map((rule: any) => (
                    <div key={rule.id} className="stg-list-row">
                      <span className="text-sm font-medium">
                        {COST_TYPES.find(t => t.value === rule.cost_type)?.label || rule.cost_type}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        → {rule.bank_accounts?.alias || rule.bank_accounts?.bank_name || "미지정"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ═══ 회사 기본 ═══ */}
        {tab === "company-info" && <CompanyInfoTab companyId={companyId} />}
        {tab === "team" && <TeamManagement companyId={companyId} />}

        {/* ═══ 회계·세무 ═══ */}
        {tab === "chart" && companyId && <ChartOfAccountsManager companyId={companyId} />}
        {tab === "closing" && <AccountingClosingTab companyId={companyId} />}
        {tab === "tax" && <TaxAutomationTab companyId={companyId} />}

        {/* ═══ 연동·인증 ═══ */}
        {tab === "bank" && <BankIntegrationTab companyId={companyId} bankAccounts={bankAccounts} />}
        {/* 광고 계정 — 키는 여기 한 번, 프로젝트에서는 골라 쓴다 (2026-08-06) */}
        {tab === "ads" && companyId && <AdAccountsTab companyId={companyId} />}

        {/* ═══ 인사·근태 ═══ */}
        {tab === "departments" && <DepartmentsTab companyId={companyId} />}
        {tab === "attendance" && companyId && <HrAttendanceSettingsPanel companyId={companyId} />}

        {/* ═══ 업무 규칙 ═══ */}
        {tab === "deal" && <DealClassificationManager companyId={companyId} />}
        {tab === "forms" && <FormTemplateManager companyId={companyId} />}

        {tab === "delete-company" && companyId && permMaster && <CompanyDeleteTab companyId={companyId} />}
      </div>

      {confirmElement}
    </div>
  );
}

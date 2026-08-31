"use client";
import { AuditTrailPanel } from "@/components/audit-trail-panel";
import { logRead } from "@/lib/log-read";
import { useMyPermissions } from "@/lib/permissions";
import { Ico } from "@/components/ui-icon";

import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { BankIntegrationTab } from "./BankIntegrationTab";
import { ApiKeysTab } from "./ApiKeysTab";
import { TeamManagement } from "./TeamManagement";
import { DepartmentsTab } from "./DepartmentsTab";
import { FormTemplateManager } from "@/components/form-template-manager";
import { DealClassificationManager } from "./DealClassificationManager";
import { ProjectSalesAccountCard } from "./ProjectSalesAccountCard";
import { CompanyDeleteTab } from "./CompanyDeleteTab";
import { CompanyInfoTab, TaxAdvisorSection, IpRestrictionSection } from "./CompanyInfoTab";
import { QueryScreen, QueryHead, QueryBody } from "@/components/query-kit";
import { AccountingClosingTab } from "./AccountingClosingTab";
import { InsuranceRatesTab } from "./InsuranceRatesTab";
import { loadLinkedIntegrations, listApiKeys } from "@/lib/api-keys";
import { TAB_COMPAT, settingsGroup, type SettingsGroupKey, type SettingsLeafKey } from "@/lib/settings-nav";
// 계정·알림(개인)은 마이페이지로 이관됨(2026-07-08) — 여기선 import/렌더 제거.

// ── 회사 설정 화면 껍데기 (2026-08-24 사장님 지시: "좌측 사이드바로 메뉴화") ──
//   항목 13개를 **앱 사이드바에 그룹 5개**로 폈다 — IA 원본은 lib/settings-nav.ts 하나다.
//   그래서 이 파일은 이제 "한 그룹"만 그리는 껍데기다. 그룹 안 leaf 만 상자 안 파란 밑줄 탭으로
//   세우므로 탭이 2~4개 — 13개가 한 줄에 눌려 뒤쪽이 가로로 밀리던 문제가 사라진다.
//   ※ 2026-08-13 에 기각된 '좌측 네비'와 다른 점: 화면 **안에** 패널을 만들지 않는다
//     (그때 기각 사유는 '왼쪽'이 아니라 '왼쪽이 두 개'였다). leaf 본문은 한 줄도 건드리지 않았다.
//    · 내부 디자인: .stg-main 스코프 CSS 로 기존 glass-card·section-title 을 일괄 재스킨.
type LeafKey = SettingsLeafKey;

export function SettingsShell({ group }: { group: SettingsGroupKey }) {
  const { role } = useUser();
  // 권한 게이트에서 early return 한 뒤에 나머지 훅들이 이어지면 role 이 바뀌는 렌더에서
  // 훅 개수가 달라져 React #310 크래시 — 본문을 별도 컴포넌트로 분리 (2026-08-03).
  if (role === "partner" /* (P3) 멤버는 권한 게이트가 판정 */) {
    return <AccessDenied detail="회사 설정은 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }
  return <SettingsPageInner group={group} />;
}

function SettingsPageInner({ group }: { group: SettingsGroupKey }) {
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get("tab") || "";
  //   이 주소가 맡은 그룹의 leaf 만 탭으로 세운다 — 그룹 밖 leaf 는 다른 사이드바 메뉴의 몫이다.
  //   (옛 주소 /settings?tab=X 를 그룹 주소로 보내는 일은 settings/page.tsx 가 맡는다 — 여기서
  //    또 튕기면 두 번 리다이렉트돼 뒤로가기가 망가진다.)
  const groupLeaves = settingsGroup(group)?.leaves ?? [];
  const initialTab: LeafKey = (() => {
    const mapped = (groupLeaves.some((l) => l.key === rawTab) ? rawTab : TAB_COMPAT[rawTab]) as LeafKey | undefined;
    if (mapped && groupLeaves.some((l) => l.key === mapped)) return mapped;
    return groupLeaves[0]?.key ?? "company-info";
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
  // (2026-07-30 개편 P3) 설정 세부탭 권한 게이트 — 마스터=전체, 멤버=부여(/settings:leaf)만.
  //   통합 탭은 구성 키 중 하나라도 부여돼 있으면 노출 (옛 부여 존중).
  const { isMaster: permMaster, hasPerm: permHas, loading: permLoading } = useMyPermissions();
  const visibleTabs = groupLeaves.filter((t) =>
    t.masterOnly ? permMaster : (permMaster || t.perms.some((p) => permHas(`/settings:${p}`))));
  const firstAllowedLeaf = visibleTabs[0]?.key;
  useEffect(() => {
    const allowed = visibleTabs.some((t) => t.key === tab);
    if (!allowed && firstAllowedLeaf) setTabState(firstAllowedLeaf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, permMaster, firstAllowedLeaf, visibleTabs.map((t) => t.key).join()]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
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
      setUserId(u.id);
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

  // 허브 상태줄 — 실데이터 요약. 실패해도 조용히 생략(fail-soft).
  const { data: hubCompany } = useQuery({
    queryKey: ["settings-hub-company", companyId],
    queryFn: async () => {
      const data = logRead('settings/hub:company', await supabase
        .from("companies").select("name, business_number, representative").eq("id", companyId!).maybeSingle());
      return (data as { name: string; business_number: string | null; representative: string | null } | null) ?? null;
    },
    enabled: !!companyId,
  });
  const { data: hubMemberCount } = useQuery({
    queryKey: ["settings-hub-members", companyId],
    queryFn: async () => {
      const { count } = await supabase
        .from("users").select("id", { count: "exact", head: true }).eq("company_id", companyId!);
      return count ?? null;
    },
    enabled: !!companyId,
  });

  //   ── 연동 그룹 탭 줄 = 연결 현황판 (2026-08-24) ──
  //   8-21 사장님 요구는 "무엇이 연결됐나를 한 곳에서 본다"였고, 그래서 'API 키' 탭 목록에
  //   은행·홈택스·광고 줄까지 모아 뒀다. 그런데 같은 것이 두 탭에 나와 헷갈렸다(8-24 사장님).
  //   → 목록에서는 빼고 **탭 줄 배지**로 옮긴다. 조망은 남고 중복만 사라진다.
  //   ★ 연동 그룹을 볼 때만 부른다 — 다른 설정 화면에서 헛돌게 하지 않는다.
  const { data: linkedNow = [] } = useQuery({
    queryKey: ["company-linked-integrations", companyId],
    queryFn: () => loadLinkedIntegrations(companyId!),
    enabled: !!companyId && group === "integration",
    staleTime: 60_000,
  });
  const { data: apiKeyRows = [] } = useQuery({
    queryKey: ["company-api-keys", companyId],
    queryFn: () => listApiKeys(companyId!),
    enabled: !!companyId && group === "integration",
    staleTime: 60_000,
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
  // 생존 개월수 분모 = 반복결제 + 재직자 급여 + 추가 고정비 (2026-08-19 감사):
  //   종전엔 "추가 월 고정비" 입력값만 나눠 실제 고정비 5천만/입력 5백만 회사가 "20개월"로 보였다.
  //   아래 도움말이 약속한 산식과 동일하게 맞춘다.
  const { data: burnParts } = useQuery({
    queryKey: ["settings-burn-parts", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: rec }, { data: emps }] = await Promise.all([
        supabase.from("recurring_payments").select("amount").eq("company_id", companyId!).eq("is_active", true),
        supabase.from("employees").select("salary, status").eq("company_id", companyId!).in("status", ["active", "joined"]),
      ]);
      return {
        recurring: (rec || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
        salary: (emps || []).reduce((s: number, e: any) => s + Number(e.salary || 0), 0),
      };
    },
  });
  const monthlyBurnTotal = (burnParts?.recurring || 0) + (burnParts?.salary || 0) + (Number(fixedCost) || 0);
  const runwayMonths = totalCash > 0 && monthlyBurnTotal > 0 ? totalCash / monthlyBurnTotal : null;

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

  //   이 그룹에서 볼 수 있는 탭이 하나도 없으면 화면을 열지 않는다 — 새 주소가 권한 뒷문이 되면 안 된다.
  //   (권한을 아직 읽는 중이면 기다린다. 안 그러면 잠깐 '권한 없음'이 번쩍인다.)
  if (!permLoading && visibleTabs.length === 0) {
    return <AccessDenied detail="이 설정 항목에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const meta = groupLeaves.find((l) => l.key === tab);

  // 밴드 네비 상태줄 — 짧게. 금액은 축약(만/억).
  const compactWon = (v: number) =>
    v >= 100_000_000 ? `${(v / 100_000_000).toFixed(1)}억` : v >= 10_000 ? `${Math.round(v / 10_000).toLocaleString()}만` : `${v.toLocaleString()}`;
  const bandStatus: Partial<Record<LeafKey, { text: string; warn?: boolean }>> = {
    "company-info": hubCompany && !hubCompany.business_number ? { text: "번호 미입력", warn: true } : undefined,
    team: hubMemberCount != null ? { text: `${hubMemberCount}명` } : undefined,
    cash: totalCash > 0 ? { text: `₩${compactWon(totalCash)}` } : undefined,
    //   ★ 예전 배지는 '수동 등록 계좌 수'라 연동 상태로 오해됐다 — 연동은 연결 여부로 말한다.
    bank: (() => {
      const codef = linkedNow.find((l) => l.key === "codef");
      const ht = linkedNow.find((l) => l.key === "hometax");
      const on = [codef?.status === "ok", ht?.status === "ok"].filter(Boolean).length;
      if (!linkedNow.length) return undefined;
      return on === 2 ? { text: "연결됨" } : on === 1 ? { text: "일부 연결" } : { text: "미연결", warn: true };
    })(),
    //   광고 계정이 API 키 탭으로 합쳐졌으므로(2026-08-24) 배지도 **한 자리에서 함께** 센다.
    //   따로 두면 탭은 하나인데 숫자가 둘이라 또 헷갈린다.
    "api-keys": (() => {
      const ads = linkedNow.find((l) => l.key === "ads");
      const adCount = ads && ads.status !== "none" ? Number(String(ads.detail).match(/^(\d+)/)?.[1] || 0) : 0;
      const total = apiKeyRows.length + adCount;
      if (!total) return undefined;
      return { text: `${total}개`, warn: !!ads && ads.status !== "ok" && ads.status !== "none" };
    })(),
  };
  return (
    <div className="qk-shell stg-page">
      {/* ── 조회 화면 표준 상자 (2026-08-19 설정·도움말 확산) — 예전 잉크 밴드(회사 이름 + 알약 네비) → 갈래 탭 상자 안 파란 밑줄 한 줄 + 설명 줄, 본문만 스크롤 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print stg-tabs" role="tablist" aria-label="회사 설정">
            {/* 그룹 안 leaf 만 세운다 — 한 줄에 2~4개라 가로로 밀리지 않는다(그룹 구분선도 필요 없어졌다). */}
            {visibleTabs.map((t) => {
              const active = tab === t.key;
              const st = bandStatus[t.key];
              return (
                <button key={t.key} role="tab" aria-selected={active} type="button" onClick={() => setTab(t.key)}
                  className={`collect-tab ${active ? "collect-tab-on" : ""} ${t.danger ? "stg-tab-danger" : ""}`}>
                  {t.label}
                  {st && <span className={`collect-tab-cnt ${st.warn ? "stg-tab-warn" : ""}`}>{st.text}</span>}
                </button>
              );
            })}
          </div>
          <div className="report-desc stg-desc">
            <b>{hubCompany?.name || "회사 설정"}</b>
            {hubCompany?.representative ? ` · 대표 ${hubCompany.representative}` : ""}{hubCompany?.business_number ? ` · ${hubCompany.business_number}` : ""}
            {hubCompany && !hubCompany.business_number && (
              groupLeaves.some((l) => l.key === "company-info")
                ? <button type="button" onClick={() => setTab("company-info")} className="stg-band-alert ml-2">사업자번호 미입력</button>
                /* 다른 그룹에서는 탭이 없으므로 회사 기초정보 주소로 보낸다 */
                : <Link href="/settings/company?tab=company-info" className="stg-band-alert ml-2">사업자번호 미입력</Link>
            )}
            {meta && <span className="stg-desc-meta"> — <b className={meta.danger ? "text-[var(--danger)]" : ""}>{meta.title}</b> · {meta.desc}</span>}
          </div>
        </QueryHead>
        <QueryBody>
        <div className="stg-scroll">
      <div className="stg-main">
        <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

        {/* ═══ 자금·통장 — 가용 현금 집계 + 미연동 통장 + 비용 라우팅 ═══ */}
        {tab === "cash" && (
          <div className="space-y-5">
            {/* 요약 밴드 — 대시보드 숫자 문법(라벨 위·값 아래) */}
            <div className="stg-statband">
              <div className="stg-stat">
                {/* 라벨 정정 (2026-08-19): 이 값은 연동+수기 전체 합산 — "연동"이라 쓰면
                    수기 계좌만 있는 회사가 연동된 것으로 오해한다 */}
                <div className="stg-stat-label">전체 통장 합산 (연동+수기)</div>
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

        {/* ═══ 회사정보 ═══ */}
        {tab === "company-info" && <CompanyInfoTab companyId={companyId} />}

        {/* 세무 파트너 · 접속 보안 — 회사정보에서 떼어 낸 것들 (2026-08-21) */}
        {tab === "tax-partner" && <TaxAdvisorSection />}
        {tab === "insurance" && companyId && <InsuranceRatesTab companyId={companyId} userId={userId} />}
        {/*   '결재 상신 알림(총괄 수신)'은 2026-08-24 삭제했다 — 사장님:
              "결재는 참조·결재자한테만 알람이 가면 되는 건데, 직원 100명이면 100명이 올리는 상신
               알람을 다 받을 것인가? 쓸데없는 메뉴·기능이다."
              맞는 말이다. 결재 알림은 그 건의 결재자·참조자에게만 간다(그 경로는 그대로 둔다). */}
        {tab === "security" && (
          <div className="space-y-5">
            <IpRestrictionSection companyId={companyId} />
            {/*   변경 이력 — 누가 언제 무엇을 바꿨나 (2026-08-27 ERP 3순위 ④) */}
            <AuditTrailPanel companyId={companyId} />
          </div>
        )}

        {/* ═══ 구성원·초대 — 초대·합류 승인 + 부서 (2026-08-13 통합) ═══ */}
        {tab === "team" && (
          <div className="space-y-5">
            <TeamManagement companyId={companyId} />
            <DepartmentsTab companyId={companyId} />
          </div>
        )}

        {/* ═══ 계정과목·분류 — 계정과목 + 딜 분류 (2026-08-13 통합) ═══ */}
        {tab === "chart" && companyId && (
          <div className="space-y-5">
            <ChartOfAccountsManager companyId={companyId} />
            <ProjectSalesAccountCard companyId={companyId} />
            <DealClassificationManager companyId={companyId} />
          </div>
        )}

        {/* ═══ 회계마감 + 장부 매칭 규칙 (구 세무자동화에서 실사용 필드만 이식) ═══ */}
        {tab === "closing" && (
          <div className="space-y-5">
            <AccountingClosingTab companyId={companyId} />
            <MatchingRuleCard companyId={companyId} />
          </div>
        )}

        {/* ═══ 연동·인증 ═══ */}
        {/* 연동·API 키 — 회사가 자기 이름으로 발급받은 인증키 (2026-08-21) */}
        {tab === "api-keys" && companyId && <ApiKeysTab companyId={companyId} userId={userId} />}
        {tab === "bank" && <BankIntegrationTab companyId={companyId} bankAccounts={bankAccounts} />}

        {/* 근태·가산수당 탭은 인사관리로 이관(2026-08-24 사장님 지시) —
            근무시간·휴일 → 근태 관리 › 근무 기준 / 가산수당·수당 카탈로그 → 구성원 › 급여.
            옛 주소는 lib/settings-nav.ts 의 TAB_MOVED 가 받는다. */}

        {/* ═══ 회사 양식 ═══ */}
        {tab === "forms" && <FormTemplateManager companyId={companyId} />}

        {tab === "delete-company" && companyId && permMaster && <CompanyDeleteTab companyId={companyId} />}
      </div>
        </div>
        </QueryBody>
      </QueryScreen>

      {confirmElement}
    </div>
  );
}

// ── 장부 매칭 규칙 — 구 세무자동화 탭에서 코드가 실제로 읽는 유일한 설정(matching_tolerance,
//    tax-invoice.ts 3-way 매칭)만 남긴 카드. 죽은 토글 8개(자동발행·취소규칙·발행주기·선금비율·
//    부가세집계)는 소비처 0 확인 후 화면에서 제거 — tax_settings 의 다른 키는 건드리지 않는다.
function MatchingRuleCard({ companyId }: { companyId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tolerance, setTolerance] = useState<string>("1");
  const [saved, setSaved] = useState(false);
  const { data: taxSettings } = useQuery({
    queryKey: ["tax-settings", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const data = logRead('settings/MatchingRuleCard:data', await supabase
        .from("companies").select("tax_settings").eq("id", companyId).maybeSingle());
      return ((data as any)?.tax_settings || {}) as Record<string, any>;
    },
    enabled: !!companyId,
  });
  useEffect(() => {
    if (taxSettings?.matching_tolerance != null) setTolerance(String(taxSettings.matching_tolerance));
  }, [taxSettings]);
  async function saveTolerance() {
    if (!companyId) return;
    const merged = { ...(taxSettings || {}), matching_tolerance: Math.min(100, Math.max(0, Number(tolerance) || 1)) };
    const { error } = await supabase.from("companies").update({ tax_settings: merged }).eq("id", companyId);
    if (error) { toast(`저장 실패: ${error.message}`, "error"); return; }
    qc.invalidateQueries({ queryKey: ["tax-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  if (!companyId) return null;
  return (
    <section className="stg-card">
      <div className="stg-card-head">
        <div>
          <h3 className="stg-card-title">장부 매칭 허용오차</h3>
          <p className="stg-card-desc">계약↔세금계산서↔입금을 자동으로 맞춰볼 때 허용할 금액 차이 비율입니다.</p>
        </div>
      </div>
      <div className="flex items-end gap-3 max-w-xs">
        <div className="flex-1">
          <label className="field-label">허용오차 (%)</label>
          <input
            type="number" min={0} max={10} step={0.1}
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            className="field-input"
          />
        </div>
        <button onClick={saveTolerance} className="btn-primary shrink-0">{saved ? "저장 완료" : "저장"}</button>
      </div>
    </section>
  );
}

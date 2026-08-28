"use client";
import { appConfirm } from "@/components/global-confirm";
import { downloadCsv } from "@/lib/csv-export";
import { useMyPermissions } from "@/lib/permissions";
import { Ico } from "@/components/ui-icon";
import { DepartmentField, PositionField } from "@/components/org-option-fields";
import { todayKst, kstDateStr, kstDateTimeLocal, kstLocalToIso } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";

import { useEffect, useState, useMemo, useRef, Fragment } from "react";
import { MonthField } from "@/components/month-field";
import { InsuranceNoticeDialog } from "@/components/insurance-notice-dialog";
import type { InsuranceRates } from "@/lib/insurance-rates";
import { DateTimeField } from "@/components/datetime-field";
import { DateField } from "@/components/date-field";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { friendlyError } from "@/lib/friendly-error";
import {
  // Attendance & Leave
  getAttendanceRecords, getMonthlyAttendanceSummary,
  recomputeAttendance,
  calculateWeeklyHours,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest, calcLeaveDays,
  getLeaveBalances, correctAttendanceRecord,
  calculateAnnualLeave,
  cancelLeaveRequest, getCompanyMembers,
  getLeaveGrantMethod, setLeaveGrantMethod, type LeaveGrantMethod,
  LEAVE_TYPES, LEAVE_UNITS, ATTENDANCE_STATUS, LEAVE_REQUEST_STATUS,
  // Leave Promotion
  getLeavePromotionCandidates, sendLeavePromotionNotice, getLeavePromotionNotices,
} from "@/lib/hr";
import {
  getMonthlyAccrualSettings, setMonthlyAccrualSettings, syncLeaveAccruals, setRemainingLeaveDays,
  getHalfDaySlots, setHalfDaySlots,
  ACCRUAL_BASIS_LABELS, type MonthlyAccrualBasis,
  getCompanyLeaveTypes, setCompanyLeaveTypes, defaultCompanyLeaveTypes, type CompanyLeaveType,
} from "@/lib/leave-grants";
import { EmployeeDetailPanel } from "./_components/EmployeeDetailPanel";
import { getExpenseRequests } from "@/lib/expenses";
import { getSignedUrl } from "@/lib/file-storage";
import { previewPayroll } from "@/lib/payroll";
import { EmployeeBulkInviteModal } from "@/components/employee-bulk-invite"; // 엑셀 대량 초대(2026-07-31)
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { generateEmploymentCertificate, generateCareerCertificate, getCertificateLogs, saveCertificateLog } from "@/lib/certificates";
import { listAppointments, appointmentLines } from "@/lib/hr-appointments";
import { fetchRetirementEstimates } from "@/lib/retirement";
import { RetirementDialog } from "@/components/retirement-dialog";
import { fetchHrTodos } from "@/lib/hr-todo";
import { comparePeople } from "@/lib/people-sort";
import { HrTodoDialog } from "@/components/hr-todo-dialog";
import { exportToExcel } from "@/lib/excel-export";
import { CertChoiceField, CERT_PURPOSE_OPTIONS, CERT_SUBMIT_TO_OPTIONS } from "@/components/cert-issue-fields";
import { type PayrollItem } from "@/lib/payment-batch";
import { createEmployeeInvitation, getEmployeeInvitations, getInviteUrl, sendInviteEmail, cancelEmployeeInvitation, addExistingMemberAsEmployee } from "@/lib/invitations";
import {
  MonthlyRecomputeButton,
  AttendanceEditRequestDialog,
  ManualAttendanceDialog,
} from "@/components/hr-attendance-extras";
//   수당 기준 — 2026-08-24 회사 설정 '근태·가산수당' 에서 이관.
//   통상시급 분모·당직 단가·수당 단가는 allowance-calc → allowance_entries → **급여대장 금액**을 만든다.
//   옛 자리(/settings:attendance)에는 money 표시가 없어 급여 권한 없이도 금액을 움직일 수 있었다.
import { HrAllowancePolicyPanel } from "@/components/hr-attendance-settings";
import { AttendanceBadges } from "@/components/attendance-badges";
import { FlexPeopleDirectory } from "@/components/flex-people-directory";
import { payrollStats, useCertificateStats } from "@/components/flex-hr-heroes";
import { QueryScreen, QueryHead, QueryBody, ResultStrip, Stat, ChipGroup, ConditionPanel, ConditionRow, AppliedChips, QuickSearch, quickSearchHit, HelperMenu, ExcelMenu, type AppliedChip } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { useModalKeys } from "@/hooks/use-modal-keys";
// recomputeMonthlyAllowancesForCompany 자동 호출은 504 인시던트 3차 (2026-05-21) 후 제거됨.
//   수동 트리거 (MonthlyRecomputeButton / AllowanceAdminTab "월 일괄 재계산") 만 유지.

type Tab = "employees" | "salary" | "payroll" | "leave" | "certificates";

// Employee 역할은 자기 관련 탭만 접근 가능
// 근태 관리는 /attendance 별도 페이지로 분리됨. employees 페이지엔 휴가/경비/증명서만.
// (P3) EMPLOYEE_ROLE_TABS 삭제 — 권한 기반 탭 게이트로 대체.

export default function EmployeesPage() {
  const { toast } = useToast();
  const { user, role, loading: userLoading } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const sp = useSearchParams();
  const urlTab = sp?.get('tab') as Tab | null;
  const isValidTab = (t: string | null): t is Tab =>
    !!t && (['employees','salary','payroll','leave','certificates'] as const).includes(t as Tab);
  // V1: '급여이력' 완전 제거. '급여' 탭 = 급여 명세(PayrollPreviewTab)만.
  //   ?tab=salary / ?tab=payroll 딥링크 모두 '급여' 탭(명세)으로 정규화.
  const normalizeTab = (t: Tab): Tab => (t === "payroll" ? "salary" : t);
  const [tab, setTab] = useState<Tab>(isValidTab(urlTab) ? normalizeTab(urlTab) : "employees");
  const [showForm, setShowForm] = useState(false);
  //   직원 초대 폼 / 엑셀 대량 초대 — 버튼은 조회 줄 오른쪽, 폼은 표 위(2026-08-18 조회 표준)
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const queryClient = useQueryClient();
  // (P3) 관리 판정 권한 기반 — 인력관리 권한 보유(또는 마스터)=관리자급, 그 외=본인 스코프
  const { isMaster, hasPerm } = useMyPermissions();
  const isEmployee = !(isMaster || hasPerm("/employees:employees"));

  // URL ?tab=... 동기화. payroll/salary → '급여' 탭(명세).
  useEffect(() => {
    if (!isValidTab(urlTab)) return;
    setTab(normalizeTab(urlTab));
  }, [urlTab]);

  // (P3) 구 직원 탭 리셋 effect 제거 — 권한 기반 effectiveTab 렌더 경계가 대체.

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowForm(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Employees ──
  const { data: employees = [], error: mainError, refetch: mainRefetch, isLoading: mainLoading } = useQuery({
    queryKey: ["employees", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId!)
        .order("created_at"));
      return data || [];
    },
    enabled: !!companyId,
  });

  // V1: 급여이력(SalaryTab/salary-history) 제거 — '급여' 탭은 명세만.

  // (2026-07-30) 관리·추가/수정 뷰 삭제 — 디렉토리 단일.

  // ── Expenses ──
  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", companyId],
    queryFn: () => getExpenseRequests(companyId!),
    enabled: !!companyId,
  });

  // ── 휴가 탭용 디렉토리 — employees RLS 로 타인 행이 null 될 때 이름 폴백 (team 페이지와 동일 RPC) ──
  const { data: leaveDirectory = [] } = useQuery({
    queryKey: ["company-directory", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId && tab === "leave",
  });

  //   초대 대기 배지용 — 초대 섹션과 같은 키라 캐시를 나눠 쓴다
  const { data: invitationsForBadge = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId!),
    enabled: !!companyId && tab === "employees",
  });
  const pendingInviteCount = (invitationsForBadge as any[]).filter((i) => i.status === "pending").length;
  const certStats = useCertificateStats(tab === "certificates" ? companyId : null);
  const pay = payrollStats(employees);
  // 재직자만 합산 (2026-08-19 감사): 퇴사자 급여가 섞여 급여 탭 합계와 다른 인건비가 표시됐다.
  const activeForPay = employees.filter((e: any) => ["active", "joined"].includes(e.status));
  const totalSalary = activeForPay.reduce((s: number, e: any) => s + Number(e.salary || 0), 0);
  const totalRetirement = activeForPay.reduce((s: number, e: any) => s + Number(e.retirement_accrual || 0), 0);
  const [retireOpen, setRetireOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const { data: hrTodos, isLoading: todoLoading } = useQuery({ queryKey: ["hr-todos", companyId, todayKst(), employees.length], queryFn: () => fetchHrTodos(companyId!, employees), enabled: !!companyId && !isEmployee && employees.length > 0, staleTime: 120_000 });
  const { data: retireRows } = useQuery({ queryKey: ["retirement-est", companyId, todayKst()], queryFn: () => fetchRetirementEstimates(companyId!, todayKst()), enabled: !!companyId && role !== "employee", staleTime: 300_000 });
  const retireTotal = retireRows ? retireRows.reduce((s, r) => s + r.estimate, 0) : null;
  const activeCount = employees.filter((e: any) => ["active", "joined"].includes(e.status)).length;

  // (2026-07-30 개편 P3) 세부탭 권한 게이트 — 마스터=전체, 멤버=부여받은 탭만.
  //   카탈로그 키: /employees:employees|salary|leave|certificates. 구 role 분기 대체.
  const tabAllowed = (k: Tab) => isMaster || hasPerm(`/employees:${k === "payroll" ? "salary" : k}`);
  const isManager = !isEmployee;
  const allTabs: { key: Tab; label: string; count?: number }[] = [
    { key: "employees", label: "인력관리", count: activeCount },
    { key: "salary", label: "급여" },
    { key: "leave", label: "휴가" },
    { key: "certificates", label: "증명서 발급" },
  ];
  const tabs = allTabs.filter((t) => tabAllowed(t.key));
  // S-1: 렌더 경계 — 미허용 탭은 어떤 경로(딥링크 초기 state 포함)로도 해당 Tab 컴포넌트를
  //   마운트하지 않는다. 허용 탭이 하나도 없으면 certificates 자리(빈 안내)로.
  const effectiveTab: Tab = tabAllowed(tab === "payroll" ? "salary" : tab) ? tab : (tabs[0]?.key ?? "certificates");

  if (userLoading || mainLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">회사 정보를 불러올 수 없습니다. 새로고침 해주세요.</div>;

  // P2: 페이지-국소 인쇄 CSS 제거 → globals.css 공통 .print-area 유틸 사용.
  //     폭은 공통 토큰(--content-max-wide)으로 통일.
  //   2026-08-18 조회 화면 표준 — 갈래 탭은 상자 안 맨 위 파란 밑줄, KPI 타일은 결과 요약 줄(Stat)로,
  //   본문은 상자 안에서 스크롤(끝선 = 사이드바). 인력관리 탭은 디렉토리 부품이 상자 전체를 그린다.
  const tabsEl = (
    <div className="collect-tabs no-print">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => setTab(t.key)}
          className={effectiveTab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="collect-tab-cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
  //   요약 — Employee 역할에게는 급여/인원/퇴직충당금 숨김.
  //   휴가 탭은 시안대로 표가 주인공이라 상단 KPI 를 감춘다 (2026-08-06 사장님).
  const peopleStats = !isEmployee ? (<>
    <Stat label="재직 인원" value={`${activeCount}명`} />
    {pendingInviteCount > 0 && <button type="button" className="qk-stat-link" title="초대 대기 목록 열기" onClick={() => setInviteFormOpen(true)}><Stat label="초대 대기" value={`${pendingInviteCount}명`} tone="minus" /></button>}
    {/*   G4·H4·H5 (2026-08-27) — 기한·근태 이상·연차촉진을 규칙으로 모은 '처리할 것'. 누르면 내역 팝업 */}
    <button type="button" className="qk-stat-link" title="계약 만료·수습 종료·1주년·미서명·공휴일 / 52시간 예상·연속 지각·퇴근 누락 / 연차촉진 대상" onClick={() => setTodoOpen(true)}>
      <Stat label="처리할 것" value={hrTodos ? `${hrTodos.reduce((n, g) => n + g.items.length, 0)}건` : "…"} tone={hrTodos && hrTodos.some((g) => g.items.length) ? "minus" : undefined} />
    </button>
    {/* 인건비·퇴직충당금은 급여 권한자만 (2026-08-19 감사) — 급여 탭 KPI(tabAllowed) 와 일관.
        소규모 팀에선 총액만으로 개인 급여가 역산된다. */}
    {tabAllowed("salary") && (<>
      <Stat label="연 인건비" value={<>₩{(totalSalary * 12).toLocaleString()} <small className="font-normal text-[var(--text-dim)]">월 ₩{totalSalary.toLocaleString()}</small></>} />
      {/*   G1 (2026-08-27) — 누르면 직원별 추계 표 + 충당부채 전표 초안. 직접 입력값 합계는 참고로. */}
      <button type="button" className="qk-stat-link" title="직원별 퇴직금 추계 · 충당부채 전표 초안" onClick={() => setRetireOpen(true)}>
        <Stat label="퇴직충당금" value={<>₩{(retireTotal ?? totalRetirement).toLocaleString()} <small className="font-normal text-[var(--text-dim)]">{retireTotal != null ? "추계" : "직접 입력"}</small></>} />
      </button>
    </>)}
    <Stat label="미결 경비" value={`${expenses.filter((e: any) => e.status === "pending").length}건`} tone={expenses.some((e: any) => e.status === "pending") ? "minus" : undefined} />
  </>) : null;

  return (<>
      {retireOpen && companyId && <RetirementDialog companyId={companyId} onClose={() => setRetireOpen(false)} />}
      {todoOpen && <HrTodoDialog groups={hrTodos || []} loading={todoLoading} onClose={() => setTodoOpen(false)} />}
      
    <div className="print-area qk-shell" id="employees-print-area">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

      {/* Tab Content — S-1: effectiveTab 으로 직원 비허용 탭 컴포넌트 미마운트 */}
      {/* (2026-07-30 사장님) '관리·추가/수정' 화면 삭제 — 디렉토리 단일 화면 + 초대 섹션만 이동.
          직원 정보 수정은 디렉토리 카드 → 상세보기에서. */}
      {effectiveTab === "employees" && (
        <FlexPeopleDirectory companyId={companyId} employees={employees} isManager={!isEmployee}
          tabs={tabsEl}
          stats={peopleStats}
          actions={!isEmployee ? (<>
            {/*   2026-08-27 인사 5차 — 조회 줄은 엑셀▾ + 파란 1개. 초대 대기·처리할 것은 요약 줄 Stat 클릭 */}
            <ExcelMenu items={[
              { label: "엑셀로 대량 초대", hint: "이름·이메일·부서 열을 붙여넣어 한 번에 초대", onClick: () => setBulkInviteOpen(true) },
              { label: "명단 내려받기", count: activeCount, disabled: !activeCount, onClick: () => exportToExcel(employees.filter((e: any) => ["active", "joined"].includes(e.status)).map((e: any) => ({ "이름": e.name, "부서": e.department || "", "직책": e.position || "", "고용형태": e.employment_type || "", "입사일": e.hire_date || "", "이메일": e.email || "", "연락처": e.phone || "" })), "구성원", `구성원_${todayKst()}`) },
            ]} />
            <button type="button" onClick={() => setInviteFormOpen((v) => !v)} className="btn-primary btn-sm whitespace-nowrap">+ 직원 초대</button>
          </>) : undefined}
          before={!isEmployee ? (
            <EmployeeInviteSection companyId={companyId} userId={userId} queryClient={queryClient}
              showForm={inviteFormOpen} setShowForm={setInviteFormOpen}
              showBulkInvite={bulkInviteOpen} setShowBulkInvite={setBulkInviteOpen} />
          ) : undefined}
        />
      )}

      {effectiveTab !== "employees" && (
        <QueryScreen>
          <QueryHead>
            {tabsEl}
            {/* P1-3: 급여 = 이력 ↔ 명세 서브뷰 단일 탭. 히어로 카드(지급 대상·월 급여 총액·4대보험·연 인건비)는 결과 요약 줄로 */}
            {effectiveTab === "salary" && !isEmployee && (
              <ResultStrip>
                <Stat label="지급 대상" value={`${pay.active.length}명`} />
                <Stat label="월 급여 총액" value={`₩${pay.monthly.toLocaleString()}`} />
                <Stat label="4대보험 회사부담(추정)" value={`₩${pay.insurance.toLocaleString()}`} />
                <Stat label="연 인건비" value={`₩${(pay.monthly * 12).toLocaleString()}`} />
              </ResultStrip>
            )}
            {effectiveTab === "certificates" && (
              <ResultStrip>
                <Stat label="이번 달 발급" value={`${certStats?.month ?? 0}건`} />
                <Stat label="누적 발급" value={`${certStats?.total ?? 0}건`} />
              </ResultStrip>
            )}
          </QueryHead>
          <QueryBody>
            <div className="emp-scroll">
              {effectiveTab === "salary" && (
                <>
                  <div className="payroll-tab-panel"><PayrollPreviewTab companyId={companyId} /></div>
                  {/* 수당 기준 — 가산수당 정책(주 소정근로·통상시급 분모·당직 단가·5인 미만·포괄임금) + 수당 카탈로그.
                      매일 보는 것(급여 이력·명세) 아래에 둔다 — 기준은 자주 바꾸지 않는다.
                      이 탭 자체가 급여 권한(money)이라, 금액을 만드는 값이 금액 권한과 같은 자리에 놓인다. */}
                  <div className="hr-rule-panel"><HrAllowancePolicyPanel companyId={companyId} /></div>
                </>
              )}

              {/* 경비청구 탭은 구성원에서 제거(2026-06-29) — 경비/지출결의는 결재관리(/approvals)에서 처리(2026-07-08 이관). 미결 경비 요약 카드는 상단 유지. 휴가 탭은 근태관리로 이동. */}
              {/* 계약서 탭은 구성원에서 제거(2026-07-15) — 개별 발송은 인력관리 > 디렉토리에서 직원 선택 후 계약서 탭으로,
                  서식 관리/회사 문서/발송 현황(일괄발송)은 인사관리 > 양식 관리(/hr-templates)로 이관됨. */}
              {/* 휴가 탭 복원(2026-07-30) — 관리자/대표 전용. 직원 딥링크는 S-1 렌더 경계(effectiveTab)가 차단. */}
              {effectiveTab === "leave" && (
                <LeaveTab
                  employees={employees}
                  directory={leaveDirectory}
                  companyId={companyId}
                  userId={userId}
                  queryClient={queryClient}
                  isEmployee={false}
                  autoNew={sp?.get("new") === "1"}
                  focusPending={sp?.get("focus") === "pending"}
                />
              )}

              {effectiveTab === "certificates" && (
                <div className="certificate-tab-panel"><CertificateTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} /></div>
              )}
            </div>
          </QueryBody>
        </QueryScreen>
      )}
    </div>
  </>);
}

// ── 구성원 초대 섹션 (2026-07-30 사장님) — 구 '관리·추가/수정' 화면에서 초대만 발췌해 디렉토리로 이동.
//   목록 테이블·조직도·역할 관리 등 관리 화면은 삭제(수정은 디렉토리 상세보기에서).
function EmployeeInviteSection({ companyId, userId, queryClient, showForm, setShowForm, showBulkInvite, setShowBulkInvite }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState({ email: "", name: "", role: "employee" as "employee" | "admin", department: "", position: "", salary: "", hireDate: "", employeeNumber: "" });
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addExisting, setAddExisting] = useState(false);
  // 엑셀 대량 초대 (2026-07-31 사장님) — 단건 초대와 동일 경로를 행 단위로 반복 (열림 상태는 부모 조회 줄 버튼이 쥔다)

  const { data: invitations = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId!),
    enabled: !!companyId,
  });
  const { data: companyData } = useQuery({
    queryKey: ["company-name", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase.from("companies").select("name, representative, address, business_number").eq("id", companyId!).maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const [showAcqEdi, setShowAcqEdi] = useState(false);
  const [acqEdiData, setAcqEdiData] = useState<{ name: string; department: string; position: string; salary: string } | null>(null);

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("인증 필요");
      const trimmedEmail = form.email.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error("올바른 이메일 주소를 입력해주세요.");
      if (!form.department?.trim()) throw new Error("부서를 입력해주세요.");
      const invitation = await createEmployeeInvitation({
        companyId, email: form.email, name: form.name || undefined,
        role: form.role, invitedBy: userId,
      });
      // error 를 봐야 한다 (2026-08-20 감사): 권한 부족(RLS)으로 이 insert 가 막혀도 조용히 넘어가
      //   초대 메일만 나가고 구성원 행은 안 생겼다 — 받은 사람은 초대장을 보는데 명단엔 없는 상태.
      const { error: empErr } = await supabase.from("employees").insert({
        company_id: companyId,
        name: form.name || form.email.split("@")[0],
        email: form.email,
        department: form.department || null,
        position: form.position || null,
        employee_number: form.employeeNumber.trim() || null,   // 사번 (2026-08-27 사장님)
        salary: Math.round((Number(form.salary) || 0) / 12),
        hire_date: form.hireDate || todayKst(),
        status: "invited",
      });
      if (empErr) throw empErr;
      return invitation;
    },
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      if (data?.invite_token) {
        const result = await sendInviteEmail({
          email: data.email, name: data.name || undefined,
          role: data.role || form.role, inviteToken: data.invite_token,
          companyName: companyData?.name || undefined,
        });
        setInviteMsg(result.success
          ? { ok: true, msg: "초대 이메일 발송 완료" }
          : { ok: false, msg: result.error || "이메일 발송 실패 (초대 링크는 생성됨)" }
        );
      }
      setAcqEdiData({ name: form.name || form.email.split("@")[0], department: form.department, position: form.position, salary: form.salary });
      setShowAcqEdi(true);
      setShowForm(false);
      setForm({ email: "", name: "", role: "employee", department: "", position: "", salary: "", hireDate: "", employeeNumber: "" });
    },
    onError: (err: any) => {
      const msg = err.message || "";
      if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
        setInviteMsg({ ok: false, msg: "이미 초대된 이메일입니다" });
      } else {
        setInviteMsg({ ok: false, msg: msg || "초대 실패" });
      }
      setTimeout(() => setInviteMsg(null), 4000);
    },
  });

  const addExistingMut = useMutation({
    mutationFn: async () => {
      const trimmedEmail = form.email.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error("올바른 이메일 주소를 입력해주세요.");
      return await addExistingMemberAsEmployee({
        email: trimmedEmail, name: form.name || undefined, role: form.role,
        department: form.department, position: form.position, salary: form.salary, hireDate: form.hireDate,
      });
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      setInviteMsg({ ok: true, msg: `${r?.name || "회원"}님을 직원으로 추가했습니다.` });
      setShowForm(false);
      setForm({ email: "", name: "", role: "employee", department: "", position: "", salary: "", hireDate: "", employeeNumber: "" });
      setTimeout(() => setInviteMsg(null), 4000);
    },
    onError: (err: any) => {
      setInviteMsg({ ok: false, msg: err?.message || "직원 추가 실패" });
      setTimeout(() => setInviteMsg(null), 5000);
    },
  });

  // 초대 취소 — 초대 레코드 + 수락 전(invited) 직원 행까지 함께 정리 (구 관리 화면의 삭제 기능 흡수)
  const cancelMut = useMutation({
    mutationFn: async (inv: any) => {
      await cancelEmployeeInvitation(inv.id);
      if (inv.email) {
        await supabase.from("employees").delete().eq("email", inv.email).eq("company_id", companyId).eq("status", "invited");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
    },
    onError: (err: any) => toast("초대 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  function copyLink(token: string) {
    navigator.clipboard.writeText(getInviteUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }
  const [resending, setResending] = useState<string | null>(null);
  async function resend(inv: any) {
    if (!inv.invite_token || resending) return;
    setResending(inv.invite_token);
    const result = await sendInviteEmail({
      email: inv.email, name: inv.name || undefined,
      role: inv.role || "employee", inviteToken: inv.invite_token,
      companyName: companyData?.name || undefined,
    });
    setInviteMsg(result.success ? { ok: true, msg: "재발송 완료" } : { ok: false, msg: result.error || "발송 실패" });
    setResending(null);
    setTimeout(() => setInviteMsg(null), 4000);
  }

  const pendingInvites = invitations.filter((i: any) => i.status === "pending");
  //   보여 줄 것이 하나도 없으면 자리도 안 잡는다 (표 위 빈 띠 방지)
  if (!showBulkInvite && !inviteMsg && !(showAcqEdi && acqEdiData) && !showForm && pendingInvites.length === 0) return null;

  return (
    <div className="employee-invite-section">

      {showBulkInvite && companyId && userId && (
        <EmployeeBulkInviteModal
          companyId={companyId}
          userId={userId}
          companyName={companyData?.name || undefined}
          onClose={() => setShowBulkInvite(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
            queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
            queryClient.invalidateQueries({ queryKey: ["employee-emails", companyId] });
          }}
        />
      )}

      {inviteMsg && (
        <div className={`employee-invite-banner ${inviteMsg.ok ? "bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20" : "bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20"}`}>
          {inviteMsg.msg}
        </div>
      )}

      {showAcqEdi && acqEdiData && (
        <div className="employee-insurance-edi-panel">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-[var(--info)] flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                4대보험 취득신고 · Web EDI 업로드 파일 (준비 중)
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">신규 직원 <span className="font-semibold text-[var(--text)]">{acqEdiData.name}</span>의 국민건강보험 Web EDI 업로드용 정식 파일을 준비 중입니다.</p>
            </div>
            <button onClick={() => { setShowAcqEdi(false); setAcqEdiData(null); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>
          <div className="edi-prep-notice">
            국민건강보험 Web EDI 업로드용 <b>정식 파일(XLSX)</b>을 준비 중입니다. 준비 완료 전까지 이 화면에서 제출용 파일을 내려받을 수 없습니다.
            취득 신고가 급하시면 <b>공단 Web EDI</b>에서 직접 진행해주세요.
          </div>
        </div>
      )}

      {showForm && (
        <div className="employee-invite-form glass-card">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="text-sm font-bold">{addExisting ? "기존 회원 직원 추가" : "직원 초대"}</h4>
            <div className="ml-auto flex gap-1 p-0.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <button onClick={() => setAddExisting(false)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${!addExisting ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}>이메일 초대</button>
              <button onClick={() => setAddExisting(true)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${addExisting ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}>이미 가입한 회원</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이메일 *</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="user@company.com" className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이름</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="홍길동" className="field-input" /></div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">권한</label>
              <div className="px-3 py-2.5 rounded-xl text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)]">
                멤버로 합류 — 합류 후 구성원 상세의 <b>탭 권한</b>에서 마스터가 메뉴·기능을 부여합니다
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {/* 목록 선택 + 직접 추가 (2026-08-19 사장님) */}
            <DepartmentField companyId={companyId} value={form.department} onChange={(v: string) => setForm({ ...form, department: v })} />
            <PositionField companyId={companyId} label="직위" value={form.position} onChange={(v: string) => setForm({ ...form, position: v })} />
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">사번</label><input type="text" value={form.employeeNumber} onChange={e => setForm({ ...form, employeeNumber: e.target.value })} placeholder="예: 2026-014" className="field-input" /><p className="text-[10px] text-[var(--text-dim)] mt-0.5">명단은 사번 순, 없으면 이름 순</p></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">입사일</label><DateField value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} className="field-input" />{!form.hireDate && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">비워두면 오늘 날짜로 설정됩니다</p>}</div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">연봉</label><input type="text" inputMode="numeric" value={form.salary ? Number(form.salary).toLocaleString('ko-KR') : ''} onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setForm({...form, salary: raw}); }} placeholder="36,000,000" className="field-input" />{form.salary && Number(form.salary) > 0 && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">월 ₩{Math.round(Number(form.salary) / 12).toLocaleString('ko-KR')}</p>}</div>
            <div className="flex items-end gap-2">
              {addExisting ? (
                <button onClick={() => form.email.trim() && addExistingMut.mutate()} disabled={!form.email.trim() || addExistingMut.isPending} className="flex-1 btn-primary">
                  {addExistingMut.isPending ? "추가중..." : "직원으로 추가"}
                </button>
              ) : (
                <button onClick={() => form.email.trim() && inviteMut.mutate()} disabled={!form.email.trim() || inviteMut.isPending} className="flex-1 btn-primary">
                  {inviteMut.isPending ? "전송중..." : "초대 전송"}
                </button>
              )}
              <button onClick={() => setShowForm(false)} className="px-3 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
          {addExisting ? (
            <p className="text-[10px] text-[var(--warning)]">이미 가입한 회원의 이메일로 바로 추가합니다. <b>해당 회원의 계정 소속이 우리 회사로 변경되고 멤버로 합류합니다(권한은 마스터가 부여).</b> (초대 이메일 없이 즉시 적용)</p>
          ) : (
            <p className="caption">초대 이메일이 발송되며, 직원이 가입 후 계약서 서명까지 완료하면 급여가 자동 반영됩니다.</p>
          )}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="employee-pending-invites">
          <h4 className="text-xs font-bold text-[var(--text-muted)] mb-2">초대 대기중</h4>
          <div className="space-y-2">
            {pendingInvites.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--warning)]/5 border border-[var(--warning)]/10">
                <div>
                  <div className="text-sm font-medium">{inv.name || inv.email}</div>
                  <div className="text-xs text-[var(--text-dim)]">{inv.email} · 멤버</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => resend(inv)} disabled={resending === inv.invite_token} className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50">
                    {resending === inv.invite_token ? "발송중..." : "재발송"}
                  </button>
                  <button onClick={() => copyLink(inv.invite_token)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)]">
                    {copiedToken === inv.invite_token ? "복사됨!" : "링크"}
                  </button>
                  <button onClick={() => cancelMut.mutate(inv)} className="text-xs text-[var(--danger)]/60 hover:text-[var(--danger)]">취소</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Salary Tab ──
//   SalaryTab(급여이력, V1 에서 라우팅 제거된 죽은 코드 557줄)은 2026-08-27 3차에서 삭제. 급여 변경은 상세 패널 › 이력(hr_appointments)이 맡는다.

function attAvatarColor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const palette = ["#6C5CE7", "#0984E3", "#00B894", "#E17055", "#00CEC9", "#A29BFE", "#FF7675", "#55A3FF"];
  return palette[Math.abs(h) % palette.length];
}
const attInitials = (name: string) => (/[가-힣]/.test(name || "") ? (name || "").slice(-2) : (name || "").slice(0, 2).toUpperCase());
// 16~20px 작은 원에는 한 글자만 — 두 글자(8px×2 = 원 폭)를 넣으면 뚫고 나가 깨져 보인다 (2026-08-19 사장님 제보)
const attInitial1 = (name: string) => (/[가-힣]/.test(name || "") ? (name || "").slice(-1) : (name || "").slice(0, 1).toUpperCase());

// ── Attendance Tab ──
// 'YYYY-MM' 을 delta 개월 이동 (연 경계 넘김 포함). 마이페이지 근태와 같은 규약.
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

//   mode (2026-08-19 사장님): "records" = 달력·그 날 현황(기록 상세 갈래), "summary" = 부서→직원 월간 요약만(월간 요약 갈래, 예전 연장근무 갈래 자리)
export function AttendanceTab({ employees, companyId, userId, userEmail, queryClient, role, mode = "records" }: any) {
  const { toast } = useToast();
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  // 직원 역할은 '데이터'(표) 기본 — 본인 기록 옆 '수정 요청' 동선이 표에 있음. 관리자는 캘린더 조망 유지.
  const [viewMode, setViewMode] = useState<"calendar" | "table">(role === "employee" ? "table" : "calendar");
  const showDerivedAbsence = true; // 결근 자동표시(과거 평일 무기록) — 항상 on (2026-07-15 리디자인에서 토글 UI 제거)
  // 근태 캘린더 리디자인(2026-07-15) — 선택한 날짜(우측 패널에 그 날 직원별 출근 현황 표시).
  //   기본값은 오늘(선택 월이 이번 달일 때만) — 이미지 시안처럼 진입 시 바로 오늘 상세가 보임.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // 직원별 월간 요약 카드 클릭 시 상세(수당내역·근무내역) 모달.
  const [summaryDetailId, setSummaryDetailId] = useState<string | null>(null);
  //   직원별 월간 요약 표 — 정렬·이름 검색 (2026-08-19)
  const [sumSort, setSumSort] = useState<SortState<string>>({ key: "name", dir: "asc" });
  const [sumQ, setSumQ] = useState("");
  const [sumOpen, setSumOpen] = useState<Map<string, boolean>>(new Map());
  //   월간 요약 검색조건 (2026-08-19 사장님: "연차 걸면 이 달 연차 쓴 사람만" 처럼 지표로 사람을 거른다)
  type SumCond = { depts: string[]; has: string[]; ratioMax: string; hoursMin: string; hoursMax: string };
  const SUM_COND0: SumCond = { depts: [], has: [], ratioMax: "", hoursMin: "", hoursMax: "" };
  const [sumCond, setSumCond] = useState<SumCond>(SUM_COND0);
  const [sumDraft, setSumDraft] = useState<SumCond>(SUM_COND0);
  const [sumPanel, setSumPanel] = useState(false);
  const SUM_HAS: [string, string][] = [["leaveDays", "연차 쓴 사람"], ["lateDays", "지각 있음"], ["absentDays", "결근 있음"], ["remoteDays", "재택 있음"], ["halfDays", "반차 있음"], ["overtimeMinutesSum", "연장근무 있음"], ["nightMinutesSum", "야간근무 있음"], ["holidayMinutesSum", "휴일근무 있음"], ["alwTotal", "수당 있음"]];
  const [dayDeptOpen, setDayDeptOpen] = useState<Map<string, boolean>>(new Map());
  // 표시용 상태 — 두 컬럼의 축이 다르다 (2026-08-07 정리).
  //   status  = 그 날의 근무 형태(출근/재택/반차/결근)
  //   is_late = 지각 여부. 실제 출근시각과 회사 유예로만 정해진다.
  //   재택·반차·결근은 형태를 그대로 보여 주고, 그 외에만 지각/정상출근을 가른다.
  const effectiveStatus = (r: { is_late?: boolean | null; status?: string | null }): string => {
    const s = r.status || 'present';
    if (s === 'remote' || s === 'half_day' || s === 'absent') return s;
    return r.is_late ? 'late' : 'present';
  };

  // Get month start/end for queries
  const monthStart = `${selectedMonth}-01`;
  const [ey, em] = selectedMonth.split('-').map(Number);
  const monthEnd = `${selectedMonth}-${String(new Date(ey, em, 0).getDate()).padStart(2, '0')}`;

  // Attendance records for the month
  const { data: records = [] } = useQuery({
    queryKey: ["attendance", companyId, selectedMonth],
    queryFn: () => getAttendanceRecords(companyId!, monthStart, monthEnd),
    enabled: !!companyId,
  });
  //   데이터(표) 보기 머리단 — 정렬·≡ 필터·너비 (2026-08-18 조회 표준, 다른 표와 같은 부품)
  type ArKey = "emp" | "date" | "in" | "out" | "hours" | "status";
  const [arSort, setArSort] = useState<SortState<ArKey>>({ key: "date", dir: "desc" });
  const onArSort = (k: ArKey) => setArSort((c) => nextSort(c, k));
  const arCf = useColFilters();
  const arTableRef = useRef<HTMLTableElement | null>(null);
  const [arColW, setArColW] = useColWidths("attendance-records-colw-v1", { emp: 120, date: 110, in: 130, out: 130, hours: 90, ot: 90, status: 200, action: 120 });
  const arResize = (k: string, colIndex: number) => ({ k, colIndex, widths: arColW, onResize: setArColW, tableRef: arTableRef });

  // 결근 파생용 — 해당 월 승인 휴가(기록 없는 평일을 결근으로 판정하되 휴가일은 제외).
  const { data: monthLeaves = [] } = useQuery({
    queryKey: ["attendance-cal-leaves", companyId, selectedMonth],
    queryFn: async () => {
      const data = await fetchPaged<any>('employees:monthLeaves', () => (supabase).from("leave_requests")
        .select("employee_id, start_date, end_date, status")
        .eq("company_id", companyId).eq("status", "approved")
        .lte("start_date", monthEnd).gte("end_date", monthStart).order("start_date"), 20000);
      return data || [];
    },
    enabled: !!companyId,
  });
  const leaveDaySet = useMemo(() => {
    const s = new Set<string>();
    for (const lv of monthLeaves as any[]) {
      if (!lv.start_date || !lv.end_date) continue;
      let d = new Date(String(lv.start_date).slice(0, 10) + "T00:00:00Z");
      const end = new Date(String(lv.end_date).slice(0, 10) + "T00:00:00Z");
      let guard = 0;
      while (d <= end && guard++ < 400) { s.add(`${lv.employee_id}:${d.toISOString().slice(0, 10)}`); d = new Date(d.getTime() + 86400000); }
    }
    return s;
  }, [monthLeaves]);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // 결근 파생용 — 회사 공휴일 (2026-08-19 사장님: 공휴일에 출근 안 한 날이 결근으로 표시됨).
  //   지각 판정(attendance-checkin 엣지)은 이미 holidays 를 보는데 결근 파생만 주말 제외였다.
  const { data: monthHolidays = [] } = useQuery({
    queryKey: ["attendance-cal-holidays", companyId, selectedMonth],
    queryFn: async () => {
      const data = logRead('employees/page:holidays', await (supabase).from("holidays")
        .select("date, name")
        .eq("company_id", companyId)
        .gte("date", monthStart).lte("date", monthEnd));
      return data || [];
    },
    enabled: !!companyId,
  });
  const holidayDaySet = useMemo(
    () => new Set((monthHolidays as any[]).map((h) => String(h.date).slice(0, 10))),
    [monthHolidays],
  );
  const holidayNameByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of monthHolidays as any[]) m.set(String(h.date).slice(0, 10), h.name || "공휴일");
    return m;
  }, [monthHolidays]);

  // Monthly summary
  const { data: summary = [] } = useQuery({
    queryKey: ["attendance-summary", companyId, selectedMonth],
    queryFn: () => getMonthlyAttendanceSummary(companyId!, selectedMonth),
    enabled: !!companyId,
  });

  // 관리자 분기 — 직원별 월간 요약 표의 수당 컬럼 데이터 (allowance_entries × allowance_types).
  //   직원 분기 미조회 (enabled 가드). admin RLS 통과.
  const isAdminForAllowance = role === 'owner' || role === 'admin';
  const { data: monthlyAllowanceEntries = [] } = useQuery({
    queryKey: ["allowance-entries-monthly-summary", companyId, selectedMonth],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase;
      const data = logRead('employees/page:data', await db
        .from('allowance_entries')
        .select('employee_id, amount, allowance_types!inner(code, name, is_active)')
        .eq('company_id', companyId)
        .eq('payroll_month', selectedMonth)
        .filter('allowance_types.is_active', 'eq', true));
      return (data as Array<{ employee_id: string; amount: number; allowance_types: { code: string; name: string } | null }>) || [];
    },
    enabled: !!companyId && isAdminForAllowance,
  });

  // ⚠️ 비활성화 (2026-05-21 504 인시던트 3차) — 클라이언트 마운트마다 자동 호출이
  //   사용자 동시 진입·hot reload 시 폭증 → DB hung. 5/19·5/20 패턴 재발 차단.
  //   대안: 사용자가 화면의 "월 일괄 재계산" 버튼 수동 클릭 (MonthlyRecomputeButton).
  //   근본 해결: 별건 PR — pg_cron 1시간 1회 배치 + advisory lock 으로 동시 실행 1개 제한.
  // recomputeMonthlyAllowancesForCompany 자동 호출은 본 PR 에서 제거됨.

  // Admin attendance correction
  const isAdmin = role === "owner" || role === "admin";
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ check_in: "", check_out: "", status: "" });

  // 직원 본인 — 근태 수정 요청(관리자 승인 후 반영). 관리자는 위 인라인 '수정'으로 직접 보정.
  //   본인 직원 레코드 매칭: user_id 우선, 이메일 폴백(초대 수락 전 user_id 미연결 대비).
  const myEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of (employees as any[]) || []) {
      const byUser = userId && e.user_id === userId;
      const byEmail = userEmail && e.email && String(e.email).toLowerCase() === String(userEmail).toLowerCase();
      if (byUser || byEmail) ids.add(e.id);
    }
    return ids;
  }, [employees, userId, userEmail]);
  const [manualRecordOpen, setManualRecordOpen] = useState(false);
  const canRequestEdit = !isAdmin && myEmployeeIds.size > 0;
  // 관리(수정/수정 요청) 컬럼 노출 조건 — 관리자 전체, 직원은 본인 기록만.
  const showActionCol = isAdmin || canRequestEdit;
  const [editRequestRecord, setEditRequestRecord] = useState<any | null>(null);

  const doCorrectAttendance = useMutation({
    mutationFn: ({ recordId, updates }: { recordId: string; updates: { check_in?: string; check_out?: string; status?: string } }) =>
      correctAttendanceRecord(recordId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
      setEditingRecordId(null);
    },
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  const startEditing = (record: any) => {
    setEditingRecordId(record.id);
    // ⚠️ slice(0,16) 금지 — timestamptz 는 UTC 문자열이라 KST 18:30 이 09:30 으로 들어가고,
    //    그대로 저장하면 기록이 매번 9시간씩 밀렸다(2026-07-27 사장님 제보).
    setEditForm({
      check_in: kstDateTimeLocal(record.check_in),
      check_out: kstDateTimeLocal(record.check_out),
      status: record.status || "present",
    });
  };

  const submitCorrection = () => {
    if (!editingRecordId) return;
    const updates: { check_in?: string; check_out?: string; status?: string } = {};
    // 픽커 값은 KST 로 해석한다(브라우저 타임존 무관 — 읽기와 대칭).
    const ci = kstLocalToIso(editForm.check_in);
    const co = kstLocalToIso(editForm.check_out);
    if (ci) updates.check_in = ci;
    if (co) updates.check_out = co;
    if (editForm.status) updates.status = editForm.status;
    doCorrectAttendance.mutate({ recordId: editingRecordId, updates });
  };

  // Build calendar data
  const calendarData = useMemo(() => {
    const year = Number(selectedMonth.split("-")[0]);
    const month = Number(selectedMonth.split("-")[1]);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=Sun

    // Map: employeeId -> { date -> status }
    const empMap: Record<string, Record<string, string>> = {};
    records.forEach((r: any) => {
      if (!empMap[r.employee_id]) empMap[r.employee_id] = {};
      empMap[r.employee_id][r.date] = effectiveStatus(r);
    });

    return { year, month, daysInMonth, firstDayOfWeek, empMap };
  }, [selectedMonth, records]);


  const statusColor = (status: string) => {
    switch (status) {
      case "present": return "bg-[var(--success)]";
      case "late": return "bg-yellow-500";
      case "absent": return "bg-[var(--danger)]";
      case "half_day": return "bg-orange-400";
      case "remote": return "bg-[var(--info)]";
      default: return "bg-gray-400";
    }
  };

  //   달력 상자 채움용 실제 색값 — statusColor(tailwind 클래스)와 같은 색 (2026-08-27)
  const statusCssColor = (status: string) => {
    switch (status) {
      case "present": return "var(--success)";
      case "late": return "#eab308";
      case "absent": return "var(--danger)";
      case "half_day": return "#fb923c";
      case "remote": return "var(--info)";
      default: return "#9ca3af";
    }
  };
  const statusLabel = (status: string) => {
    return ATTENDANCE_STATUS.find((s) => s.value === status)?.label || status;
  };

  // active + joined 모두 포함 (초대 수락 후 아직 active 아닌 직원도 체크인 가능)
  const arVal = (r: any) => ({ emp: r.employees?.name || "—", status: statusLabel(effectiveStatus(r)) });
  const arSpec = (k: keyof ReturnType<typeof arVal>) => arCf.spec(k, (records as any[]).map((r) => arVal(r)[k]));
  //   직원 순서 = 사번 순 → 가나다 → ABC (lib/people-sort, 2026-08-27 사장님 — 인사 전 화면 공통)
  const empById = useMemo(() => new Map((employees as any[]).map((e: any) => [e.id, e])), [employees]);
  const shownRecords = useMemo(() => {
    const dir = arSort.dir === "asc" ? 1 : -1;
    const val = (r: any): string => {
      switch (arSort.key) {
        case "emp": return r.employees?.name || "";
        case "in": return r.check_in || "";
        case "out": return r.check_out || "";
        case "hours": return String(Number(r.work_hours || 0)).padStart(8, "0");
        case "status": return statusLabel(effectiveStatus(r));
        default: return `${r.date || ""} ${r.check_in || ""}`;
      }
    };
    const byEmp = (a: any, b: any) => comparePeople(empById.get(a.employee_id) || { name: a.employees?.name }, empById.get(b.employee_id) || { name: b.employees?.name });
    return (records as any[]).filter((r) => arCf.hit(arVal(r))).sort((a, b) => (arSort.key === "emp" ? byEmp(a, b) * dir || String(a.date).localeCompare(String(b.date)) : cmp(val(a), val(b)) * dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, arSort, arCf.key, empById]);
  const activeEmployees = employees.filter((e: any) => e.status === "active" || e.status === "joined");
  // employee 역할: 본인 직원 레코드 자동 선택 (user_id 매칭 → 이메일 폴백)
  const isEmployeeRole = role === "employee";

  // 관리자 분기 — 직원별 월간 수당 합산 (allowance_entries × allowance_types).
  //   key: employee_id → { overtime, night, holiday, on_duty, etc, total }
  //   allowance_types.code 기준 매칭 — 회사별 커스텀 코드는 'etc' 로 합산.
  const allowanceByEmployee = useMemo(() => {
    const m = new Map<string, { overtime: number; night: number; holiday: number; on_duty: number; etc: number; total: number }>();
    for (const row of monthlyAllowanceEntries) {
      const emp = row.employee_id;
      const amt = Number(row.amount || 0);
      if (!emp) continue;
      const code = (row.allowance_types?.code || '').toLowerCase();
      if (!m.has(emp)) m.set(emp, { overtime: 0, night: 0, holiday: 0, on_duty: 0, etc: 0, total: 0 });
      const e = m.get(emp)!;
      if (code === 'overtime') e.overtime += amt;
      else if (code === 'night') e.night += amt;
      else if (code === 'holiday') e.holiday += amt;
      else if (code === 'on_duty') e.on_duty += amt;
      else e.etc += amt;
      e.total += amt;
    }
    return m;
  }, [monthlyAllowanceEntries]);

  // 2026-05-22 오늘 출퇴근 현황 — KST 오늘 기준 출근/지각/휴가 집계 (records 의존 X, 별도 fetch).
  const kstToday = useMemo(() => todayKst(), []);
  const { data: todayStatus } = useQuery({
    queryKey: ["today-attendance-status", companyId, kstToday],
    queryFn: async () => {
      const [attRes, leaveRes] = await Promise.all([
        (supabase).from("attendance_records").select("employee_id, status, is_late").eq("company_id", companyId).eq("date", kstToday),
        (supabase).from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", kstToday).gte("end_date", kstToday),
      ]);
      const present = new Set<string>();
      const late = new Set<string>();
      for (const r of (attRes.data || []) as any[]) {
        if (r.is_late) late.add(r.employee_id);   // 지각 판정은 is_late 단일 소스 (2026-08-07)
        else present.add(r.employee_id);
      }
      const leaveSet = new Set<string>(((leaveRes.data || []) as any[]).map((r) => r.employee_id));
      // 휴가자는 출근/지각 집계에서 제외(중복 방지)
      for (const id of leaveSet) { present.delete(id); late.delete(id); }
      return {
        present: present.size, late: late.size, leave: leaveSet.size,
        presentIds: [...present], lateIds: [...late], leaveIds: [...leaveSet],
      };
    },
    enabled: !!companyId && !isEmployeeRole,
    staleTime: 60_000,
  });
  // 오늘 통계 카드 클릭 → 명단 펼침 (2026-07-30 사장님: 숫자만으론 누구인지 모름)
  const [todayStatOpen, setTodayStatOpen] = useState<string | null>(null);
  const todayStatNames = useMemo(() => {
    const nameOf = (id: string) => (employees as any[]).find((e: any) => e.id === id)?.name || "구성원";
    const present = (todayStatus?.presentIds || []).map(nameOf);
    const late = (todayStatus?.lateIds || []).map(nameOf);
    const leave = (todayStatus?.leaveIds || []).map(nameOf);
    const counted = new Set([...(todayStatus?.presentIds || []), ...(todayStatus?.lateIds || []), ...(todayStatus?.leaveIds || [])]);
    // 공휴일·주말엔 결근 명단도 비운다 + 입사 전 직원 제외 (2026-08-19 감사: 카드는 0인데
    // 클릭하면 전 직원 명단이 나오던 모순).
    const todayIsOff = holidayDaySet.has(todayStr) || [0, 6].includes(today.getDay());
    const absent = todayIsOff ? [] : activeEmployees
      .filter((e: any) => !counted.has(e.id) && (!e.hire_date || todayStr >= String(e.hire_date).slice(0, 10)))
      .map((e: any) => e.name || "구성원");
    return { present, late, absent, leave } as Record<string, string[]>;
  }, [todayStatus, employees, activeEmployees, holidayDaySet, todayStr]);

  // 캘린더에서 선택한 날짜 — 없으면 조회 중인 달이 이번 달일 때만 오늘을 기본 선택(시안처럼 진입 시 바로 상세 노출).
  const effectiveSelectedDay = selectedDay || (
    selectedMonth === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}` ? todayStr : null
  );

  // 선택한 날짜의 직원별 출근 현황(상태별 그룹) — 캘린더 셀 클릭 시 우측 패널에 표시.
  const dayDetail = useMemo(() => {
    if (!effectiveSelectedDay) return null;
    const dow = new Date(`${effectiveSelectedDay}T00:00:00`).getDay();
    const isPast = effectiveSelectedDay < todayStr;
    const byStatus: Record<string, { id: string; name: string; department: string }[]> = {};
    activeEmployees.forEach((emp: any) => {
      const rec = records.find((r: any) => r.employee_id === emp.id && r.date === effectiveSelectedDay);
      let status = rec ? effectiveStatus(rec) : (calendarData.empMap[emp.id]?.[effectiveSelectedDay] || null);
      if (!status && isPast && dow !== 0 && dow !== 6 && !holidayDaySet.has(effectiveSelectedDay) && showDerivedAbsence) {
        const onLeave = leaveDaySet.has(`${emp.id}:${effectiveSelectedDay}`);
        const employed = !emp.hire_date || effectiveSelectedDay >= String(emp.hire_date).slice(0, 10);
        if (!onLeave && employed) status = "absent";
      }
      if (status) {
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push({ id: emp.id, name: emp.name, department: emp.department || "미배정" });
      }
    });
    return byStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSelectedDay, activeEmployees, records, calendarData, leaveDaySet, showDerivedAbsence, todayStr, holidayDaySet]);

  return (
    <div>
      {/* Controls: 타이틀 + 월 표시 + 캘린더/데이터 토글 + CSV Export (2026-07-15 리디자인 — 시안과 동일하게 단순화) */}
      <div className="attendance-toolbar">
        <div className="flex items-center gap-2.5">
          {/* 달력 넘기기 — 화살표로 전달/다음달 이동 (2026-08-07 사장님 제보: 월 선택기만으로는 불편) */}
          <div className="attendance-month-nav">
            <button
              onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
              className="attendance-month-btn"
              aria-label="이전 달"
              title="이전 달"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <MonthField
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-2 py-1 bg-transparent border-0 text-sm text-[var(--text-muted)] focus:outline-none"
            />
            <button
              onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
              className="attendance-month-btn"
              aria-label="다음 달"
              title="다음 달"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {mode === "records" && <ChipGroup value={viewMode} onChange={setViewMode} options={[{ value: "calendar", label: "캘린더" }, { value: "table", label: "데이터" }] as const} />}
          {/* 관리자 대행 기록 — 직원이 출근 버튼을 못 눌렀을 때 대신 찍어준다(2026-07-27). */}
          {mode === "records" && isAdmin && companyId && (
            <button
              type="button"
              onClick={() => setManualRecordOpen(true)}
              className="btn-primary btn-sm"
            >
              + 기록
            </button>
          )}
          {/* L 근태 — C-3 관리자: 가산수당 재계산 (월 일괄) */}
          {mode === "summary" && isAdmin && companyId && (
            <MonthlyRecomputeButton companyId={companyId} from={monthStart} to={monthEnd} />
          )}
          {/*   2026-08-27 인사 6차 — 엑셀은 엑셀▾ 하나로(다른 화면과 같은 모양) */}
          {summary.length > 0 && (
            <ExcelMenu items={[{ label: "월간 요약 내려받기", count: summary.length, hint: "부서·직원별 출근·지각·연장·야간·휴일·결근·총근무", onClick: () => {
                //   다른 화면과 같은 공통 함수로 (2026-08-12) — 숫자는 서식 없이 넘겨 엑셀이 숫자로 읽게 한다
                downloadCsv(
                  `근태_월간요약_${selectedMonth}`,
                  ["부서", "직원", "출근일", "지각횟수", "지각합계(분)", "연장(분)", "야간(분)", "휴일(분)", "결근", "재택", "반차", "총근무(h)"],
                  (summary as any[]).map((s) => [
                    s.department || "미배정", s.name, s.totalDays, s.lateDays, Math.round(s.lateMinutesSum || 0),
                    Math.round(s.overtimeMinutesSum || 0), Math.round(s.nightMinutesSum || 0), Math.round(s.holidayMinutesSum || 0),
                    s.absentDays, s.remoteDays, s.halfDays, Number(s.totalHours.toFixed(1)),
                  ]),
                );
              } }]} />
          )}
        </div>
      </div>

      {/* Calendar View — 2026-07-15 리디자인: 좌 월간 캘린더 + 우 오늘 통계·선택일 상세(관리자 전용) */}
      {mode === "records" && viewMode === "calendar" && (
        <div className={`attendance-calendar-view ${!isEmployeeRole ? "lg:grid-cols-4" : ""}`}>
          <div className={`attendance-calendar glass-card ${!isEmployeeRole ? "lg:col-span-3" : ""}`}>
            {/* 헤더: 타이틀 + 범례 */}
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-[var(--border)]">
              <span className="text-sm font-bold text-[var(--text)]">월간 출근 현황</span>
              <div className="flex gap-2.5 flex-wrap items-center">
                {ATTENDANCE_STATUS.map((s) => (
                  <span key={s.value} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <span className={`w-2 h-2 rounded-full ${statusColor(s.value)}`} />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Calendar header: days of week */}
            <div className="grid grid-cols-7 border-b border-[var(--border)]">
              {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                <div key={d} className={`text-center text-xs font-medium py-2 ${i === 0 ? "text-[var(--danger)]" : i === 6 ? "text-[var(--info)]" : "text-[var(--text-dim)]"}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar body */}
            <div className="grid grid-cols-7">
              {/* Empty cells before first day */}
              {Array.from({ length: calendarData.firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[120px] border-b border-r border-[var(--border)]/30 bg-[var(--bg-surface)]/30" />
              ))}

              {/* Day cells */}
              {Array.from({ length: calendarData.daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                const isSelected = dateStr === effectiveSelectedDay;
                const dayOfWeek = (calendarData.firstDayOfWeek + i) % 7;
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                // Get all employee statuses for this day, aggregated into per-status counts
                //   (시안: 사람별 칩이 아니라 "●출근 7" 처럼 상태별 집계 pill — 개인 목록은 우측 선택일 패널에서).
                // 공휴일 제외 (2026-08-19): 주말만 빼고 공휴일을 안 봐서 광복절 등 쉬는 날이
                //   전 직원 결근으로 표시됐다. 지각 판정(엣지)과 동일하게 holidays 를 반영.
                const isPastWeekday = dateStr < todayStr && !isWeekend && !holidayDaySet.has(dateStr);
                const dayStatusCounts = new Map<string, number>();
                activeEmployees.forEach((emp: any) => {
                  const rec = records.find((r: any) => r.employee_id === emp.id && r.date === dateStr);
                  let status = rec ? effectiveStatus(rec) : (calendarData.empMap[emp.id]?.[dateStr] || null);
                  // 결근 파생: 기록 없는 과거 평일(공휴일 제외) + 휴가 아님 + 입사일 이후 → 결근 (토글 ON일 때만)
                  if (!status && isPastWeekday && showDerivedAbsence) {
                    const onLeave = leaveDaySet.has(`${emp.id}:${dateStr}`);
                    const employed = !emp.hire_date || dateStr >= String(emp.hire_date).slice(0, 10);
                    if (!onLeave && employed) status = "absent";
                  }
                  if (status) dayStatusCounts.set(status, (dayStatusCounts.get(status) || 0) + 1);
                });

                return (
                  <button
                    type="button"
                    key={day}
                    onClick={() => setSelectedDay((cur) => (cur === dateStr ? null : dateStr))}
                    className={`min-h-[120px] border-b border-r border-[var(--border)]/30 p-2.5 text-left transition ${
                      isSelected ? "ring-2 ring-inset ring-[var(--primary)] bg-[var(--primary)]/8" : isToday ? "bg-[var(--primary)]/5" : isWeekend ? "bg-[var(--bg-surface)]/30" : "hover:bg-[var(--bg-surface)]/50"
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1.5 flex items-center gap-1 ${
                      isToday ? "text-[var(--primary)] font-bold" : (dayOfWeek === 0 || holidayDaySet.has(dateStr)) ? "text-[var(--danger)]" : dayOfWeek === 6 ? "text-[var(--info)]" : "text-[var(--text-muted)]"
                    }`}>
                      {isSelected ? <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-white text-[11px] flex items-center justify-center font-bold">{day}</span> : day}
                      {/* 공휴일 이름 표시 (2026-08-19 사장님: "—"만 보이면 왜 쉬는 날인지 모름) */}
                      {holidayDaySet.has(dateStr) && (
                        <span className="text-[10px] font-semibold text-[var(--danger)] truncate">{holidayNameByDate.get(dateStr)}</span>
                      )}
                    </div>
                    {/*   2026-08-27 사장님 — 워크보드 셀과 같은 톤: 상태별 작은 상자(테두리·바닥 채움·오른쪽 색띠·칩+인원). 채움 폭 = 그 상태 인원 ÷ 재직 인원 */}
                    <div className="att-cal-rows">
                      {ATTENDANCE_STATUS.filter((s) => dayStatusCounts.get(s.value)).map((s) => {
                        const n = dayStatusCounts.get(s.value) || 0; const c = statusCssColor(s.value);
                        return (
                          <span key={s.value} className="att-cal-row" title={`${s.label} ${n}명`}>
                            <span className="att-cal-fill" style={{ width: `${Math.max(12, Math.round((n / Math.max(1, activeEmployees.length)) * 100))}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${c} 20%, transparent), color-mix(in srgb, ${c} 6%, transparent))` }}><span className="att-cal-edge" style={{ background: c }} /></span>
                            <span className="att-cal-chip" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>{s.label}</span>
                            <span className="att-cal-n">{n}</span>
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 우 — 오늘 통계 2x2 + 선택일 상세 (관리자 전용). 캘린더와 높이 맞춤(flex-1로 하단까지 채움). */}
          {!isEmployeeRole && (
            <div className="attendance-today-panel">
              {/* 카드 클릭 → 하단에 해당 인원 명단 (2026-07-30 사장님) */}
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: "present", label: "오늘 출근", count: todayStatus?.present ?? 0, cls: "text-[var(--text)]" },
                  { key: "late", label: "지각", count: todayStatus?.late ?? 0, cls: "text-yellow-500" },
                  // 공휴일·주말엔 오늘 결근 0 (2026-08-19) — 쉬는 날 전 직원이 결근으로 집계되지 않게.
                  { key: "absent", label: "결근", count: (holidayDaySet.has(todayStr) || [0, 6].includes(today.getDay())) ? 0 : Math.max(0, activeEmployees.length - (todayStatus?.present ?? 0) - (todayStatus?.late ?? 0) - (todayStatus?.leave ?? 0)), cls: "text-[var(--danger)]" },
                  { key: "leave", label: "자리비움", count: todayStatus?.leave ?? 0, cls: "text-[var(--info)]" },
                ] as const).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setTodayStatOpen((cur) => (cur === c.key ? null : c.key))}
                    className={`glass-card p-5 text-left transition ${todayStatOpen === c.key ? "ring-2 ring-inset ring-[var(--primary)]" : "hover:bg-[var(--bg-surface)]/60"}`}
                    title="클릭하면 해당 인원 명단이 아래에 표시됩니다"
                  >
                    <div className="text-xs text-[var(--text-dim)] mb-1.5">{c.label}</div>
                    <div className={`text-3xl font-extrabold ${c.cls}`}>{c.count}<span className="text-sm font-semibold text-[var(--text-dim)]"> 명</span></div>
                  </button>
                ))}
              </div>
              {todayStatOpen && (
                <div className="glass-card p-4">
                  <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                    오늘 {{ present: "출근", late: "지각", absent: "결근", leave: "자리비움" }[todayStatOpen]} — {todayStatNames[todayStatOpen]?.length ?? 0}명
                  </div>
                  {(todayStatNames[todayStatOpen] || []).length === 0 ? (
                    <div className="text-xs text-[var(--text-dim)]">해당 인원이 없습니다</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {todayStatNames[todayStatOpen].map((name, i) => (
                        <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]">{name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {effectiveSelectedDay && (() => {
                const [, , dStr] = effectiveSelectedDay.split("-");
                const dNum = Number(dStr);
                const weekday = new Date(`${effectiveSelectedDay}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "long" });
                const groups = ATTENDANCE_STATUS.filter((s) => dayDetail?.[s.value]?.length);
                return (
                  <div className="glass-card p-5 flex-1 flex flex-col min-h-0">
                    <div className="text-sm font-bold text-[var(--text)]">{dNum}일 {weekday}</div>
                    <div className="text-[11px] text-[var(--text-dim)] mb-3">캘린더의 날짜를 클릭하면 그 날 현황을 볼 수 있습니다</div>
                    {groups.length === 0 ? (
                      <div className="text-xs text-[var(--text-dim)]">해당 날짜 기록이 없습니다</div>
                    ) : (
                      <div className="space-y-3 overflow-y-auto">
                        {/* 상태 → 부서 → 이름 (2026-08-19 사장님: 직원이 많으면 이름 칩이 넘친다 → 부서 줄을 열어 본다) */}
                        {groups.map((s) => {
                          const list = dayDetail![s.value];
                          const depts = [...new Set(list.map((e) => e.department))].sort();
                          return (
                            <div key={s.value}>
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] mb-1">
                                <span className={`w-2 h-2 rounded-full ${statusColor(s.value)}`} />
                                {s.label} <span className="text-[var(--text-dim)] font-normal">{list.length}</span>
                              </div>
                              <ul className="att-day-depts">
                                {depts.map((d) => {
                                  const key = `${s.value}:${d}`;
                                  const members = list.filter((e) => e.department === d).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
                                  const open = dayDeptOpen.has(key) ? !!dayDeptOpen.get(key) : list.length <= 8;   //   사람이 적으면 처음부터 펼침
                                  return (
                                    <li key={d}>
                                      <button type="button" className="att-day-dept" onClick={() => setDayDeptOpen((o) => { const n = new Map(o); n.set(key, !open); return n; })}>
                                        <span className={`bs-caret ${open ? "rotate-90" : ""}`}>▸</span>{d} <em className="bs-cnt">{members.length}</em>
                                      </button>
                                      {open && (
                                        <div className="flex flex-wrap gap-1.5 pl-4 pt-1 pb-1.5">
                                          {members.map((emp) => (
                                            <span key={emp.id} className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]">
                                              <span className="w-5 h-5 rounded-full flex items-center justify-center overflow-hidden text-white text-[9px] font-bold shrink-0" style={{ background: attAvatarColor(emp.id) }}>{attInitial1(emp.name)}</span>
                                              {emp.name}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {mode === "records" && viewMode === "table" && (
        <div className="attendance-records-table">
          {records.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4"><Ico e="📊" /></div>
              <div className="text-sm text-[var(--text-muted)]">해당 월에 근태 기록이 없습니다</div>
            </div>
          ) : (
            <div className="ev-scroll leave-req-scroll"><table ref={arTableRef} className="ev-table ev-lined att-rec-table">
              <thead>
                <tr>
                  <SortableTh label="직원" sortKey="emp" sort={arSort} onSort={onArSort} filter={arSpec("emp")} resize={arResize("emp", 1)} />
                  <SortableTh label="날짜" sortKey="date" sort={arSort} onSort={onArSort} resize={arResize("date", 2)} />
                  <SortableTh label="출근" sortKey="in" sort={arSort} onSort={onArSort} resize={arResize("in", 3)} />
                  <SortableTh label="퇴근" sortKey="out" sort={arSort} onSort={onArSort} resize={arResize("out", 4)} />
                  <SortableTh label="근무시간" sortKey="hours" sort={arSort} onSort={onArSort} resize={arResize("hours", 5)} />
                  <SortableTh label="연장" resize={arResize("ot", 6)} />
                  <SortableTh label="상태" sortKey="status" sort={arSort} onSort={onArSort} filter={arSpec("status")} resize={arResize("status", 7)} />
                  {showActionCol && <SortableTh label="관리" resize={arResize("action", 8)} />}
                </tr>
              </thead>
              <tbody>
                {shownRecords.map((r: any) => (
                  editingRecordId === r.id ? (
                    <tr key={r.id} className="border-b border-[var(--border)]/50 bg-[var(--primary)]/5">
                      <td className="px-5 py-2 text-sm font-medium">{r.employees?.name || "—"}{empById.get(r.employee_id)?.employee_number && <span className="emp-no">#{empById.get(r.employee_id)?.employee_number}</span>}</td>
                      <td className="px-5 py-2 text-sm text-[var(--text-muted)]">{r.date}</td>
                      <td className="px-3 py-2">
                        <DateTimeField
                          value={editForm.check_in}
                          onChange={(e) => setEditForm({ ...editForm, check_in: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <DateTimeField
                          value={editForm.check_out}
                          onChange={(e) => setEditForm({ ...editForm, check_out: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-5 py-2 text-sm text-right text-[var(--text-dim)]">자동계산</td>
                      <td className="px-5 py-2 text-sm text-right text-[var(--text-dim)]">자동계산</td>
                      <td className="px-3 py-2">
                        <select
                          value={editForm.status}
                          onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        >
                          {ATTENDANCE_STATUS.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={submitCorrection}
                            disabled={doCorrectAttendance.isPending}
                            className="px-2 py-1 text-xs bg-[var(--success)] hover:brightness-110 text-white rounded-lg transition disabled:opacity-50"
                          >
                            {doCorrectAttendance.isPending ? "..." : "저장"}
                          </button>
                          <button
                            onClick={() => setEditingRecordId(null)}
                            className="px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-card)] transition"
                          >
                            취소
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                  <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-5 py-3 text-sm font-medium">{r.employees?.name || "—"}{empById.get(r.employee_id)?.employee_number && <span className="emp-no">#{empById.get(r.employee_id)?.employee_number}</span>}</td>
                    <td className="px-5 py-3 text-sm text-[var(--text-muted)]">{r.date}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.check_in ? new Date(r.check_in).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.check_out ? new Date(r.check_out).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-right">{r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : "—"}</td>
                    <td className="px-5 py-3 text-sm text-right text-orange-400">
                      {(() => {
                        // L 근태 — overtime_minutes 우선, 없으면 overtime_hours fallback
                        const om = Number(r.overtime_minutes || 0);
                        if (om > 0) {
                          const h = Math.floor(om / 60);
                          const m = om % 60;
                          return `+${h}h${m > 0 ? ` ${m}m` : ''}`;
                        }
                        const oh = Number(r.overtime_hours || 0);
                        return oh > 0 ? `+${oh.toFixed(1)}h` : "—";
                      })()}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {/* 기본 상태 배지 */}
                        {(() => {
                          const es = effectiveStatus(r);
                          return (
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                              es === "present" ? "bg-[var(--success)]/10 text-[var(--success)]"
                              : es === "late" ? "bg-yellow-500/10 text-yellow-400"
                              : es === "absent" ? "bg-[var(--danger)]/10 text-[var(--danger)]"
                              : es === "half_day" ? "bg-orange-500/10 text-orange-400"
                              : es === "remote" ? "bg-[var(--info)]/10 text-[var(--info)]"
                              : "bg-gray-500/10 text-gray-400"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusColor(es)}`} />
                              {statusLabel(es)}
                            </span>
                          );
                        })()}
                        {/* 갭①-B: 인라인 배지 매핑 → AttendanceBadges 컴포넌트로 통합.
                            관리자·직원 본인 뷰가 동일 출력 (MyAttendanceCard 도 같은 컴포넌트 사용). */}
                        <AttendanceBadges record={r} compact />
                      </div>
                    </td>
                    {showActionCol && (
                      <td className="px-5 py-3 text-center">
                        {isAdmin ? (
                          <button
                            onClick={() => startEditing(r)}
                            className="px-2.5 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition"
                          >
                            수정
                          </button>
                        ) : myEmployeeIds.has(r.employee_id) ? (
                          <button
                            onClick={() => setEditRequestRecord(r)}
                            className="px-2.5 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition"
                          >
                            수정 요청
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                  )
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* Monthly Summary per Employee */}
      {mode === "summary" && summary.length > 0 && (() => {
        const fmtKRW = (n: number): string => {
          const v = Math.round(Number(n) || 0);
          return v > 0 ? `${v.toLocaleString('ko-KR')}원` : "—";
        };
        // 진행바용 — 선택 월의 평일 수(이번 달이면 오늘까지) 대비 출근일 비율. 가짜 목표치 아닌 실제 평일수 기반.
        const [wy, wm] = selectedMonth.split('-').map(Number);
        const lastDayOfMonth = new Date(wy, wm, 0).getDate();
        const isCurrentSelectedMonth = selectedMonth === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const upToDay = isCurrentSelectedMonth ? today.getDate() : lastDayOfMonth;
        let workdaysSoFar = 0;
        for (let d = 1; d <= upToDay; d++) {
          const dow = new Date(wy, wm - 1, d).getDay();
          const ds = `${selectedMonth}-${String(d).padStart(2, '0')}`;
          if (dow !== 0 && dow !== 6 && !holidayDaySet.has(ds)) workdaysSoFar++;   // 공휴일 제외 (2026-08-19)
        }
        //   표 정렬·빠른검색 (2026-08-19 사장님: 직원이 많아지면 카드 격자로는 못 본다 → 표 + 정렬 + 검색)
        //   연차 = 이 달 승인 휴가일 수(leaveDaySet — 달력이 쓰는 것과 같은 것)
        const leaveCount = (empId: string) => { let n = 0; leaveDaySet.forEach((k: string) => { if (k.startsWith(`${empId}:${selectedMonth}-`)) n++; }); return n; };
        const rowsAll = (summary as any[]).map((s) => ({ ...s, employee_number: empById.get(s.employee_id)?.employee_number || null, ratio: workdaysSoFar > 0 ? Math.min(1, s.totalDays / workdaysSoFar) : 0, alwTotal: allowanceByEmployee.get(s.employee_id)?.total ?? 0, leaveDays: leaveCount(s.employee_id) }));
        const rows = rowsAll.filter((r) => quickSearchHit(sumQ, [r.name, r.department])
            && (sumCond.depts.length === 0 || sumCond.depts.includes(r.department || "미배정"))
            && sumCond.has.every((k) => Number((r as any)[k] || 0) > 0)
            && (!sumCond.ratioMax || r.ratio * 100 <= Number(sumCond.ratioMax))
            && (!sumCond.hoursMin || r.totalHours >= Number(sumCond.hoursMin))
            && (!sumCond.hoursMax || r.totalHours <= Number(sumCond.hoursMax)))
          .sort((a, b) => { const k = sumSort.key as string; if (k === "name") return comparePeople(a, b) * (sumSort.dir === "asc" ? 1 : -1); const av = (a as any)[k], bv = (b as any)[k]; const c = typeof av === "number" && typeof bv === "number" ? av - bv : cmp(av, bv); return c * (sumSort.dir === "asc" ? 1 : -1) || comparePeople(a, b); });
        //   부서 묶음 (2026-08-19 사장님: 부서별로 정렬하고 토글을 열면 그 부서 직원) — 부서 줄은 합계·평균, 직원 줄은 열어야 보인다
        const deptMap = new Map<string, any[]>();
        for (const r of rows) { const d = r.department || "미배정"; if (!deptMap.has(d)) deptMap.set(d, []); deptMap.get(d)!.push(r); }
        for (const list of deptMap.values()) list.sort(comparePeople);   // 부서 안 직원 순서도 같은 규칙
        const deptRows = [...deptMap.entries()].map(([d, list]) => ({
          department: d, list, n: list.length,
          totalDays: list.reduce((x, r) => x + (r.totalDays || 0), 0) / list.length,
          leaveDays: list.reduce((x, r) => x + (r.leaveDays || 0), 0),
          nightMinutesSum: list.reduce((x, r) => x + (r.nightMinutesSum || 0), 0), holidayMinutesSum: list.reduce((x, r) => x + (r.holidayMinutesSum || 0), 0),
          ratio: list.reduce((x, r) => x + (r.ratio || 0), 0) / list.length,
          lateDays: list.reduce((x, r) => x + (r.lateDays || 0), 0), absentDays: list.reduce((x, r) => x + (r.absentDays || 0), 0),
          remoteDays: list.reduce((x, r) => x + (r.remoteDays || 0), 0), halfDays: list.reduce((x, r) => x + (r.halfDays || 0), 0),
          overtimeMinutesSum: list.reduce((x, r) => x + (r.overtimeMinutesSum || 0), 0), totalHours: list.reduce((x, r) => x + (r.totalHours || 0), 0),
          alwTotal: list.reduce((x, r) => x + (r.alwTotal || 0), 0),
        })).sort((a, b) => { const k = sumSort.key as string; if (k === "name") return a.department.localeCompare(b.department) * (sumSort.dir === "asc" ? 1 : -1); const av = (a as any)[k] ?? 0, bv = (b as any)[k] ?? 0; return (av - bv) * (sumSort.dir === "asc" ? 1 : -1); });
        const autoOpen = rowsAll.length <= 15;   //   직원이 적으면 처음부터 펼쳐 둔다
        const th = (label: string, key: string) => (
          <th><button type="button" className="ev-th-btn" onClick={() => setSumSort((c) => nextSort(c, key as any, key === "name" ? "asc" : "desc"))}>{label}{sumSort.key === key ? (sumSort.dir === "asc" ? " ▲" : " ▼") : ""}</button></th>
        );
        return (
          <div className="attendance-monthly-summary">
            {/* 조회 줄 — [검색조건 ▾ · 빠른검색] ‖ 모두 펼침/접기 (2026-08-19). 검색조건: 부서 · 이 달에 …한 사람 · 출근율 이하 · 총 근무 범위 */}
            <div className="qk-bar mb-2">
              <div className="qk-bar-left">
                <ConditionPanel open={sumPanel} onOpenChange={(v) => { if (v) setSumDraft(sumCond); setSumPanel(v); }} activeCount={(sumCond.depts.length ? 1 : 0) + (sumCond.has.length ? 1 : 0) + (sumCond.ratioMax ? 1 : 0) + (sumCond.hoursMin || sumCond.hoursMax ? 1 : 0)}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setSumDraft(SUM_COND0)}>기본으로</button>
                    <span className="ml-auto" />
                    <button type="button" className="btn-primary btn-sm" onClick={() => { setSumCond(sumDraft); setSumPanel(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="부서" hint="여러 개">
                    <span className="qk-quicks">{[...new Set(rowsAll.map((r) => r.department || "미배정"))].sort().map((d) => <button key={d} type="button" onClick={() => setSumDraft((c) => ({ ...c, depts: c.depts.includes(d) ? c.depts.filter((x) => x !== d) : [...c.depts, d] }))} className={sumDraft.depts.includes(d) ? "qk-quick qk-quick-on" : "qk-quick"}>{d}</button>)}</span>
                  </ConditionRow>
                  <ConditionRow label="이 달에" hint="고른 것 모두 해당하는 사람만">
                    <span className="qk-quicks">{SUM_HAS.map(([k, l]) => <button key={k} type="button" onClick={() => setSumDraft((c) => ({ ...c, has: c.has.includes(k) ? c.has.filter((x) => x !== k) : [...c.has, k] }))} className={sumDraft.has.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span>
                  </ConditionRow>
                  <ConditionRow label="출근율" hint="이하 %"><input className="qk-input h-8 w-28 px-2 text-xs" inputMode="numeric" placeholder="예: 80" value={sumDraft.ratioMax} onChange={(e) => setSumDraft((c) => ({ ...c, ratioMax: e.target.value.replace(/[^0-9]/g, "") }))} /></ConditionRow>
                  <ConditionRow label="총 근무" hint="시간 범위">
                    <span className="inline-flex items-center gap-1.5"><input className="qk-input h-8 w-24 px-2 text-xs" inputMode="numeric" placeholder="이상" value={sumDraft.hoursMin} onChange={(e) => setSumDraft((c) => ({ ...c, hoursMin: e.target.value.replace(/[^0-9.]/g, "") }))} /><span className="text-[var(--text-dim)]">~</span><input className="qk-input h-8 w-24 px-2 text-xs" inputMode="numeric" placeholder="이하" value={sumDraft.hoursMax} onChange={(e) => setSumDraft((c) => ({ ...c, hoursMax: e.target.value.replace(/[^0-9.]/g, "") }))} /><span className="text-[11px] text-[var(--text-dim)]">h</span></span>
                  </ConditionRow>
                </ConditionPanel>
                <QuickSearch value={sumQ} onApply={setSumQ} placeholder="이름 · 부서 — 쉼표로 여러 개, Enter" />
              </div>
              <div className="qk-bar-right">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSumOpen(new Map(deptRows.map((d) => [d.department, true])))}>모두 펼침</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSumOpen(new Map(deptRows.map((d) => [d.department, false])))}>모두 접기</button>
              </div>
            </div>
            <AppliedChips chips={([
              ...(sumCond.depts.length ? [{ group: "부서", label: sumCond.depts.join(" · "), onRemove: () => setSumCond((c) => ({ ...c, depts: [] })) }] : []),
              ...(sumCond.has.length ? [{ group: "이 달에", label: sumCond.has.map((k) => SUM_HAS.find((h) => h[0] === k)?.[1] || k).join(" · "), onRemove: () => setSumCond((c) => ({ ...c, has: [] })) }] : []),
              ...(sumCond.ratioMax ? [{ group: "출근율", label: `${sumCond.ratioMax}% 이하`, onRemove: () => setSumCond((c) => ({ ...c, ratioMax: "" })) }] : []),
              ...(sumCond.hoursMin || sumCond.hoursMax ? [{ group: "총 근무", label: `${sumCond.hoursMin || "0"}~${sumCond.hoursMax || "∞"}h`, onRemove: () => setSumCond((c) => ({ ...c, hoursMin: "", hoursMax: "" })) }] : []),
              ...(sumQ ? [{ group: "빠른검색", label: sumQ, onRemove: () => setSumQ("") }] : []),
            ] as AppliedChip[])} onClearAll={() => { setSumCond(SUM_COND0); setSumQ(""); }} />
            <div className="mb-1 text-[11px] text-[var(--text-dim)]">{deptRows.length}개 부서 · {rows.length}명 · 근무일 {workdaysSoFar}일 기준 · 부서 줄을 누르면 직원, 직원 줄을 누르면 상세{sumCond.has.length || sumCond.depts.length || sumCond.ratioMax || sumCond.hoursMin || sumCond.hoursMax || sumQ ? " · 조건에 맞는 사람만" : ""}</div>
            <div className="ev-scroll att-summary-scroll">
              <table className="ev-table ev-lined att-summary-table">
                <thead>
                  <tr>
                    <th className="text-left"><button type="button" className="ev-th-btn" onClick={() => setSumSort((c) => nextSort(c, "name" as any, "asc"))}>부서 · 직원{sumSort.key === "name" ? (sumSort.dir === "asc" ? " ▲" : " ▼") : ""}</button></th>
                    {th("출근일", "totalDays")}
                    <th>출근율</th>
                    {th("지각", "lateDays")}
                    {th("결근", "absentDays")}
                    {th("재택", "remoteDays")}
                    {th("반차", "halfDays")}
                    {th("연차", "leaveDays")}
                    {th("연장(분)", "overtimeMinutesSum")}
                    {th("야간(분)", "nightMinutesSum")}
                    {th("휴일(분)", "holidayMinutesSum")}
                    {th("총 근무", "totalHours")}
                    {isAdminForAllowance && th("수당", "alwTotal")}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={isAdminForAllowance ? 13 : 12} className="text-center text-[var(--text-dim)] py-6">{sumQ ? "이름·부서에 맞는 직원이 없습니다" : "이 달 근태 기록이 없습니다"}</td></tr>
                  ) : deptRows.map((d) => {
                    const open = sumOpen.has(d.department) ? !!sumOpen.get(d.department) : autoOpen;
                    return (
                      <Fragment key={d.department}>
                        <tr className="att-dept-row" onClick={() => setSumOpen((m) => { const n = new Map(m); n.set(d.department, !open); return n; })}>
                          <td className="text-left"><span className={`bs-caret ${open ? "rotate-90" : ""}`}>▸</span><b>{d.department}</b> <em className="bs-cnt">{d.n}</em></td>
                          <td className="text-center mono-number">평균 {d.totalDays.toFixed(1)}일</td>
                          <td className="text-center"><span className="att-ratio"><i style={{ width: `${Math.round(d.ratio * 100)}%` }} /></span><small className="ml-1.5 mono-number text-[var(--text-dim)]">{Math.round(d.ratio * 100)}%</small></td>
                          <td className={`text-center mono-number ${d.lateDays > 0 ? "text-[var(--warning)] font-bold" : "text-[var(--text-dim)]"}`}>{d.lateDays > 0 ? `${d.lateDays}회` : "—"}</td>
                          <td className={`text-center mono-number ${d.absentDays > 0 ? "text-[var(--danger)] font-bold" : "text-[var(--text-dim)]"}`}>{d.absentDays > 0 ? `${d.absentDays}일` : "—"}</td>
                          <td className="text-center mono-number text-[var(--text-muted)]">{d.remoteDays > 0 ? `${d.remoteDays}일` : "—"}</td>
                          <td className="text-center mono-number text-[var(--text-muted)]">{d.halfDays > 0 ? `${d.halfDays}회` : "—"}</td>
                          <td className="text-center mono-number text-[var(--text-muted)]">{d.leaveDays > 0 ? `${d.leaveDays}일` : "—"}</td>
                          <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(d.overtimeMinutesSum) > 0 ? Math.round(d.overtimeMinutesSum).toLocaleString() : "—"}</td>
                          <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(d.nightMinutesSum) > 0 ? Math.round(d.nightMinutesSum).toLocaleString() : "—"}</td>
                          <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(d.holidayMinutesSum) > 0 ? Math.round(d.holidayMinutesSum).toLocaleString() : "—"}</td>
                          <td className="text-right mono-number font-bold">{d.totalHours.toFixed(1)}h</td>
                          {isAdminForAllowance && <td className="text-right mono-number font-bold text-[var(--success)]">{fmtKRW(d.alwTotal)}</td>}
                        </tr>
                        {open && d.list.map((s: any) => {                    const alw = allowanceByEmployee.get(s.employee_id);
                    const alwTitle = alw
                      ? `연장 ${alw.overtime.toLocaleString('ko-KR')}원 · 야간 ${alw.night.toLocaleString('ko-KR')}원 · 휴일 ${alw.holiday.toLocaleString('ko-KR')}원 · 당직 ${alw.on_duty.toLocaleString('ko-KR')}원 · 기타 ${alw.etc.toLocaleString('ko-KR')}원`
                      : '수당 기록 없음';
                    return (
                      <tr key={s.employee_id} className="pnl-row-acct att-emp-row" onClick={() => setSummaryDetailId(s.employee_id)}>
                        <td className="text-left pl-8"><span className="inline-flex items-center gap-2"><span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-white" style={{ background: attAvatarColor(s.employee_id) }}>{attInitials(s.name)}</span>{s.name}{s.employee_number && <span className="emp-no">#{s.employee_number}</span>}</span></td>
                        <td className="text-center mono-number">{s.totalDays}일</td>
                        <td className="text-center"><span className="att-ratio"><i style={{ width: `${Math.round(s.ratio * 100)}%` }} /></span><small className="ml-1.5 mono-number text-[var(--text-dim)]">{Math.round(s.ratio * 100)}%</small></td>
                        <td className={`text-center mono-number ${s.lateDays > 0 ? "text-[var(--warning)] font-bold" : "text-[var(--text-dim)]"}`}>{s.lateDays > 0 ? `${s.lateDays}회` : "—"}</td>
                        <td className={`text-center mono-number ${s.absentDays > 0 ? "text-[var(--danger)] font-bold" : "text-[var(--text-dim)]"}`}>{s.absentDays > 0 ? `${s.absentDays}일` : "—"}</td>
                        <td className="text-center mono-number text-[var(--text-muted)]">{s.remoteDays > 0 ? `${s.remoteDays}일` : "—"}</td>
                        <td className="text-center mono-number text-[var(--text-muted)]">{s.halfDays > 0 ? `${s.halfDays}회` : "—"}</td>
                        <td className="text-center mono-number text-[var(--text-muted)]">{s.leaveDays > 0 ? `${s.leaveDays}일` : "—"}</td>
                        <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(s.overtimeMinutesSum || 0) > 0 ? Math.round(s.overtimeMinutesSum || 0).toLocaleString() : "—"}</td>
                        <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(s.nightMinutesSum || 0) > 0 ? Math.round(s.nightMinutesSum || 0).toLocaleString() : "—"}</td>
                        <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(s.holidayMinutesSum || 0) > 0 ? Math.round(s.holidayMinutesSum || 0).toLocaleString() : "—"}</td>
                        <td className="text-right mono-number font-bold">{s.totalHours.toFixed(1)}h</td>
                        {isAdminForAllowance && <td className="text-right mono-number font-bold text-[var(--success)]" title={alwTitle}>{fmtKRW(alw?.total ?? 0)}</td>}
                      </tr>
                    );
                  })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* 직원별 월간 요약 카드 클릭 상세 — 수당내역 + 근무내역 */}
      {summaryDetailId && (() => {
        const s = (summary as any[]).find((x) => x.employee_id === summaryDetailId);
        if (!s) return null;
        const alw = allowanceByEmployee.get(summaryDetailId);
        const allowanceLines = (monthlyAllowanceEntries as any[]).filter((r) => r.employee_id === summaryDetailId);
        const empRecords = (records as any[]).filter((r) => r.employee_id === summaryDetailId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return (
          <div className="attendance-summary-detail-modal fixed inset-0" onClick={() => setSummaryDetailId(null)}>
            <div className="glass-card p-6 w-full max-w-lg shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: attAvatarColor(summaryDetailId) }}>
                    {attInitials(s.name)}
                  </span>
                  <div>
                    <div className="text-sm font-bold text-[var(--text)]">{s.name}</div>
                    <div className="text-[11px] text-[var(--text-dim)]">{selectedMonth} · {s.totalDays}일 근무 · 총 {s.totalHours.toFixed(1)}h</div>
                  </div>
                </div>
                <button onClick={() => setSummaryDetailId(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-xl leading-none px-1">✕</button>
              </div>

              {isAdminForAllowance && (
                <div className="mb-5">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2">수당 내역</div>
                  {allowanceLines.length === 0 ? (
                    <div className="text-xs text-[var(--text-dim)] px-1">이번 달 수당 기록이 없습니다</div>
                  ) : (
                    <div className="space-y-1.5">
                      {allowanceLines.map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                          <span className="text-[var(--text-muted)]">{r.allowance_types?.name || r.allowance_types?.code || "기타"}</span>
                          <span className="font-semibold mono-number text-[var(--success)]">₩{Number(r.amount || 0).toLocaleString('ko-KR')}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--success)]/10 text-xs font-bold">
                        <span className="text-[var(--text)]">합계</span>
                        <span className="mono-number text-[var(--success)]">₩{(alw?.total ?? 0).toLocaleString('ko-KR')}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="text-xs font-bold text-[var(--text-muted)] mb-2">근무 내역</div>
                {empRecords.length === 0 ? (
                  <div className="text-xs text-[var(--text-dim)] px-1">이번 달 근태 기록이 없습니다</div>
                ) : (
                  <div className="space-y-1">
                    {empRecords.map((r: any) => {
                      const es = effectiveStatus(r);
                      return (
                        <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                          <span className="text-[var(--text-muted)] mono-number">{r.date}</span>
                          <span className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${statusColor(es)}`} />
                            <span className="text-[var(--text)]">{statusLabel(es)}</span>
                          </span>
                          <span className="text-[var(--text-dim)] mono-number">
                            {r.check_in ? new Date(r.check_in).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                            {" ~ "}
                            {r.check_out ? new Date(r.check_out).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </span>
                          <span className="font-semibold mono-number text-[var(--text)]">{r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 직원 본인 — 근태 수정 요청 모달 (관리자 승인 후 attendance_records 반영) */}
      {editRequestRecord && companyId && userId && (
        <AttendanceEditRequestDialog
          open
          onClose={() => setEditRequestRecord(null)}
          companyId={companyId}
          attendanceRecordId={editRequestRecord.id}
          userId={userId}
          initial={{
            check_in: editRequestRecord.check_in || undefined,
            check_out: editRequestRecord.check_out || undefined,
            status: effectiveStatus(editRequestRecord),
          }}
        />
      )}

      {/* 관리자 대행 — 직원이 못 누른 출퇴근을 대신 기록 */}
      {isAdmin && companyId && (
        <ManualAttendanceDialog
          open={manualRecordOpen}
          onClose={() => setManualRecordOpen(false)}
          companyId={companyId}
          userId={userId}
          employees={employees as any[]}
          defaultDate={effectiveSelectedDay || todayKst()}
        />
      )}
    </div>
  );
}

// ── Missing Check-Out Modal (관리자 전용 일괄 보정) ──
//   - 이번 달 check_out=null 행을 모아 입력
//   - 각 행: 직원·날짜·check_in (읽기) + check_out time picker + 저장 버튼
//   - 저장: correctAttendanceRecord (UPDATE check_out) + recomputeAttendance (분 컬럼 산정)
//   - RLS: UPDATE 정책이 admin OR 본인 (dce3488b 후) — 관리자 통과 보장
function MissingCheckOutModal({
  companyId,
  records,
  employees,
  selectedMonth,
  onClose,
  onSaved,
}: {
  companyId: string;
  records: any[];
  employees: any[];
  selectedMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const empNameMap = useMemo(() => new Map(employees.map((e: any) => [e.id, e.name])), [employees]);
  // 행별 입력 시간 (HH:MM). 기본값 "18:30" (보편적 퇴근시각).
  const missingRows = useMemo(
    () => {
      // 오늘(KST) 제외 — 지난 날짜의 퇴근 미입력만 보정 대상 (오늘은 아직 퇴근 전 정상)
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      return (records || []).filter((r: any) => !r.check_out && (r.date || "") < today).sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
    },
    [records],
  );
  const [times, setTimes] = useState<Record<string, string>>(() =>
    Object.fromEntries(missingRows.map((r: any) => [r.id, "18:30"])),
  );
  const [saving, setSaving] = useState<Set<string>>(new Set());

  const saveOne = async (row: any) => {
    const t = times[row.id] || "18:30";
    if (!/^\d{2}:\d{2}$/.test(t)) {
      toast("시간 형식이 잘못되었습니다 (HH:MM).", "error");
      return;
    }
    setSaving((s) => new Set(s).add(row.id));
    try {
      // KST 기준 ISO 생성: YYYY-MM-DDTHH:MM:00+09:00
      const iso = `${row.date}T${t}:00+09:00`;
      await correctAttendanceRecord(row.id, { check_out: iso });
      // 분 컬럼 산정 (regular/overtime/night/holiday)
      await recomputeAttendance({
        companyId,
        employeeId: row.employee_id,
        from: row.date,
        to: row.date,
      });
      toast(`${empNameMap.get(row.employee_id) || "직원"} ${row.date} 퇴근 입력 완료`, "success");
      onSaved();
    } catch (e) {
      toast(friendlyError(e, "퇴근 입력에 실패했습니다."), "error");
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
    }
  };

  const saveAll = async () => {
    for (const row of missingRows) {
      await saveOne(row);
    }
  };

  // ESC 닫기 · Enter 확인(일괄 저장, 대상 없거나 저장 중이면 비활성)
  useModalKeys(true, onClose, missingRows.length === 0 || saving.size > 0 ? undefined : saveAll);

  return (
    <div className="attendance-checkout-modal fixed inset-0">
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-sm font-bold"><Ico e="📝" /> 퇴근 미입력 일괄 보정</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {selectedMonth} 누락 {missingRows.length}건 — 저장 시 자동으로 연장·야간·휴일 분이 산정됩니다.
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        <div className="overflow-auto flex-1">
          {missingRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--text-muted)]">미입력 행이 없습니다 ✅</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-surface)]/50 sticky top-0">
                <tr className="text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-center px-4 py-2 font-medium">직원</th>
                  <th className="text-center px-4 py-2 font-medium">날짜</th>
                  <th className="text-center px-4 py-2 font-medium">출근(KST)</th>
                  <th className="text-center px-4 py-2 font-medium">퇴근 시각</th>
                  <th className="text-center px-4 py-2 font-medium">저장</th>
                </tr>
              </thead>
              <tbody>
                {missingRows.map((row: any) => {
                  const ciStr = row.check_in
                    ? new Date(row.check_in).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })
                    : "—";
                  return (
                    <tr key={row.id} className="border-b border-[var(--border)]/50">
                      <td className="px-4 py-2 font-medium">{empNameMap.get(row.employee_id) || "—"}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)]">{row.date}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)] tabular-nums">{ciStr}</td>
                      <td className="px-4 py-2">
                        <input
                          type="time"
                          value={times[row.id] || "18:30"}
                          onChange={(e) => setTimes((t) => ({ ...t, [row.id]: e.target.value }))}
                          className="px-2 py-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-md text-xs focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          disabled={saving.has(row.id)}
                          onClick={() => saveOne(row)}
                          className="px-3 py-1 text-xs font-semibold bg-[var(--primary)]/20 text-[var(--primary)] hover:bg-[var(--primary)]/30 disabled:opacity-40 rounded-md transition"
                        >
                          {saving.has(row.id) ? "..." : "저장"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">기본 18:30, 직원별 변경 가능</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg transition"
            >
              닫기
            </button>
            {missingRows.length > 0 && (
              <button
                type="button"
                disabled={saving.size > 0}
                onClick={saveAll}
                className="px-4 py-1.5 text-xs font-semibold bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 disabled:opacity-40 rounded-lg transition"
              >
                {saving.size > 0 ? "저장 중..." : `일괄 저장 (${missingRows.length}건)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quick Attendance Buttons (sub-component) ──
function QuickAttendanceButtons({ employees, records, onCheckIn, onCheckOut }: any) {
  const [selectedEmp, setSelectedEmp] = useState("");
  const todayStr = todayKst();

  // Check if employee already checked in today
  const todayRecord = selectedEmp
    ? records.find((r: any) => r.employee_id === selectedEmp && r.date === todayStr)
    : null;
  const hasCheckedIn = !!todayRecord;
  const hasCheckedOut = !!todayRecord?.check_out;

  return (
    <div className="attendance-quick-buttons">
      <select
        value={selectedEmp}
        onChange={(e) => setSelectedEmp(e.target.value)}
        className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm"
      >
        <option value="">직원 선택...</option>
        {[...employees].sort(comparePeople).map((e: any) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <button
        disabled={!selectedEmp || hasCheckedIn}
        onClick={() => selectedEmp && onCheckIn(selectedEmp)}
        className="px-4 py-2 bg-[var(--success)] hover:brightness-110 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
      >
        출근
      </button>
      <button
        disabled={!selectedEmp || !hasCheckedIn || hasCheckedOut}
        onClick={() => selectedEmp && onCheckOut(selectedEmp)}
        className="px-4 py-2 bg-[var(--warning)] hover:brightness-110 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
      >
        퇴근
      </button>
    </div>
  );
}

// ── Payroll Preview Tab ──
function PayrollPreviewTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<{ items: PayrollItem[]; totalGross: number; totalDeductions: number; totalNet: number; skippedNoBirth?: string[]; totalEmployer?: number; rates?: InsuranceRates } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  // 편집 모드 — 직원별 기본급(과세) / 비과세 직접 수정 + v4 H1 임의 수당/공제
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, { baseSalary: number; nonTaxable: number; extras: { type: 'allowance' | 'deduction'; name: string; amount: number }[]; deductions?: Record<string, number> }>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);   // H2 고지서 대조 팝업 (2026-08-27)
  // 조회 월 — month picker (YYYY-MM) + 표시용 라벨 변환
  const [periodMonth, setPeriodMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const periodLabel = (() => {
    const [y, m] = periodMonth.split('-');
    return `${y}년 ${parseInt(m, 10)}월`;
  })();

  const { data: companyMeta } = useQuery({
    queryKey: ["company-meta-payroll", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase.from("companies").select("name, representative, business_number, address, seal_url").eq("id", companyId!).maybeSingle());
      return data as { name: string; representative: string | null; business_number: string | null; address: string | null; seal_url: string | null } | null;
    },
    enabled: !!companyId,
  });

  const { data: empMap = {} } = useQuery({
    queryKey: ["payroll-emp-meta", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase.from("employees").select("id, department, position, birth_date").eq("company_id", companyId!));
      const m: Record<string, { department: string | null; position: string | null; birthDate: string | null }> = {};
      (data || []).forEach((e: any) => { m[e.id] = { department: e.department, position: e.position, birthDate: e.birth_date }; });
      return m;
    },
    enabled: !!companyId,
  });

  //   H1 (2026-08-27) — '수당 불러오기' 버튼과 loadAllowances 는 없앴다. 근태 집계 수당은 previewPayroll 이 자동으로 얹는다(lib/payroll.ts).
  const downloadOne = async (item: PayrollItem) => {
    try {
      const { downloadPayslipPDF } = await import("@/lib/payslip-pdf");
      const meta = (empMap as Record<string, { department: string | null; position: string | null; birthDate: string | null }>)[item.employeeId] || {} as any;
      // 사원코드 — employee.id 의 끝 4자리(UUID 접미)를 사용
      const employeeCode = item.employeeId ? item.employeeId.slice(-4).toUpperCase() : undefined;
      // 2026-05-22 PDF = 화면 단일 진실. 임의 수당/공제는 PDF 가 item.extras 에서 직접 읽고
      //   합계는 item.netPay 를 그대로 신뢰 — 여기서 별도 변환·전달 불필요.
      await downloadPayslipPDF({
        item,
        companyName: companyMeta?.name || "회사",
        representative: companyMeta?.representative || undefined,
        businessNumber: companyMeta?.business_number || undefined,
        companyAddress: companyMeta?.address || undefined,
        sealUrl: companyMeta?.seal_url || undefined,
        periodLabel,
        department: meta.department || undefined,
        position: meta.position || undefined,
        employeeCode,
        birthDate: meta.birthDate || undefined,
      });
      toast(`${item.employeeName} 명세서 PDF 생성 완료`, "success");
    } catch (err: any) {
      toast("PDF 생성 실패: " + (err.message || ""), "error");
    }
  };

  const downloadAll = async () => {
    if (!preview) return;
    for (const item of preview.items) {
      await downloadOne(item);
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  // 'YYYY-MM' → 직전 달 'YYYY-MM'
  const prevMonthKey = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // m-1 이 당월, m-2 가 전월
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const generate = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // 1) 당월 override 존재 여부 확인 — 없고 전월엔 있으면 복사 제안
      const curOv = logRead('employees/page:curOv', await (supabase)
        .from('payslip_overrides')
        .select('employee_id')
        .eq('company_id', companyId)
        .eq('period_month', periodMonth));
      if (!curOv || curOv.length === 0) {
        const prevKey = prevMonthKey(periodMonth);
        const prevOv = logRead('employees/page:prevOv', await (supabase)
          .from('payslip_overrides')
          .select('employee_id, base_salary, non_taxable_amount')
          .eq('company_id', companyId)
          .eq('period_month', prevKey));
        if (prevOv && prevOv.length > 0) {
          const [py, pm] = prevKey.split('-');
          const ok = await appConfirm(
            `${py}년 ${parseInt(pm, 10)}월 명세서 수정값(${prevOv.length}명)이 있습니다.\n${periodLabel} 명세서에 그대로 복사하시겠습니까?`,
          );
          if (ok) {
            const rows = prevOv.map((o: any) => ({
              company_id: companyId,
              employee_id: o.employee_id,
              period_month: periodMonth,
              base_salary: Number(o.base_salary),
              non_taxable_amount: Number(o.non_taxable_amount),
              updated_at: new Date().toISOString(),
            }));
            const { error: copyErr } = await (supabase)
              .from('payslip_overrides')
              .upsert(rows, { onConflict: 'employee_id,period_month' });
            if (copyErr) {
              toast('전월 복사 실패: ' + (copyErr.message || ''), 'error');
            } else {
              toast(`${py}년 ${parseInt(pm, 10)}월 → ${periodLabel} 복사 완료`, 'success');
            }
          }
        }
      }

      // 2) (복사 반영된) 미리보기 계산
      const result = await previewPayroll(companyId, periodMonth);
      setPreview(result);
      // 편집값 초기화 — 현재 미리보기 값으로 (v4 H1: extras 포함)
      const init: Record<string, { baseSalary: number; nonTaxable: number; extras: { type: 'allowance' | 'deduction'; name: string; amount: number }[]; deductions?: Record<string, number> }> = {};
      result.items.forEach(it => {
        init[it.employeeId] = { baseSalary: it.baseSalary, nonTaxable: it.nonTaxableAmount, extras: it.extras ? [...it.extras] : [], deductions: {} };
      });
      setEditValues(init);
      // 입사일 필터 안내
      if (result.items.length === 0) {
        toast(`${periodLabel} 기준 재직 직원이 없습니다 (입사일 이전 또는 미등록).`, 'info');
      }
      // 생년월일 누락 안내
      if (result.skippedNoBirth && result.skippedNoBirth.length > 0) {
        // 실명 나열 제거 (2026-08-19 감사) — 토스트는 공용 화면·화면공유에서 가장 잘 보이는 위치.
        toast(`⚠ 생년월일 미등록 ${result.skippedNoBirth.length}명 — 해당 직원 명세서는 PDF 비밀번호 보호가 안 됩니다. 인력관리에서 생년월일을 등록하세요.`, 'error');
      }
    } catch (e: unknown) {
      // 무음 실패 금지 (2026-08-19 감사): 종전엔 실패를 삼켜 직전 달 미리보기가 새 달 라벨을
      //   달고 남았고, 그 상태로 저장·발송하면 지난달 금액이 새 달 명세서로 나갔다.
      setPreview(null);
      setEditValues({});
      toast(`미리보기 생성 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'error');
    }
    setLoading(false);
  };

  // 편집 모드에서 저장 — 해당 월(periodMonth) payslip_overrides 에만 저장.
  // employees.salary(연봉) 는 건드리지 않음 → 인력관리 연봉 유지 + 월별 독립.
  //   H1 — 탭을 열면·월을 바꾸면 저절로 계산(버튼 없음). generate 는 읽기+계산만이라 마운트마다 돌아도 무겁지 않다(504 는 재계산 RPC 였다).
  useEffect(() => { if (companyId) void generate(); }, [companyId, periodMonth]);   // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdits = async () => {
    if (!companyId || !preview) return;
    setSavingEdit(true);
    try {
      const rows = Object.entries(editValues).map(([id, v]) => ({
        company_id: companyId,
        employee_id: id,
        period_month: periodMonth, // 'YYYY-MM' — 이 달 명세서에만 적용
        base_salary: v.baseSalary,
        non_taxable_amount: v.nonTaxable,
        // v4 H1: 임의 수당/공제 — 빈 amount/name 행은 저장 안 함
        extras: v.extras.filter((e) => e.name.trim() && Number(e.amount) > 0),
        // 공제액 수동 수정 — 편집한 항목만 sparse 저장(없으면 null = 전부 자동계산)
        deduction_overrides: (v.deductions && Object.keys(v.deductions).length > 0) ? v.deductions : null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await (supabase)
        .from('payslip_overrides')
        .upsert(rows, { onConflict: 'employee_id,period_month' });
      if (error) throw error;
      toast(`${rows.length}명 ${periodLabel} 급여명세서 저장 완료 (연봉은 유지됨)`, 'success');
      setEditMode(false);
      await generate();
    } catch (err: any) {
      toast('저장 실패: ' + (err.message || err.code || ''), 'error');
      console.error('[saveEdits] error:', err);
    }
    setSavingEdit(false);
  };

  const handleSendPayslips = async (employeeIds?: string[]) => {
    if (!companyId || !preview) return;
    setSending(true);
    try {
      const { sendPayslipEmails } = await import("@/lib/payment-batch");
      const label = periodLabel || `${todayKst().slice(0, 7)} 급여`;
      const result = await sendPayslipEmails("preview", companyId, label, { employeeIds });
      const target = employeeIds && employeeIds.length === 1 ? '개인' : `${result.sent + result.failed}명`;
      toast(`급여명세서 ${target} 발송: ${result.sent}건 성공, ${result.failed}건 실패`, result.failed > 0 ? "error" : "success");
      if (result.errors && result.errors.length > 0) {
        console.warn('payslip send errors:', result.errors);
      }
    } catch (err: any) {
      toast("급여명세서 발송 실패: " + (err.message || ""), "error");
    }
    setSending(false);
  };

  const fmtKRW = (n: number) => `₩${n.toLocaleString()}`;

  return (
    <div>
      {/*   2026-08-27 인사 1차 — 조회 줄 8개 → 3개: 월 · 도구▾(급여대장 고치기·전체 PDF·다시 계산) · 파란 '전 직원 발송'.
            미리보기는 탭을 열면·월을 바꾸면 저절로 계산된다. 편집 중엔 [저장 · 취소]만. 수당은 근태 집계에서 자동(출처 표시). */}
      <div className="payroll-toolbar">
        <p className="text-sm text-[var(--text-muted)]">
          {editMode ? <>기본급·비과세·수당·공제를 고친 뒤 <b>저장</b> — 이 달 명세에만 적용되고 연봉은 유지됩니다.</>
            : <>재직 직원 급여 기준 4대보험·원천세 자동 계산. <b>수당은 근태 집계에서 자동으로</b> 얹힙니다(줄에 &lsquo;근태 집계&rsquo; 표시) — 고치려면 도구 › 급여대장 고치기.</>}
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          {editMode ? (
            <>
              <button onClick={() => { setEditMode(false); generate(); }} className="btn-secondary btn-sm" disabled={savingEdit}>취소</button>
              <button onClick={saveEdits} disabled={savingEdit} className="btn-primary btn-sm">{savingEdit ? "저장 중..." : "저장"}</button>
            </>
          ) : (
            <>
              <MonthField
                value={periodMonth}
                onChange={(e) => {
                  setPeriodMonth(e.target.value);
                  // 월 변경 시 직전 달 미리보기·편집값을 비운다 (2026-08-19) — 남겨두면
                  //   이전 달 금액이 새 달 라벨로 저장·발송될 수 있다. 새 달은 useEffect 가 다시 계산한다.
                  setPreview(null);
                  setEditValues({});
                }}
                className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs"
                title="조회할 급여 명세 월 선택"
              />
              <HelperMenu label="도구" items={[
                { label: "급여대장 고치기", source: "입력", hint: "직원별 기본급·비과세·수당·공제를 이 달에만 고칩니다", disabled: !preview || preview.items.length === 0, onClick: () => setEditMode(true) },
                { label: "전체 PDF 내려받기", source: "출력", hint: "직원별 명세서 PDF 를 한 번에", disabled: !preview || preview.items.length === 0, onClick: downloadAll },
                { label: loading ? "계산 중…" : "다시 계산", source: "입력", hint: "근태·수당·수정값을 다시 읽어 미리보기를 새로 만듭니다", disabled: loading || !companyId, onClick: generate },
                { label: "고지서 대조", source: "장부 대조", hint: "공단 고지 금액을 적으면 급여 계산 합계와의 차이를 보여 줍니다", disabled: !preview || preview.items.length === 0, onClick: () => setNoticeOpen(true) },
              ]} />
              <button onClick={() => handleSendPayslips()} disabled={sending || !preview || preview.items.length === 0} className="btn-primary btn-sm">
                {sending ? "발송 중..." : `전 직원 발송${preview && preview.items.length ? ` (${preview.items.length}명)` : ""}`}
              </button>
            </>
          )}
        </div>
      </div>

      {noticeOpen && preview && companyId && <InsuranceNoticeDialog companyId={companyId} userId={null} month={periodMonth} items={preview.items} onClose={() => setNoticeOpen(false)} />}
      {!preview ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-4"><Ico e="📋" /></div>
          <div className="text-sm text-[var(--text-muted)]">{loading ? "급여 명세를 계산하는 중…" : "급여 명세가 없습니다 — 도구 › 다시 계산"}</div>
        </div>
      ) : preview.items.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-sm text-[var(--text-muted)]">재직 중인 직원이 없거나 급여가 설정되지 않았습니다</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="payroll-summary-cards">
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 급여 (세전)</div>
              <div className="text-lg font-bold mt-1">{fmtKRW(preview.totalGross)}</div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 공제액</div>
              <div className="text-lg font-bold text-[var(--danger)] mt-1">-{fmtKRW(preview.totalDeductions)}</div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 실수령액</div>
              <div className="text-lg font-bold text-[var(--success)] mt-1">{fmtKRW(preview.totalNet)}</div>
            </div>
            <div className="glass-card p-4" title="회사설정 › 회계·세무 › 4대보험 요율 기준">
              <div className="text-xs text-[var(--text-dim)]">회사 부담 4대보험 {preview.rates?.isDefault !== false ? <span className="hr-src-tag">법정 기본값</span> : <span className="hr-src-tag">{preview.rates?.year}년 회사 요율</span>}</div>
              <div className="text-lg font-bold mt-1">{fmtKRW(preview.totalEmployer || 0)}</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">인건비 총액 {fmtKRW(preview.totalGross + (preview.totalEmployer || 0))} · <button type="button" className="bz-link" onClick={() => setNoticeOpen(true)}>고지서와 맞춰 보기</button></div>
            </div>
          </div>

          {/* Detail Table */}
          <div className="payroll-detail-table glass-card">
            <div className="ev-scroll leave-req-scroll"><table className="ev-table ev-lined payroll-tbl">
              <thead><tr>
                <th>직원</th>
                <th title="과세 대상 기본급">기본급(과세)</th>
                <th title="식대 · 자가운전 등 비과세 합계">비과세</th>
                <th title="기본급(과세) + 비과세">지급합계</th>
                <th>국민연금</th>
                <th>건강보험</th>
                <th>장기요양</th>
                <th>고용보험</th>
                <th>소득세</th>
                <th>지방소득세</th>
                <th>공제합계</th>
                <th>실수령</th>
                <th title="국민연금·건강(장기요양)·고용·산재 회사 몫 — 회사설정 › 4대보험 요율 기준">회사부담</th>
                <th>발송</th>
              </tr></thead>
              <tbody>
                {preview.items.map((item) => {
                  const ev = editValues[item.employeeId] || { baseSalary: item.baseSalary, nonTaxable: item.nonTaxableAmount, extras: [] };
                  // v4 H1: 임의 수당/공제 합산 (preview netPay 에는 이미 반영됨)
                  const itemExtras = item.extras || [];
                  const allowanceSum = itemExtras.filter((e) => e.type === 'allowance').reduce((s, e) => s + Number(e.amount || 0), 0);
                  const deductionSum = itemExtras.filter((e) => e.type === 'deduction').reduce((s, e) => s + Number(e.amount || 0), 0);
                  return (
                  <>
                  <tr key={item.employeeId} className={item.warn ? "border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] hr-row-warn" : "border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]"} title={item.warn || undefined}>
                    <td className="px-4 py-3 text-sm font-medium">
                      {item.employeeName}{item.employeeNumber && <span className="emp-no">#{item.employeeNumber}</span>}
                      {!editMode && item.warn && <span className="hr-src-tag hr-src-warn" title={item.warn}>전월 대비 ±20%</span>}
                      {!editMode && item.extras?.some((e) => e.auto) && <span className="hr-src-tag" title="근태 집계(연장·야간·휴일·당직)에서 자동으로 얹힌 수당이 있습니다">근태 집계</span>}
                      {!editMode && (allowanceSum > 0 || deductionSum > 0) && (
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {allowanceSum > 0 && <span className="text-[var(--info)]">수당 +{allowanceSum.toLocaleString()}</span>}
                          {allowanceSum > 0 && deductionSum > 0 && <span className="mx-1">·</span>}
                          {deductionSum > 0 && <span className="text-[var(--danger)]">공제 -{deductionSum.toLocaleString()}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      {editMode ? (
                        <CurrencyInput value={ev.baseSalary}
                          onValueChange={(raw) => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, baseSalary: Number(raw || 0) } }))}
                          className="w-28 px-2 py-1 text-right bg-[var(--bg)] border border-[var(--primary)]/40 rounded-md text-xs"
                        />
                      ) : fmtKRW(item.baseSalary)}
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">
                      {editMode ? (
                        <CurrencyInput value={ev.nonTaxable}
                          onValueChange={(raw) => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, nonTaxable: Number(raw || 0) } }))}
                          className="w-24 px-2 py-1 text-right bg-[var(--bg)] border border-[var(--primary)]/40 rounded-md text-xs"
                          placeholder="0"
                        />
                      ) : fmtKRW(item.nonTaxableAmount || 0)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-[var(--text)]">
                      {fmtKRW(editMode ? (Number(ev.baseSalary || 0) + Number(ev.nonTaxable || 0)) : (Number(item.baseSalary || 0) + Number(item.nonTaxableAmount || 0)))}
                    </td>
                    {([
                      ["nationalPension", item.nationalPension],
                      ["healthInsurance", item.healthInsurance],
                      ["longTermCareInsurance", item.longTermCareInsurance || 0],
                      ["employmentInsurance", item.employmentInsurance],
                      ["incomeTax", item.incomeTax],
                      ["localIncomeTax", item.localIncomeTax],
                    ] as const).map(([key, val]) => (
                      <td key={key} className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">
                        {editMode ? (
                          <CurrencyInput value={ev.deductions?.[key] ?? Number(val || 0)}
                            onValueChange={(raw) => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, deductions: { ...(ev.deductions || {}), [key]: Number(raw || 0) } } }))}
                            className="w-20 px-1.5 py-1 text-right bg-[var(--bg)] border border-[var(--primary)]/40 rounded-md text-xs"
                          />
                        ) : fmtKRW(Number(val || 0))}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-sm text-right text-[var(--danger)]">-{fmtKRW(item.deductionsTotal)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-[var(--success)]">{fmtKRW(item.netPay)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]" title={`국민연금 ${fmtKRW(item.employerCosts.nationalPension)} · 건강 ${fmtKRW(item.employerCosts.healthInsurance)} · 장기요양 ${fmtKRW(item.employerCosts.longTermCareInsurance || 0)} · 고용 ${fmtKRW(item.employerCosts.employmentInsurance)} · 산재 ${fmtKRW(item.employerCosts.industrialAccident)}`}>{item.employerCosts.total ? fmtKRW(item.employerCosts.total) : "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => downloadOne(item)} title="급여명세서 PDF 다운로드" className="btn-secondary btn-sm">
                          <Ico e="⬇" tone="mono" /> PDF
                        </button>
                        <button onClick={() => handleSendPayslips([item.employeeId])} disabled={sending}
                          title="이 직원에게만 메일로 명세서 발송 (비밀번호=생년월일)"
                          className="btn-secondary btn-sm">
                          <Ico e="✉" tone="mono" /> 발송
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* v4 H1: 편집 모드일 때 row 아래 수당/공제 라인 편집 */}
                  {editMode && (
                    <tr key={`${item.employeeId}-extras`} className="bg-[var(--bg-surface)]/40 border-b border-[var(--border)]/30">
                      <td colSpan={14} className="px-4 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] text-[var(--text-dim)] font-semibold">임의 수당/공제 ({(ev.extras || []).length}건)</span>
                          <button type="button"
                            onClick={() => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: [...(ev.extras || []), { type: 'allowance', name: '', amount: 0 }] } }))}
                            className="text-[10px] px-2 py-0.5 rounded bg-[var(--info)]/10 text-[var(--info)] hover:bg-[var(--info)]/20">+ 수당</button>
                          <button type="button"
                            onClick={() => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: [...(ev.extras || []), { type: 'deduction', name: '', amount: 0 }] } }))}
                            className="text-[10px] px-2 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20">+ 공제</button>
                        </div>
                        {(ev.extras || []).length > 0 && (
                          <div className="space-y-1">
                            {(ev.extras || []).map((ex, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <select value={ex.type} onChange={(e) => {
                                  const next = [...(ev.extras || [])];
                                  next[idx] = { ...ex, type: e.target.value as 'allowance' | 'deduction' };
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} className={`text-[10px] px-2 py-1 rounded border ${ex.type === 'allowance' ? 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/30' : 'bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/30'}`}>
                                  <option value="allowance">수당</option>
                                  <option value="deduction">공제</option>
                                </select>
                                <input value={ex.name} onChange={(e) => {
                                  const next = [...(ev.extras || [])];
                                  next[idx] = { ...ex, name: e.target.value };
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} placeholder="예: 식대 / 직책수당 / 사내대출"
                                  className="flex-1 max-w-xs px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                                {(ex as { auto?: boolean }).auto && <span className="hr-src-tag" title="근태 집계에서 자동으로 온 값 — 고치면 이 달 명세엔 고친 값이 쓰입니다">근태 집계</span>}
                                <CurrencyInput value={ex.amount}
                                  onValueChange={(raw) => {
                                    const next = [...(ev.extras || [])];
                                    next[idx] = { ...ex, amount: Number(raw || 0) };
                                    setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                  }}
                                  className="w-28 px-2 py-1 text-right bg-[var(--bg)] border border-[var(--border)] rounded text-xs" />
                                <button type="button" onClick={() => {
                                  const next = (ev.extras || []).filter((_, i) => i !== idx);
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} className="text-[var(--danger)]/70 hover:text-[var(--danger)] text-xs">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </>
                  );
                })}
              </tbody>
              {/* 직원 QA #13 — 3개 총계만이 아니라 컬럼별 합계 행 추가 */}
              <tfoot>
                {(() => {
                  const its = preview.items;
                  const sum = (f: (x: any) => number) => its.reduce((s, x) => s + Number(f(x) || 0), 0);
                  return (
                    <tr className="border-t-[3px] border-[var(--primary)]/40 bg-[var(--primary)]/10 font-bold">
                      <td className="px-4 py-3.5 text-sm font-extrabold text-[var(--primary)]">합계 ({its.length}명)</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold">{fmtKRW(sum((x) => x.baseSalary))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.nonTaxableAmount || 0))}</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold text-[var(--text)]">{fmtKRW(preview.totalGross)}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.nationalPension))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.healthInsurance))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.longTermCareInsurance || 0))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.employmentInsurance))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.incomeTax))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.localIncomeTax))}</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold text-[var(--danger)]">-{fmtKRW(preview.totalDeductions)}</td>
                      <td className="px-4 py-3.5 text-[15px] text-right font-extrabold text-[var(--success)]">{fmtKRW(preview.totalNet)}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(preview.totalEmployer || 0)}</td>
                      <td className="px-4 py-3.5"></td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Leave Tab ──
export function LeaveTab({ employees, directory, companyId, userId, queryClient, isEmployee, autoNew, focusPending }: any) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(!!autoNew);
  const approveSectionRef = useRef<HTMLDivElement>(null);
  //   신청 내역 표 머리단 — 정렬·≡ 필터·너비 (2026-08-18 조회 표준, 다른 표와 같은 부품)
  type LrKey = "emp" | "type" | "period" | "days" | "approver" | "status";
  const [lrSort, setLrSort] = useState<SortState<LrKey>>({ key: "period", dir: "desc" });
  const onLrSort = (k: LrKey) => setLrSort((c) => nextSort(c, k));
  const lrCf = useColFilters();
  const lrTableRef = useRef<HTMLTableElement | null>(null);
  const [lrColW, setLrColW] = useColWidths("leave-requests-colw-v1", { emp: 110, type: 100, period: 220, days: 90, reason: 220, approver: 180, status: 100, action: 150 });
  const lrResize = (k: string, colIndex: number) => ({ k, colIndex, widths: lrColW, onResize: setLrColW, tableRef: lrTableRef });

  // 알림에서 진입(?focus=pending) 시 — 승인 대기 필터로 전환 후 승인 영역으로 스크롤.
  useEffect(() => {
    if (!focusPending) return;
    setStatusFilter("pending");
    const t = setTimeout(() => approveSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
  }, [focusPending]);

  // Auto-detect current user's employee record
  const myEmployee = isEmployee ? employees.find((e: any) => e.user_id === userId) : null;

  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "annual",
    leaveUnit: "full_day" as string,
    halfDayPeriod: "am" as "am" | "pm",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    reason: "",
    // Flex 승인 체인: 각 단계 = 승인자 user id (빈 문자열 = 미지정). 최소 1단계.
    approverSteps: [""] as string[],
    ccUserIds: [] as string[],
  });
  const [showPromotion, setShowPromotion] = useState(false);
  //   2026-08-27 인사 5차 — 두 층(칩 + 아래 신청 목록 칩) → 상자 안 갈래 한 줄: 직원별 연차 · 신청 · 촉진 · 설정
  const [leaveView, setLeaveView] = useState<"roster" | "requests" | "promotion" | "settings">(focusPending || autoNew ? "requests" : "roster");

  // 승인자·참조자 선택 풀 — 회사 전체 구성원 (비관리자 포함).
  const { data: members = [] } = useQuery({
    queryKey: ["company-members", companyId],
    queryFn: () => getCompanyMembers(companyId!),
    enabled: !!companyId,
  });
  // user_id → 직원 레코드(소속/직책 표시용) 매핑
  const memberMeta = useMemo(() => {
    const byUser: Record<string, { department?: string; position?: string }> = {};
    (employees as any[]).forEach((e: any) => {
      if (e.user_id) byUser[e.user_id] = { department: e.department, position: e.position };
    });
    return byUser;
  }, [employees]);
  const memberById = useMemo(() => {
    const m: Record<string, any> = {};
    (members as any[]).forEach((u: any) => { m[u.id] = u; });
    return m;
  }, [members]);

  // Auto-select employee for employee role
  useEffect(() => {
    if (myEmployee && !form.employeeId) {
      setForm(prev => ({ ...prev, employeeId: myEmployee.id }));
    }
  }, [myEmployee, form.employeeId]);

  // Leave requests
  const { data: leaveRequests = [] } = useQuery({
    queryKey: ["leave-requests", companyId, statusFilter],
    queryFn: () => getLeaveRequests(companyId!, statusFilter === "all" ? undefined : statusFilter),
    enabled: !!companyId,
  });

  // Leave balances
  const { data: balances = [] } = useQuery({
    queryKey: ["leave-balances", companyId, currentYear],
    queryFn: () => getLeaveBalances(companyId!, currentYear),
    enabled: !!companyId,
  });
  // 직원 계정은 본인 잔여연차만 — 다른 사람 연차는 숨김(관리자/대표는 전원 표시).
  const visibleBalances = isEmployee && myEmployee
    ? (balances as any[]).filter((b: any) => b.employee_id === myEmployee.id)
    : balances;

  // Leave promotion candidates
  const { data: promotionCandidates = [] } = useQuery({
    queryKey: ["leave-promotion-candidates", companyId, currentYear],
    queryFn: () => getLeavePromotionCandidates(companyId!, currentYear),
    enabled: !!companyId && (showPromotion || leaveView === "promotion"),
  });

  // Leave promotion notices
  const { data: promotionNotices = [] } = useQuery({
    queryKey: ["leave-promotion-notices", companyId, currentYear],
    queryFn: () => getLeavePromotionNotices(companyId!, currentYear),
    enabled: !!companyId && (showPromotion || leaveView === "promotion"),
  });

  // Create leave request mutation
  const createLeave = useMutation({
    mutationFn: async () => {
      const unit = form.leaveUnit;
      let days: number;
      if (unit === "half_day") {
        days = 0.5;
      } else if (unit === "two_hours") {
        days = 0.25;
      } else {
        // full_day: 근무일 기준 — 주말·공휴일 미차감 (2026-08-19 감사: 달력 일수 계산은
        //   금~월 휴가를 4일로 차감했다. 실제 사용일 1일)
        days = await calcLeaveDays(companyId!, form.startDate, form.endDate || form.startDate);
      }

      return createLeaveRequest({
        companyId: companyId!,
        employeeId: form.employeeId,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        days,
        reason: form.reason,
        leaveUnit: unit as any,
        halfDayPeriod: unit === "half_day" ? form.halfDayPeriod : undefined,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        approverIds: form.approverSteps.filter(Boolean),
        ccUserIds: form.ccUserIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setShowForm(false);
      setForm({ employeeId: "", leaveType: "annual", leaveUnit: "full_day", halfDayPeriod: "am", startDate: "", endDate: "", startTime: "", endTime: "", reason: "", approverSteps: [""], ccUserIds: [] });
    },
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // 팝업(이름 클릭)에서 바로 등록 — 아래 전체 폼으로 내려보내면 화면이 멀어 안 보였다(2026-08-07 사장님).
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ leaveType: "annual", leaveUnit: "full_day", halfDayPeriod: "am" as "am" | "pm", startDate: "", endDate: "", reason: "" });
  const resetQuick = () => setQuick({ leaveType: "annual", leaveUnit: "full_day", halfDayPeriod: "am", startDate: "", endDate: "", reason: "" });
  // 근무일 기준 일수 (2026-08-19) — 주말·공휴일 미차감. 표시·저장 모두 이 값 사용.
  const { data: quickBizDays } = useQuery({
    queryKey: ["leave-days", companyId, quick.startDate, quick.endDate],
    enabled: !!companyId && !!quick.startDate && quick.leaveUnit === "full_day",
    queryFn: () => calcLeaveDays(companyId!, quick.startDate, quick.endDate || quick.startDate),
  });
  const quickDays = quick.leaveUnit === "half_day" ? 0.5
    : quick.leaveUnit === "two_hours" ? 0.25
    : !quick.startDate ? 0
    : (quickBizDays ?? 0);
  const createQuickLeave = useMutation({
    mutationFn: () => createLeaveRequest({
      companyId: companyId!,
      employeeId: rosterEmp!.id,
      leaveType: quick.leaveType,
      startDate: quick.startDate,
      endDate: quick.endDate || quick.startDate,
      days: quickDays,
      reason: quick.reason,
      leaveUnit: quick.leaveUnit as any,
      halfDayPeriod: quick.leaveUnit === "half_day" ? quick.halfDayPeriod : undefined,
      approverIds: [],
      ccUserIds: [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-requests-year"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setQuickOpen(false);
      resetQuick();
      toast("휴가를 등록했습니다", "success");
    },
    onError: (err: any) => toast(friendlyError(err, "등록에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // Send promotion notice
  const sendPromotion = useMutation({
    mutationFn: (params: { employeeId: string; noticeType: "first" | "second"; unusedDays: number; email: string; employeeName: string }) =>
      sendLeavePromotionNotice({ companyId: companyId!, ...params, year: currentYear }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-promotion-notices"] });
      queryClient.invalidateQueries({ queryKey: ["leave-promotion-candidates"] });
    },
    onError: (err: any) => toast("촉진 알림 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Approve mutation
  const approveMut = useMutation({
    mutationFn: (id: string) => approveLeaveRequest(id, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
    onError: (err: any) => toast("휴가 승인 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Reject mutation
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectLeaveRequest(id, userId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
    onError: (err: any) => toast("휴가 반려 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Cancel mutation — 승인된 휴가 취소 시 잔여 복구.
  //   2026-08-11 사장님: 승인된 건도 사유 입력 후 취소 가능(관리자는 시작된 휴가도),
  //   사유·취소자·시각 보존 + 신청 때와 동일 대상(승인자·참조자·신청자)에게 알림.
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      cancelLeaveRequest(id, { reason, cancelledBy: userId, allowStarted: !isEmployee }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setCancelTarget(null);
      setCancelReason("");
      toast("휴가가 취소되었습니다 (승인 건은 잔여 복구됨).", "success");
    },
    onError: (err: any) => toast("휴가 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });
  // 취소 사유 입력 모달 상태 — 대상 행과 입력값
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // 남은 연차 직접 입력 (사장님 지시 2026-07-30) — 입력값은 '지금 남은 연차'다.
  //   내부적으로 총부여 = 남은 + 사용 을 'base' 발생으로 기록한다. leave_balances 를 직접 쓰면
  //   자동 발생 cron 이 매일 자정 grants 합계로 되돌려 손으로 넣은 값이 사라진다.
  const setRemaining = useMutation({
    mutationFn: (params: { employeeId: string; remainingDays: number; usedDays: number }) =>
      setRemainingLeaveDays({
        companyId: companyId!,
        employeeId: params.employeeId,
        year: currentYear,
        remainingDays: params.remainingDays,
        usedDays: params.usedDays,
        createdBy: userId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["emp-leave-grants"] });
    },
    onError: (err: any) => toast("남은 연차 설정 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 연차 부여 방식 (자동부여 / 직접입력) — company_settings.settings JSONB
  const { data: grantMethod = "auto" } = useQuery<LeaveGrantMethod>({
    queryKey: ["leave-grant-method", companyId],
    queryFn: () => getLeaveGrantMethod(companyId!),
    enabled: !!companyId,
  });

  // 부여 방식 + 발생 기준 통합 저장 (2026-08-19 사장님 시안) — 자동부여 = 자동 발생 켬(선택 기준),
  //   직접입력 = 자동 발생 끔. 별도 '연차 자동 발생' 패널을 없애고 여기서 한 번에 저장한다.
  const saveGrantCfgMut = useMutation({
    mutationFn: async (next: { method: LeaveGrantMethod; basis: MonthlyAccrualBasis }) => {
      await setLeaveGrantMethod(companyId!, next.method);
      await setMonthlyAccrualSettings(companyId!, { enabled: next.method === "auto", basis: next.basis });
    },
    onSuccess: (_d, next) => {
      queryClient.invalidateQueries({ queryKey: ["leave-grant-method", companyId] });
      queryClient.invalidateQueries({ queryKey: ["leave-monthly-accrual", companyId] });
      toast(
        next.method === "auto"
          ? `연차 부여 방식: 자동부여 · ${ACCRUAL_BASIS_LABELS[next.basis].label}`
          : "연차 부여 방식: 직접입력",
        "success",
      );
    },
    onError: (err: any) => toast("부여 방식 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 연차 자동 발생(1년 미만 월 1일 + 1주년 법정 부여) — on/off + 기준(입사일/회계연도).
  //   실제 생성은 pg_cron. 설정이 없으면 켬이 기본이라 초기값도 true 로 둔다(로딩 중 잠깐 꺼짐으로 보이지 않게).
  const { data: accrual = { enabled: true, basis: "hire" as MonthlyAccrualBasis } } = useQuery({
    queryKey: ["leave-monthly-accrual", companyId],
    queryFn: () => getMonthlyAccrualSettings(companyId!),
    enabled: !!companyId,
  });

  // 회사별 휴가 유형·기본 일수 — 저장값이 없으면 법정 기본값
  const { data: companyLeaveTypes = defaultCompanyLeaveTypes() } = useQuery({
    queryKey: ["company-leave-types", companyId],
    queryFn: () => getCompanyLeaveTypes(companyId!),
    enabled: !!companyId,
  });
  const [typesEditing, setTypesEditing] = useState(false);
  const [draftTypes, setDraftTypes] = useState<CompanyLeaveType[] | null>(null);
  const saveTypesMut = useMutation({
    mutationFn: (next: CompanyLeaveType[]) => setCompanyLeaveTypes(companyId!, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-leave-types", companyId] });
      setTypesEditing(false); setDraftTypes(null);
      toast("휴가 유형을 저장했습니다", "success");
    },
    onError: (err: any) => toast("휴가 유형 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });
  // 유형 라벨 조회 — 회사 설정 우선, 없으면 저장된 원본 값 그대로(과거 요청이 깨지지 않게)
  const leaveTypeLabel = (v: string) => companyLeaveTypes.find((t) => t.value === v)?.label
    || LEAVE_TYPES.find((t) => t.value === v)?.label || v;
  const syncAccrualMut = useMutation({
    mutationFn: () => syncLeaveAccruals(),
    onSuccess: (count: number) => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances-list"] });
      queryClient.invalidateQueries({ queryKey: ["emp-leave-grants"] });
      toast(count > 0 ? `발생 ${count}건이 추가되었습니다` : "추가할 발생분이 없습니다", "success");
    },
    onError: (err: any) => toast("반영 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const activeEmployees = employees.filter((e: any) => e.status === "active" || e.status === "joined");

  // 휴가 탭 서브뷰 — '직원별 연차' / '설정' (2026-08-06 사장님 시안)
  const [calendarOpen, setCalendarOpen] = useState(false);
  // 이름 클릭 → 그 구성원의 전체 연차 신청 내역, 월 셀 클릭 → 그 달 사용 내역
  const [rosterEmp, setRosterEmp] = useState<{ id: string; name: string } | null>(null);
  const [rosterMonth, setRosterMonth] = useState<{ empId: string; name: string; month: number } | null>(null);
  useModalKeys(calendarOpen, () => setCalendarOpen(false));
  useModalKeys(!!rosterEmp, () => setRosterEmp(null));
  useModalKeys(!!rosterMonth, () => setRosterMonth(null));

  // 연차 표용 — 그 해 전체 신청 건(상태 필터와 무관하게 항상 전량).
  //   월별 칸은 '승인' 건만 집계한다(신청 중인 건은 아직 쓴 게 아니다).
  const { data: yearRequests = [] } = useQuery({
    queryKey: ["leave-requests-year", companyId, currentYear],
    queryFn: () => getLeaveRequests(companyId!),
    enabled: !!companyId,
  });
  const rosterRows = useMemo(() => {
    const byEmp = new Map<string, { total: number; months: number[]; used: number }>();
    const ensure = (id: string) => {
      if (!byEmp.has(id)) byEmp.set(id, { total: 0, months: Array(12).fill(0), used: 0 });
      return byEmp.get(id)!;
    };
    for (const b of (visibleBalances as any[])) {
      const r = ensure(b.employee_id);
      r.total = Number(b.total_days || 0);
      r.used = Number(b.used_days || 0);
    }
    for (const req of (yearRequests as any[])) {
      if (req.status !== "approved" || !req.start_date) continue;
      const d = String(req.start_date);
      if (!d.startsWith(String(currentYear))) continue;
      const m = Number(d.slice(5, 7)) - 1;
      if (m < 0 || m > 11) continue;
      const r = ensure(req.employee_id);
      r.months[m] += Number(req.days || 0);
    }
    // 표에 올릴 대상 — 관리자는 재직 직원 전원(연차 미설정자도 0으로 보이게), 직원은 본인만
    const targets = isEmployee
      ? (myEmployee ? [myEmployee] : [])
      : activeEmployees;
    //   순서 = 사번 순 → 가나다 → ABC (lib/people-sort, 2026-08-27 사장님 — 디렉토리·급여표와 같은 순서)
    return [...(targets as any[])].sort(comparePeople).map((e: any) => {
      const r = byEmp.get(e.id) || { total: 0, months: Array(12).fill(0), used: 0 };
      // 총 사용일수는 월별 칸의 합 — 표 안에서 눈으로 더한 값과 어긋나지 않게(시안 규약).
      //   leave_balances.used_days 는 차감 원장이라 조정분까지 포함될 수 있어 표의 합과 다를 수 있다.
      const usedTotal = r.months.reduce((a, b) => a + b, 0);
      return {
        id: e.id,
        name: e.name || "-",
        employee_number: e.employee_number || null,
        total: r.total,
        months: r.months,
        used: usedTotal,
        remain: Math.max(0, r.total - usedTotal),
        hasBalance: byEmp.has(e.id),
      };
    });
  }, [visibleBalances, yearRequests, activeEmployees, isEmployee, myEmployee, currentYear]);

  // 이름/월 팝업에 쓸 그 직원의 신청 내역
  const rosterEmpRequests = useMemo(
    () => (yearRequests as any[]).filter((r: any) => r.employee_id === rosterEmp?.id),
    [yearRequests, rosterEmp],
  );
  const rosterMonthRequests = useMemo(
    () => (yearRequests as any[]).filter((r: any) =>
      r.employee_id === rosterMonth?.empId
      && r.status === "approved"
      && String(r.start_date || "").startsWith(`${currentYear}-${String((rosterMonth?.month ?? 0) + 1).padStart(2, "0")}`)),
    [yearRequests, rosterMonth, currentYear],
  );

  // R12: 연차 부여 방식 — 선택+저장 후 작은 요약으로 접힘 (변경 시 펼침)
  const [grantEditing, setGrantEditing] = useState(false);
  const [pendingGrant, setPendingGrant] = useState<LeaveGrantMethod | null>(null);
  const [pendingBasis, setPendingBasis] = useState<MonthlyAccrualBasis | null>(null);

  // 연차 일수 인라인 편집 상태
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalanceVal, setEditingBalanceVal] = useState<string>("");

  // 휴가 캘린더 이름 조회 — leave_requests.employees(name) 조인은 employees RESTRICTIVE
  //   RLS(직원 role=본인 1행만) 로 타인 행이 null 이 돼 "Unknown" 이 뜨던 원인. get_company_directory()
  //   기반 directory(안전 필드만, 전 직원) 로 employee_id → 이름을 우선 조회하고, 그래도 없으면
  //   (관리자 role 등 조인이 이미 성공한 경우) 기존 조인 결과로 폴백.
  const directoryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (directory as any[] || []).forEach((d: any) => { m[d.id] = d.name; });
    return m;
  }, [directory]);

  // Build leave calendar: who's on leave on which dates — 연차/반차/기타 3버킷으로 구분 표시.
  const leaveCalendar = useMemo(() => {
    const approved = leaveRequests.filter((r: any) => r.status === "approved");
    const dateMap: Record<string, { name: string; type: string; bucket: "annual" | "half" | "other" }[]> = {};

    approved.forEach((r: any) => {
      if (!r.start_date) return;
      // 날짜 문자열을 UTC 자정으로 고정해 순회 — 로컬 파싱이면 캘린더 키(toISOString)가 하루 밀린다.
      const start = new Date(String(r.start_date).slice(0, 10) + "T00:00:00Z");
      const end = new Date(String(r.end_date || r.start_date).slice(0, 10) + "T00:00:00Z");
      const name = directoryNameById[r.employee_id] || r.employees?.name || "구성원";
      const type = leaveTypeLabel(r.leave_type);
      const isHalf = r.leave_unit === "half_day" || r.leave_unit === "two_hours";
      const bucket: "annual" | "half" | "other" = isHalf ? "half" : r.leave_type === "annual" ? "annual" : "other";
      let guard = 0;
      for (let d = new Date(start); d <= end && guard++ < 400; d = new Date(d.getTime() + 86400000)) {
        const key = d.toISOString().slice(0, 10);
        if (!dateMap[key]) dateMap[key] = [];
        dateMap[key].push({ name, type, bucket });
      }
    });

    return dateMap;
  }, [leaveRequests, directoryNameById]);

  // Calendar for current month
  const today = new Date();
  const [calMonth, setCalMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const calYear = Number(calMonth.split("-")[0]);
  const calMon = Number(calMonth.split("-")[1]);
  const calDaysInMonth = new Date(calYear, calMon, 0).getDate();
  const calFirstDow = new Date(calYear, calMon - 1, 1).getDay();

  // 직원 계정은 본인 신청 + 본인이 승인자/참조자인 건만 노출 — 타인 휴가 승인내용은 숨김.
  //   (관리자/대표는 전원 표시. 비관리자 승인자도 승인 대상 건은 보여야 함.)
  const visibleRequests = useMemo(() => {
    if (!isEmployee) return leaveRequests as any[];
    const myEmpIds = new Set((employees as any[]).filter((e: any) => e.user_id === userId).map((e: any) => e.id));
    return (leaveRequests as any[]).filter((r: any) => {
      if (myEmpIds.has(r.employee_id)) return true;
      const steps = Array.isArray(r.approval_steps) ? r.approval_steps : [];
      if (steps.some((s: any) => String(s.approver_id) === userId)) return true;
      if (r.requested_approver_id === userId || r.second_approver_id === userId) return true;
      if (Array.isArray(r.cc_user_ids) && r.cc_user_ids.includes(userId)) return true;
      return false;
    });
  }, [leaveRequests, isEmployee, employees, userId]);


  // Track which employees have no balance yet
  const employeesWithBalance = new Set(balances.map((b: any) => b.employee_id));
  const employeesWithoutBalance = activeEmployees.filter((e: any) => !employeesWithBalance.has(e.id));

  // Calculate leave type usage summary
  const leaveTypeSummary = useMemo(() => {
    const approved = leaveRequests.filter((r: any) => r.status === "approved");
    return companyLeaveTypes.map(lt => {
      const used = approved.filter((r: any) => r.leave_type === lt.value).reduce((s: number, r: any) => s + Number(r.days || 0), 0);
      const pending = leaveRequests.filter((r: any) => r.leave_type === lt.value && r.status === "pending").length;
      return { ...lt, used, pending };
    });
  }, [leaveRequests, companyLeaveTypes]);

  // Flex 승인 체인 진행 상태 계산 (approval_steps 우선, 없으면 구 1차/2차).
  const stepInfo = (r: any): {
    steps: { approver_id: string; status: string }[];
    currentApprover: string | null; // 현재 pending 단계의 승인자 user id
    stageNo: number;                // 현재(또는 완료) 단계 번호
    total: number;
    label: string;                  // 상태 라벨
  } => {
    const raw = Array.isArray(r.approval_steps) ? r.approval_steps : [];
    if (raw.length > 0) {
      const steps = raw.map((s: any) => ({ approver_id: String(s.approver_id), status: s.status || "pending" }));
      const idx = steps.findIndex((s: any) => s.status === "pending");
      const done = steps.filter((s: any) => s.status === "approved").length;
      let label: string;
      if (r.status === "approved") label = "승인";
      else if (r.status === "rejected") label = "반려";
      else if (idx >= 0) label = `${idx + 1}단계 승인 대기${steps.length > 1 ? ` (${done}/${steps.length})` : ""}`;
      else label = "승인";
      return {
        steps,
        currentApprover: idx >= 0 ? steps[idx].approver_id : null,
        stageNo: idx >= 0 ? idx + 1 : steps.length,
        total: steps.length,
        label,
      };
    }
    // 구 흐름 폴백
    const cur = r.status === "first_approved" ? r.second_approver_id : r.requested_approver_id;
    const st = LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS];
    return {
      steps: [],
      currentApprover: (r.status === "pending" || r.status === "first_approved") ? (cur || null) : null,
      stageNo: r.status === "first_approved" ? 2 : 1,
      total: r.second_approver_id ? 2 : 1,
      label: st?.label || r.status,
    };
  };
  //   머리단 ≡ 가 고를 칸 값(표에 보이는 글자) + 정렬 — 취소·승인 로직은 손대지 않는다
  const lrVal = (r: any) => ({
    emp: r.employees?.name || "—",
    type: leaveTypeLabel(r.leave_type),
    period: r.start_date || "",
    days: String(Number(r.days || 0)),
    approver: (() => {
      const info = stepInfo(r);
      if (info.steps.length > 0) return info.steps.map((st: any) => { const u = memberById[st.approver_id]; return u?.name || u?.email || "구성원"; }).join(" → ");
      return r.requested_approver?.name || r.requested_approver?.email || "전체";
    })(),
    status: stepInfo(r).label,
  });
  const lrSpec = (k: keyof ReturnType<typeof lrVal>) => lrCf.spec(k, visibleRequests.map((r: any) => lrVal(r)[k]));
  const shownRequests = useMemo(() => {
    const dir = lrSort.dir === "asc" ? 1 : -1;
    return (visibleRequests as any[]).filter((r) => lrCf.hit(lrVal(r))).sort((a, b) => {
      if (lrSort.key === "days") return (Number(a.days || 0) - Number(b.days || 0)) * dir;
      return cmp(lrVal(a)[lrSort.key], lrVal(b)[lrSort.key]) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRequests, lrSort, lrCf.key]);

  return (
    <div>
      {/* ── 휴가 탭 서브뷰 (2026-08-06 사장님 시안) ──
          상단 KPI 카드는 이 탭에서 감추고, '직원별 연차'(표) / '설정'(부여 방식·휴가 유형) 로 나눈다. */}
      <div className="collect-tabs leave-subtabs">
        {([["roster", "직원별 연차"], ["requests", "신청"], ...(!isEmployee ? [["promotion", "촉진"]] : []), ["settings", "설정"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setLeaveView(k as typeof leaveView)} className={leaveView === k ? "collect-tab collect-tab-on" : "collect-tab"}>
            {l}{k === "requests" && visibleRequests.filter((r: any) => r.status === "pending").length > 0 && <span className="collect-tab-cnt inv-tab-warn">{visibleRequests.filter((r: any) => r.status === "pending").length}</span>}
          </button>
        ))}
      </div>

      {leaveView === "roster" && (<>
        {/*   2026-08-18 상자 안 상자 금지 — 카드 껍데기(glass-card) 대신 선으로만 구역을 가른다 */}
        <div className="leave-roster">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-[var(--text-muted)]">{currentYear}년 직원별 연차</h3>
          </div>
          {rosterRows.length === 0 ? (
            <div className="templates-empty">표시할 구성원이 없습니다.</div>
          ) : (
            <div className="leave-roster-scroll">
              <table className="leave-roster-table">
                <thead>
                  <tr>
                    <th className="leave-roster-th leave-roster-name-col">이름</th>
                    <th className="leave-roster-th">부여일수</th>
                    {Array.from({ length: 12 }, (_, m) => (
                      <th key={m} className="leave-roster-th">{m + 1}월</th>
                    ))}
                    <th className="leave-roster-th">총 사용일수</th>
                    <th className="leave-roster-th">잔여일수</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map((row) => (
                    <tr key={row.id} className="leave-roster-row">
                      <td className="leave-roster-td leave-roster-name-col">
                        <button
                          onClick={() => setRosterEmp({ id: row.id, name: row.name })}
                          className="leave-roster-name"
                          title="전체 연차 신청 내역 보기"
                        >
                          {row.name}{row.employee_number && <span className="emp-no">#{row.employee_number}</span>}
                        </button>
                      </td>
                      <td className="leave-roster-td mono-number">{row.total}</td>
                      {row.months.map((v, m) => (
                        <td key={m} className="leave-roster-td mono-number">
                          {v > 0 ? (
                            <button
                              onClick={() => setRosterMonth({ empId: row.id, name: row.name, month: m })}
                              className="leave-roster-cell-btn"
                              title="사용 날짜·승인 내역 보기"
                            >
                              {v}
                            </button>
                          ) : (
                            <span className="text-[var(--text-dim)]">·</span>
                          )}
                        </td>
                      ))}
                      <td className="leave-roster-td mono-number font-semibold">{row.used}</td>
                      <td className="leave-roster-td mono-number font-bold">{row.remain}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}

      {leaveView === "requests" && (<>
      {/* Controls — 상태 칩은 이 목록의 '보기', 달력은 같은 목록을 달력으로 */}
      <div ref={approveSectionRef} id="leave-approve-section" className="leave-filter-toolbar">
        <button onClick={() => setCalendarOpen(true)} className="btn-secondary btn-sm">달력</button>
        <ChipGroup value={statusFilter} onChange={setStatusFilter}
          options={[
            { value: "all", label: "전체" },
            { value: "pending", label: visibleRequests.filter((r: any) => r.status === "pending").length > 0 ? `대기 ${visibleRequests.filter((r: any) => r.status === "pending").length}` : "대기" },
            { value: "approved", label: "승인" },
            { value: "rejected", label: "반려" },
          ]} />
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary btn-sm"
        >
          + 휴가 신청
        </button>
      </div>

      {/* Leave Request Form */}
      {showForm && (
        <div className="leave-request-form glass-card">
          <h4 className="section-title">휴가 신청</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-4">
            {isEmployee && myEmployee ? (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">신청자</label>
                <div className="w-full px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)]">
                  {myEmployee.name}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">직원 *</label>
                <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                  <option value="">선택...</option>
                  {activeEmployees.map((e: any) => (<option key={e.id} value={e.id}>{e.name}</option>))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">휴가 유형</label>
              <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {companyLeaveTypes.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">사용 단위</label>
              <select value={form.leaveUnit} onChange={(e) => setForm({ ...form, leaveUnit: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {LEAVE_UNITS.map((u) => (<option key={u.value} value={u.value}>{u.label} ({u.days}일)</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">시작일 *</label>
              <DateField value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="field-input" />
            </div>
            {form.leaveUnit === "full_day" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
                <DateField value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="field-input" />
              </div>
            )}
            {form.leaveUnit === "half_day" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">반차 시간대</label>
                <div className="flex gap-1">
                  {([
                    { v: "am" as const, label: "오전" },
                    { v: "pm" as const, label: "오후" },
                  ]).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setForm({ ...form, halfDayPeriod: opt.v })}
                      className={`flex-1 px-2 py-2.5 rounded-xl text-xs font-semibold border transition ${
                        form.halfDayPeriod === opt.v
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {opt.label} 반차
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form.leaveUnit === "two_hours" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">시간대</label>
                <div className="flex gap-1">
                  <select value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="flex-1 px-2 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
                    <option value="">시작</option>
                    {["09:00","10:00","11:00","13:00","14:00","15:00","16:00"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="flex-1 px-2 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
                    <option value="">종료</option>
                    {["11:00","12:00","13:00","15:00","16:00","17:00","18:00"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="개인 사유" className="field-input" />
            </div>
          </div>

          {/* 보드 스타일 결재 패널 — 참조 + N단계 승인 */}
          {(() => {
            // 이미 선택된(승인자·참조) user id 집합
            const usedStepIds = new Set(form.approverSteps.filter(Boolean));
            const usedCc = new Set(form.ccUserIds);
            const memberLabel = (uid: string) => {
              const u = memberById[uid];
              if (!u) return uid;
              const meta = memberMeta[uid];
              const sub = [meta?.department, meta?.position].filter(Boolean).join(" · ");
              return { name: u.name || u.email || "구성원", sub, role: u.role };
            };
            const Avatar = ({ uid }: { uid: string }) => {
              const u = memberById[uid];
              const ch = (u?.name || u?.email || "?").slice(0, 1).toUpperCase();
              return (
                <span className="w-7 h-7 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-bold flex items-center justify-center shrink-0">
                  {ch}
                </span>
              );
            };
            const stepNames = form.approverSteps
              .map((id) => (id ? (memberById[id]?.name || memberById[id]?.email) : null))
              .filter(Boolean) as string[];
            const ccNames = form.ccUserIds
              .map((id) => memberById[id]?.name || memberById[id]?.email)
              .filter(Boolean) as string[];

            return (
              <div className="leave-approval-chain-panel">
                {/* 참조 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[var(--text-muted)]">참조 <span className="text-[var(--text-dim)] font-normal">(알림만)</span></span>
                    <select
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id && !form.ccUserIds.includes(id)) {
                          setForm({ ...form, ccUserIds: [...form.ccUserIds, id] });
                        }
                      }}
                      className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] font-semibold"
                    >
                      <option value="">+ 참조 추가</option>
                      {(members as any[])
                        .filter((u: any) => !usedCc.has(u.id) && !usedStepIds.has(u.id) && u.id !== form.employeeId)
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name || u.email}</option>
                        ))}
                    </select>
                  </div>
                  {form.ccUserIds.length === 0 ? (
                    <div className="text-[11px] text-[var(--text-dim)]">참조 대상이 없습니다</div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {form.ccUserIds.map((uid) => {
                        const lbl = memberLabel(uid) as any;
                        return (
                          <div key={uid} className="flex items-center gap-2 bg-[var(--bg-card)] rounded-xl px-2.5 py-1.5">
                            <Avatar uid={uid} />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">{lbl.name}</div>
                              {lbl.sub && <div className="text-[10px] text-[var(--text-dim)] truncate">{lbl.sub}</div>}
                            </div>
                            <button type="button" onClick={() => setForm({ ...form, ccUserIds: form.ccUserIds.filter((id) => id !== uid) })} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-sm px-1">×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* N단계 승인 */}
                <div className="space-y-3">
                  {form.approverSteps.map((stepId, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[var(--text-muted)]">{i + 1}단계 승인</span>
                        {form.approverSteps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, approverSteps: form.approverSteps.filter((_, idx) => idx !== i) })}
                            className="text-[10px] text-[var(--text-dim)] hover:text-[var(--danger)]"
                          >
                            단계 삭제
                          </button>
                        )}
                      </div>
                      {stepId ? (
                        <div className="flex items-center gap-2 bg-[var(--bg-card)] rounded-xl px-2.5 py-1.5">
                          <Avatar uid={stepId} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate">{(memberLabel(stepId) as any).name}</div>
                            {(memberLabel(stepId) as any).sub && <div className="text-[10px] text-[var(--text-dim)] truncate">{(memberLabel(stepId) as any).sub}</div>}
                          </div>
                          <button type="button" onClick={() => setForm({ ...form, approverSteps: form.approverSteps.map((s, idx) => idx === i ? "" : s) })} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-sm px-1">×</button>
                        </div>
                      ) : (
                        <select
                          value=""
                          onChange={(e) => setForm({ ...form, approverSteps: form.approverSteps.map((s, idx) => idx === i ? e.target.value : s) })}
                          className="field-input w-full"
                        >
                          <option value="">승인자 선택 (구성원)</option>
                          {(members as any[])
                            .filter((u: any) => (!usedStepIds.has(u.id) || u.id === stepId) && !usedCc.has(u.id) && u.id !== form.employeeId)
                            .map((u: any) => {
                              const meta = memberMeta[u.id];
                              const sub = [meta?.department, meta?.position].filter(Boolean).join(" · ");
                              return <option key={u.id} value={u.id}>{u.name || u.email}{sub ? ` — ${sub}` : ""}</option>;
                            })}
                        </select>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, approverSteps: [...form.approverSteps, ""] })}
                    className="w-full text-xs font-semibold text-[var(--primary)] border border-dashed border-[var(--primary)]/40 rounded-xl py-2 hover:bg-[var(--primary)]/5 transition"
                  >
                    + 승인 단계 추가하기
                  </button>
                </div>

                {/* 요약 */}
                {(stepNames.length > 0 || ccNames.length > 0) && (
                  <div className="mt-3 text-[11px] text-[var(--text-muted)]">
                    {stepNames.length > 0 && <span><strong className="text-[var(--text)]">{stepNames.join(", ")}</strong>님에게 승인</span>}
                    {stepNames.length > 0 && ccNames.length > 0 && ", "}
                    {ccNames.length > 0 && <span><strong className="text-[var(--text)]">{ccNames.join(", ")}</strong>님에게 참조</span>}
                    를 요청합니다.
                  </div>
                )}
              </div>
            );
          })()}

          <button
            onClick={() => form.employeeId && form.startDate && !(form.endDate && form.endDate < form.startDate) && createLeave.mutate()}
            disabled={!form.employeeId || !form.startDate || (!!form.endDate && form.endDate < form.startDate) || createLeave.isPending}
            className="btn-primary mt-4"
          >
            {createLeave.isPending ? "처리 중..." : `승인 요청하기 (${(() => {
              const unit = form.leaveUnit;
              if (unit === "half_day") return 0.5;
              if (unit === "two_hours") return 0.25;
              if (!form.startDate) return 1;
              const start = new Date(form.startDate);
              const end = new Date(form.endDate || form.startDate);
              return Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            })()}일)`}
          </button>
        </div>
      )}

      {/* Leave Requests List */}
      <div className="leave-requests-table">
        {visibleRequests.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4"><Ico e="🏖" /></div>
            <div className="text-sm text-[var(--text-muted)]">휴가 신청 내역이 없습니다</div>
          </div>
        ) : (
          <div className="ev-scroll leave-req-scroll"><table ref={lrTableRef} className="ev-table ev-lined leave-req-table">
            <thead>
              <tr>
                <SortableTh label="직원" sortKey="emp" sort={lrSort} onSort={onLrSort} filter={lrSpec("emp")} resize={lrResize("emp", 1)} />
                <SortableTh label="유형" sortKey="type" sort={lrSort} onSort={onLrSort} filter={lrSpec("type")} resize={lrResize("type", 2)} />
                <SortableTh label="기간" sortKey="period" sort={lrSort} onSort={onLrSort} resize={lrResize("period", 3)} />
                <SortableTh label="일수" sortKey="days" sort={lrSort} onSort={onLrSort} resize={lrResize("days", 4)} />
                <SortableTh label="사유" resize={lrResize("reason", 5)} />
                <SortableTh label="승인자" sortKey="approver" sort={lrSort} onSort={onLrSort} filter={lrSpec("approver")} resize={lrResize("approver", 6)} />
                <SortableTh label="상태" sortKey="status" sort={lrSort} onSort={onLrSort} filter={lrSpec("status")} resize={lrResize("status", 7)} />
                <SortableTh label="액션" resize={lrResize("action", 8)} />
              </tr>
            </thead>
            <tbody>
              {shownRequests.map((r: any) => {
                const st = LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS] || LEAVE_REQUEST_STATUS.pending;
                const leaveLabel = leaveTypeLabel(r.leave_type);
                return (
                  <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-5 py-3 text-sm font-medium">{r.employees?.name || "—"}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{leaveLabel}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.start_date}{r.start_date !== r.end_date ? ` ~ ${r.end_date}` : ""}
                      {r.leave_unit === "two_hours" && r.start_time ? ` ${r.start_time}~${r.end_time}` : ""}
                      {r.leave_unit === "half_day" && r.start_time ? (() => {
                        // 오전/오후 판정: 시작 시각이 12:00 이전이면 오전 반차.
                        const isAm = Number(String(r.start_time).slice(0, 2)) < 12;
                        return <span className="ml-1 text-[10px] text-[var(--primary)]">({isAm ? "오전" : "오후"} 반차 {r.start_time}~{r.end_time})</span>;
                      })() : ""}
                    </td>
                    <td className="px-5 py-3 text-sm text-center font-medium">
                      {Number(r.days)}일
                      {r.leave_unit && r.leave_unit !== "full_day" && (
                        <span className="ml-1 text-[10px] text-[var(--text-dim)]">
                          ({LEAVE_UNITS.find(u => u.value === r.leave_unit)?.label || r.leave_unit})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.reason || "—"}
                      {/* 취소 내역 보존 표시 (2026-08-11) — 사유·취소자·시각 */}
                      {r.status === "cancelled" && (r.cancel_reason || r.cancelled_at) && (
                        <div
                          className="mt-0.5 text-[10px] text-[var(--danger)]"
                          title={`취소자: ${memberById[r.cancelled_by]?.name || "-"} · ${r.cancelled_at ? new Date(r.cancelled_at).toLocaleString("ko-KR") : "-"}`}
                        >
                          취소{r.cancel_reason ? `: ${r.cancel_reason}` : "됨"}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      <div className="flex flex-col gap-0.5">
                        {(() => {
                          const info = stepInfo(r);
                          if (info.steps.length > 0) {
                            return info.steps.map((s: any, i: number) => {
                              const u = memberById[s.approver_id];
                              const nm = u?.name || u?.email || "구성원";
                              const mark = s.status === "approved" ? "✓" : s.status === "rejected" ? "✕" : "·";
                              const cls = s.status === "approved" ? "text-[var(--success)]" : s.status === "rejected" ? "text-[var(--danger)]" : "text-[var(--text-dim)]";
                              return <span key={i}><span className={cls}>{mark}</span> {i + 1}단계: {nm}</span>;
                            });
                          }
                          return (
                            <>
                              <span>1차: {r.requested_approver?.name || r.requested_approver?.email || <span className="text-[var(--text-dim)]">전체</span>}</span>
                              {r.second_approver_id && <span>2차: {r.second_approver?.name || r.second_approver?.email || "—"}</span>}
                            </>
                          );
                        })()}
                        {Array.isArray(r.cc_user_ids) && r.cc_user_ids.length > 0 && (
                          <span className="text-[10px] text-[var(--text-dim)]">참조 {r.cc_user_ids.length}명</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{stepInfo(r).label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        {/* 전자결재로 올라온 휴가는 여기서 처리할 수 없다 (2026-08-21 감사):
                            목록에 병합될 때 id 가 'approval-<uuid>' 라 휴가 API 를 부르면 무조건
                            실패하고 "휴가 승인 실패" 토스트만 떴다. 처리는 결재 허브에서 한다. */}
                        {r._source === "approval" ? (
                          (r.status === "pending" || r.status === "first_approved") ? (
                            <a href="/approvals?tab=my-approvals"
                               className="text-[10px] px-2 py-1 rounded bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 whitespace-nowrap">
                              결재 허브에서 처리 →
                            </a>
                          ) : (
                            <span className="text-[10px] text-[var(--text-dim)]">전자결재</span>
                          )
                        ) : (<>
                        {(r.status === "pending" || r.status === "first_approved") && (() => {
                          // 승인/반려 버튼 노출 조건.
                          //   · 현재 pending 단계의 지정 승인자이면 노출 — isEmployee 무관.
                          //   · owner/admin(!isEmployee)은 지정 승인자가 따로 있어도 항상 오버라이드 노출.
                          //     (백엔드 approveLeaveRequest 도 isAdmin 오버라이드를 허용 — 정합)
                          const info = stepInfo(r);
                          const canAct = info.currentApprover === userId || !isEmployee;
                          if (!canAct) return null;
                          const stageLabel = info.steps.length > 0
                            ? `${info.stageNo}단계 승인`
                            : (r.status === "first_approved" ? "2차 승인" : "1차 승인");
                          return (
                            <>
                              <button
                                onClick={() => approveMut.mutate(r.id)}
                                className="text-[10px] px-2 py-1 rounded bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20"
                              >
                                {stageLabel}
                              </button>
                              <button
                                onClick={() => rejectMut.mutate(r.id)}
                                className="text-[10px] px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20"
                              >
                                반려
                              </button>
                            </>
                          );
                        })()}
                        {/* 취소 — 대기/1차승인/승인 상태. v4 H2: 본인 직원도 취소 가능(시작 전만).
                            2026-08-11 사장님: 관리자는 승인된 건·이미 시작된 건도 사유 입력 후 취소 가능. */}
                        {(r.status === "pending" || r.status === "first_approved" || r.status === "approved") && (() => {
                          const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
                          const isFuture = r.start_date > todayKst;
                          const isMine = (employees as any[])?.find((emp: any) => emp.id === r.employee_id)?.user_id === userId;
                          if (isEmployee && !isMine) return null;
                          const canCancel = !isEmployee || isFuture; // 관리자는 언제나, 직원 본인은 시작 전만
                          return (
                            <button
                              onClick={() => {
                                if (!canCancel) return;
                                setCancelReason("");
                                setCancelTarget(r);
                              }}
                              disabled={cancelMut.isPending || !canCancel}
                              title={canCancel ? "휴가 취소 (사유 입력)" : "이미 시작된(또는 오늘) 휴가는 취소 불가"}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              취소
                            </button>
                          );
                        })()}
                        </>)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
      </>)}

      {/* 휴가 취소 사유 모달 (2026-08-11 사장님) — 승인 건은 사유 필수, 내역 보존 + 신청과 동일 알림 */}
      {cancelTarget && (
        <div className="leave-cancel-overlay" onClick={() => !cancelMut.isPending && setCancelTarget(null)}>
          <div className="leave-cancel-panel" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-[var(--text)] mb-1">휴가 취소</div>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              {cancelTarget.employees?.name || "직원"} · {cancelTarget.start_date === cancelTarget.end_date
                ? cancelTarget.start_date
                : `${cancelTarget.start_date} ~ ${cancelTarget.end_date}`} ({Number(cancelTarget.days)}일)
              {cancelTarget.status === "approved" && (
                <span className="block mt-1 text-[var(--warning)]">승인된 휴가입니다 — 취소하면 연차 잔여가 복구되고, 신청 때와 동일하게 승인자·참조자에게 알림이 갑니다.</span>
              )}
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={cancelTarget.status === "approved" ? "취소 사유 (필수)" : "취소 사유 (선택)"}
              rows={3}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCancelTarget(null)} disabled={cancelMut.isPending}
                className="px-3 py-1.5 text-xs text-[var(--text-muted)]">닫기</button>
              <button
                onClick={() => {
                  if (cancelTarget.status === "approved" && !cancelReason.trim()) {
                    toast("승인된 휴가를 취소하려면 사유를 입력하세요", "error");
                    return;
                  }
                  cancelMut.mutate({ id: cancelTarget.id, reason: cancelReason.trim() || undefined });
                }}
                disabled={cancelMut.isPending}
                className="px-3 py-1.5 rounded-lg bg-[var(--danger)] text-white text-xs font-semibold hover:bg-[var(--danger)]/90 disabled:opacity-50"
              >
                {cancelMut.isPending ? "취소 중..." : "휴가 취소 확정"}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveView === "settings" && (<>
        {/* 휴가 유형 — 작은 칩으로 한 줄 (2026-08-06 사장님: 공간 차지 줄이기).
            유형·기본 일수는 회사별로 편집 가능 — company_settings.settings.leave_types */}
        <div className="leave-type-overview">
          <div className="leave-type-head">
            <h3 className="text-sm font-bold text-[var(--text-muted)]">휴가 유형</h3>
            {!isEmployee && !typesEditing && (
              <button
                onClick={() => { setDraftTypes(companyLeaveTypes.map((t) => ({ ...t }))); setTypesEditing(true); }}
                className="leave-type-edit-btn"
              >
                유형·일수 수정
              </button>
            )}
          </div>

          {!typesEditing ? (
            <div className="leave-type-chip-row">
              {leaveTypeSummary.map(lt => (
                <div key={lt.value} className="leave-type-chip">
                  <span className="leave-type-chip-label">{lt.label}</span>
                  <span className="leave-type-chip-days">{lt.defaultDays}일</span>
                  {lt.used > 0 && <span className="leave-type-chip-used">-{lt.used}</span>}
                  {lt.pending > 0 && <span className="leave-type-chip-pending">{lt.pending}건 대기</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="leave-type-editor glass-card">
              <p className="text-[11px] text-[var(--text-dim)] mb-3">
                회사 규정에 맞게 유형 이름과 기본 일수를 고치세요. 이미 신청된 휴가의 유형은 그대로 유지됩니다.
              </p>
              <div className="leave-type-editor-rows">
                {(draftTypes || []).map((t, i) => (
                  <div key={i} className="leave-type-editor-row">
                    <input
                      value={t.label}
                      onChange={(e) => setDraftTypes((prev) => (prev || []).map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                      placeholder="유형 이름"
                      className="leave-type-editor-name field-input"
                    />
                    <div className="leave-type-editor-days-wrap">
                      <input
                        type="number"
                        min={0}
                        value={t.defaultDays}
                        onChange={(e) => setDraftTypes((prev) => (prev || []).map((x, xi) => xi === i ? { ...x, defaultDays: Math.max(0, Number(e.target.value) || 0) } : x))}
                        className="leave-type-editor-days field-input"
                      />
                      <span className="text-[11px] text-[var(--text-dim)]">일</span>
                    </div>
                    <button
                      onClick={() => setDraftTypes((prev) => (prev || []).filter((_, xi) => xi !== i))}
                      className="leave-type-editor-del"
                      title="이 유형 삭제"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
              <div className="leave-type-editor-actions">
                <button
                  onClick={() => setDraftTypes((prev) => [...(prev || []), { value: `custom_${Date.now()}`, label: "", defaultDays: 0 }])}
                  className="btn-secondary btn-sm"
                >
                  유형 추가
                </button>
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => { setTypesEditing(false); setDraftTypes(null); }}
                    disabled={saveTypesMut.isPending}
                    className="leave-type-editor-cancel"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      const cleaned = (draftTypes || [])
                        .map((t) => ({ ...t, label: t.label.trim() }))
                        .filter((t) => t.label !== "");
                      if (cleaned.length === 0) { toast("휴가 유형을 최소 1개는 남겨주세요", "error"); return; }
                      saveTypesMut.mutate(cleaned);
                    }}
                    disabled={saveTypesMut.isPending}
                    className="btn-primary btn-sm"
                  >
                    {saveTypesMut.isPending ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 연차 부여 방식 — 2026-08-19 사장님 시안: 자동부여를 고르면 그 아래에서 기준(입사일/회계연도)을
            바로 고른다. 직접입력이면 자동 발생(매일 자정 pg_cron)도 끈다. 저장 후엔 작은 요약으로 접힘. */}
        {!isEmployee && (
          <div className="leave-grant-method-panel glass-card">
            {!grantEditing ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--text-muted)]">
                  연차 부여 방식 ·{" "}
                  <strong className="text-[var(--text)]">
                    {grantMethod === "auto" ? `자동부여 · ${ACCRUAL_BASIS_LABELS[accrual.basis].label}` : "직접입력"}
                  </strong>
                </div>
                <button
                  onClick={() => { setPendingGrant(grantMethod); setPendingBasis(accrual.basis); setGrantEditing(true); }}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-surface)] transition shrink-0"
                >
                  변경
                </button>
              </div>
            ) : (
              <>
                <div className="text-sm font-bold mb-1">연차 부여 방식</div>
                <p className="text-[11px] text-[var(--text-dim)] mb-3">
                  회사 정책에 맞게 선택 후 <strong>저장</strong>하세요. 자동부여를 고르면 아래에서 기준을 선택합니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { v: "auto" as LeaveGrantMethod, label: "자동부여", desc: "근로기준법 공식으로 자동 산정 · 매일 자정 자동 발생" },
                    { v: "manual" as LeaveGrantMethod, label: "직접입력", desc: "직원별 연차를 수동으로 입력 (자동 발생 끔)" },
                  ]).map((opt) => {
                    const active = (pendingGrant ?? grantMethod) === opt.v;
                    return (
                      <button
                        key={opt.v}
                        onClick={() => setPendingGrant(opt.v)}
                        className={`flex-1 min-w-[200px] text-left px-4 py-3 rounded-xl border transition ${
                          active
                            ? "border-[var(--primary)] bg-[var(--primary)]/10"
                            : "border-[var(--border)] hover:border-[var(--primary)]/40"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${active ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--text-dim)]"}`} />
                          <span className="text-sm font-semibold">{opt.label}</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-dim)] mt-1 ml-[22px]">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>

                {/* 자동부여 선택 시에만 기준 선택 노출 — 시안: "선택시 기준 선택(입사일기준/회계연도기준)" */}
                {(pendingGrant ?? grantMethod) === "auto" && (
                  <div className="leave-accrual-basis">
                    <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">기준 선택</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(Object.keys(ACCRUAL_BASIS_LABELS) as MonthlyAccrualBasis[]).map((k) => {
                        const on = (pendingBasis ?? accrual.basis) === k;
                        return (
                          <button
                            key={k}
                            onClick={() => setPendingBasis(k)}
                            className={`leave-accrual-basis-opt ${on ? "leave-accrual-basis-opt-on" : ""}`}
                          >
                            <div className="text-xs font-bold">{ACCRUAL_BASIS_LABELS[k].label}</div>
                            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{ACCRUAL_BASIS_LABELS[k].desc}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <button
                        onClick={() => syncAccrualMut.mutate()}
                        disabled={syncAccrualMut.isPending}
                        className="btn-secondary btn-sm disabled:opacity-50"
                        title="누락된 과거 발생분을 지금 즉시 생성합니다"
                      >
                        {syncAccrualMut.isPending ? "반영 중..." : "지금 반영"}
                      </button>
                      <span className="text-[11px] text-[var(--text-dim)]">1년 미만 매월 1일(최대 11일) · 1주년부터 법정 연차가 매일 자정 자동 반영됩니다</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end mt-3">
                  <button
                    onClick={() => { setGrantEditing(false); setPendingGrant(null); setPendingBasis(null); }}
                    disabled={saveGrantCfgMut.isPending}
                    className="px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--border)] hover:bg-[var(--bg-surface)] transition disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => saveGrantCfgMut.mutate(
                      { method: pendingGrant ?? grantMethod, basis: pendingBasis ?? accrual.basis },
                      { onSuccess: () => { setGrantEditing(false); setPendingGrant(null); setPendingBasis(null); } },
                    )}
                    disabled={saveGrantCfgMut.isPending}
                    className="btn-primary btn-sm"
                  >
                    {saveGrantCfgMut.isPending ? "저장 중..." : "저장"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 반차 시간 — 회사별 설정 (2026-08-11 사장님). 비워두면 근무시간 절반으로 자동 산정 */}
        {!isEmployee && companyId && <HalfDaySlotSettings companyId={companyId} />}

      </>)}

      {leaveView === "promotion" && !isEmployee && (<>
          {/* Leave Promotion (연차촉진) Section */}
          {!isEmployee && (
            <div className="leave-promotion-section">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[var(--text-muted)]">연차촉진 관리</h3>
                <span className="inv-hint">근로기준법 §61 — 소멸 6개월 전 1차, 2개월 전 2차 통보. 통보는 사람이 누른다(출처: 규칙)</span>
              </div>

              {(
                <div className="space-y-4">
                  {/* Candidates */}
                  {promotionCandidates.length > 0 && (
                    <div className="glass-card overflow-hidden">
                      <div className="px-5 py-3 border-b border-[var(--border)] bg-yellow-500/5">
                        <span className="text-xs font-semibold text-[var(--warning)]">미사용 연차 보유 직원 ({promotionCandidates.length}명)</span>
                      </div>
                      <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
                        <thead className="sticky-bar"><tr className="table-head-row">
                          <th className="text-center px-5 py-2 font-medium">직원</th>
                          <th className="text-center px-5 py-2 font-medium">부서</th>
                          <th className="text-center px-5 py-2 font-medium">총 연차</th>
                          <th className="text-center px-5 py-2 font-medium">사용</th>
                          <th className="text-center px-5 py-2 font-medium">미사용</th>
                          <th className="text-center px-5 py-2 font-medium">촉진 통보</th>
                        </tr></thead>
                        <tbody>
                          {promotionCandidates.map((c: any) => (
                            <tr key={c.employeeId} className="border-b border-[var(--border)]/50">
                              <td className="px-5 py-2.5 text-sm font-medium">{c.employeeName}</td>
                              <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{c.department || "—"}</td>
                              <td className="px-5 py-2.5 text-sm text-center">{c.totalDays}일</td>
                              <td className="px-5 py-2.5 text-sm text-center">{c.usedDays}일</td>
                              <td className="px-5 py-2.5 text-sm text-center font-bold text-[var(--warning)]">{c.remainingDays}일</td>
                              <td className="px-5 py-2.5 text-center">
                                <div className="flex gap-1 justify-center">
                                  <button
                                    onClick={() => c.email && sendPromotion.mutate({
                                      employeeId: c.employeeId, noticeType: "first",
                                      unusedDays: c.remainingDays, email: c.email, employeeName: c.employeeName,
                                    })}
                                    disabled={!c.email || sendPromotion.isPending}
                                    className="text-[10px] px-2 py-1 rounded bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 disabled:opacity-50"
                                  >
                                    1차
                                  </button>
                                  <button
                                    onClick={() => c.email && sendPromotion.mutate({
                                      employeeId: c.employeeId, noticeType: "second",
                                      unusedDays: c.remainingDays, email: c.email, employeeName: c.employeeName,
                                    })}
                                    disabled={!c.email || sendPromotion.isPending}
                                    className="text-[10px] px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 disabled:opacity-50"
                                  >
                                    2차
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </div>
                  )}

                  {/* Sent notices history */}
                  {promotionNotices.length > 0 && (
                    <div className="glass-card overflow-hidden">
                      <div className="px-5 py-3 border-b border-[var(--border)]">
                        <span className="text-xs font-semibold text-[var(--text-muted)]">촉진 통보 이력</span>
                      </div>
                      <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[500px]">
                        <thead className="sticky-bar"><tr className="table-head-row">
                          <th className="text-center px-5 py-2 font-medium">직원</th>
                          <th className="text-center px-5 py-2 font-medium">차수</th>
                          <th className="text-center px-5 py-2 font-medium">미사용</th>
                          <th className="text-center px-5 py-2 font-medium">발송일</th>
                          <th className="text-center px-5 py-2 font-medium">기한</th>
                        </tr></thead>
                        <tbody>
                          {promotionNotices.map((n: any) => (
                            <tr key={n.id} className="border-b border-[var(--border)]/50">
                              <td className="px-5 py-2.5 text-sm">{n.employees?.name || "—"}</td>
                              <td className="px-5 py-2.5 text-center">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${n.notice_type === 'first' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
                                  {n.notice_type === "first" ? "1차" : "2차"}
                                </span>
                              </td>
                              <td className="px-5 py-2.5 text-sm text-center">{Number(n.unused_days)}일</td>
                              <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{n.sent_at ? kstDateStr(new Date(n.sent_at)) : "—"}</td>
                              <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{n.deadline || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </div>
                  )}

                  {promotionCandidates.length === 0 && (
                    <div className="glass-card p-8 text-center">
                      <div className="text-sm text-[var(--text-muted)]">모든 직원이 연차를 전부 사용했습니다</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
      </>)}

      {/* 휴가 캘린더 — 시안대로 팝업 (2026-08-06) */}
      {calendarOpen && (
        <div className="leave-modal-backdrop" onClick={() => setCalendarOpen(false)}>
          <div className="leave-modal leave-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="leave-modal-head">
              <h3 className="text-sm font-bold">휴가 캘린더</h3>
              <button onClick={() => setCalendarOpen(false)} className="leave-modal-close">✕</button>
            </div>
            <div className="leave-modal-body">
          <div className="leave-calendar">
            {/* 제목은 팝업 머리에 이미 있다 — 범례·월 선택만 남긴다 */}
            <div className="flex items-center justify-end mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                {/* 범례 — 연차/반차/기타휴가 색상 구분 */}
                <div className="flex items-center gap-2.5 text-[10px] text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />연차</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />반차</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />기타휴가</span>
                </div>
                <div className="attendance-month-nav">
                  <button
                    onClick={() => setCalMonth(shiftMonth(calMonth, -1))}
                    className="attendance-month-btn"
                    aria-label="이전 달"
                    title="이전 달"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
                  </button>
                  <MonthField
                    value={calMonth}
                    onChange={(e) => setCalMonth(e.target.value)}
                    className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm"
                  />
                  <button
                    onClick={() => setCalMonth(shiftMonth(calMonth, 1))}
                    className="attendance-month-btn"
                    aria-label="다음 달"
                    title="다음 달"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div className="glass-card overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-7 border-b border-[var(--border)]">
                {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                  <div
                    key={d}
                    className={`text-center text-xs font-medium py-2 ${
                      i === 0 ? "text-[var(--danger)]" : i === 6 ? "text-[var(--info)]" : "text-[var(--text-dim)]"
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7">
                {Array.from({ length: calFirstDow }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-[72px] border-b border-r border-[var(--border)]/30 bg-[var(--bg-surface)]/30" />
                ))}
                {Array.from({ length: calDaysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${calMonth}-${String(day).padStart(2, "0")}`;
                  const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                  const dow = (calFirstDow + i) % 7;
                  const isWeekend = dow === 0 || dow === 6;
                  const onLeave = leaveCalendar[dateStr] || [];

                  return (
                    <div
                      key={day}
                      className={`min-h-[72px] border-b border-r border-[var(--border)]/30 p-1.5 ${
                        isToday ? "bg-[var(--primary)]/5" : isWeekend ? "bg-[var(--bg-surface)]/30" : ""
                      }`}
                    >
                      <div className={`text-xs font-medium mb-1 ${
                        isToday ? "text-[var(--primary)] font-bold" : dow === 0 ? "text-[var(--danger)]" : dow === 6 ? "text-[var(--info)]" : "text-[var(--text-muted)]"
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {onLeave.slice(0, 3).map((l, idx) => {
                          const chipCls = l.bucket === "annual"
                            ? "bg-purple-500/10 text-purple-400"
                            : l.bucket === "half"
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-blue-500/10 text-blue-400";
                          return (
                            <div
                              key={idx}
                              className={`text-[9px] px-1 py-0.5 rounded truncate ${chipCls}`}
                              title={`${l.name} — ${l.type}${l.bucket === "half" ? " (반차)" : ""}`}
                            >
                              {l.name}{l.bucket !== "annual" && <span className="opacity-70"> · {l.bucket === "half" ? "반차" : l.type}</span>}
                            </div>
                          );
                        })}
                        {onLeave.length > 3 && (
                          <div className="text-[9px] text-[var(--text-dim)]">+{onLeave.length - 3}명</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

            </div>
          </div>
        </div>
      )}

      {/* 이름 클릭 — 그 구성원의 전체 연차 신청 내역. 관리자는 여기서 바로 휴가를 등록할 수 있다. */}
      {rosterEmp && (
        <div className="leave-modal-backdrop" onClick={() => setRosterEmp(null)}>
          <div className="leave-modal" onClick={(e) => e.stopPropagation()}>
            <div className="leave-modal-head">
              <h3 className="text-sm font-bold">{rosterEmp.name} · 연차 신청 내역</h3>
              <button onClick={() => { setRosterEmp(null); setQuickOpen(false); resetQuick(); }} className="leave-modal-close">✕</button>
            </div>
            <div className="leave-modal-body">
              {!isEmployee && (
                quickOpen ? (
                  <div className="leave-quick-form">
                    <div className="text-xs font-bold mb-2">{rosterEmp.name} 휴가 등록</div>
                    <div className="leave-quick-grid">
                      <label className="leave-quick-field">
                        <span className="leave-quick-label">유형</span>
                        <select value={quick.leaveType} onChange={(e) => setQuick((q) => ({ ...q, leaveType: e.target.value }))} className="field-input">
                          {companyLeaveTypes.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                        </select>
                      </label>
                      <label className="leave-quick-field">
                        <span className="leave-quick-label">단위</span>
                        <select value={quick.leaveUnit} onChange={(e) => setQuick((q) => ({ ...q, leaveUnit: e.target.value }))} className="field-input">
                          {LEAVE_UNITS.map((u) => (<option key={u.value} value={u.value}>{u.label}</option>))}
                        </select>
                      </label>
                      {quick.leaveUnit === "half_day" && (
                        <label className="leave-quick-field">
                          <span className="leave-quick-label">오전/오후</span>
                          <select value={quick.halfDayPeriod} onChange={(e) => setQuick((q) => ({ ...q, halfDayPeriod: e.target.value as "am" | "pm" }))} className="field-input">
                            <option value="am">오전</option>
                            <option value="pm">오후</option>
                          </select>
                        </label>
                      )}
                      <label className="leave-quick-field">
                        <span className="leave-quick-label">시작일</span>
                        <DateField value={quick.startDate} onChange={(e) => setQuick((q) => ({ ...q, startDate: e.target.value }))} className="field-input" />
                      </label>
                      {quick.leaveUnit === "full_day" && (
                        <label className="leave-quick-field">
                          <span className="leave-quick-label">종료일 <span className="text-[var(--text-dim)] font-normal">(하루면 비워두세요)</span></span>
                          <DateField value={quick.endDate} onChange={(e) => setQuick((q) => ({ ...q, endDate: e.target.value }))} className="field-input" />
                        </label>
                      )}
                      <label className="leave-quick-field leave-quick-wide">
                        <span className="leave-quick-label">사유 <span className="text-[var(--text-dim)] font-normal">(선택)</span></span>
                        <input value={quick.reason} onChange={(e) => setQuick((q) => ({ ...q, reason: e.target.value }))} placeholder="예: 개인 사정" className="field-input" />
                      </label>
                    </div>
                    <div className="leave-quick-actions">
                      <span className="text-[11px] text-[var(--text-dim)]">{quickDays > 0 ? `${quickDays}일 차감` : "시작일을 선택하세요"}</span>
                      <div className="flex gap-2 ml-auto">
                        <button onClick={() => { setQuickOpen(false); resetQuick(); }} disabled={createQuickLeave.isPending} className="leave-quick-cancel">취소</button>
                        <button
                          onClick={() => createQuickLeave.mutate()}
                          disabled={!quick.startDate || createQuickLeave.isPending}
                          className="btn-primary btn-sm disabled:opacity-40"
                        >
                          {createQuickLeave.isPending ? "등록 중..." : "등록"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setQuickOpen(true)} className="btn-primary btn-sm mb-3">
                    이 구성원 휴가 등록
                  </button>
                )
              )}
              {rosterEmpRequests.length === 0 ? (
                <div className="templates-empty">신청 내역이 없습니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {rosterEmpRequests.map((r: any) => (
                    <div key={r.id} className="leave-modal-row">
                      <div>
                        <div className="text-xs font-semibold">{leaveTypeLabel(r.leave_type)} · {r.days}일</div>
                        <div className="caption">
                          {r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold">
                        {LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS]?.label || r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 월 셀 클릭 — 그 달 사용 날짜·승인 내역 */}
      {rosterMonth && (
        <div className="leave-modal-backdrop" onClick={() => setRosterMonth(null)}>
          <div className="leave-modal" onClick={(e) => e.stopPropagation()}>
            <div className="leave-modal-head">
              <h3 className="text-sm font-bold">{rosterMonth.name} · {currentYear}년 {rosterMonth.month + 1}월 사용 내역</h3>
              <button onClick={() => setRosterMonth(null)} className="leave-modal-close">✕</button>
            </div>
            <div className="leave-modal-body">
              {rosterMonthRequests.length === 0 ? (
                <div className="templates-empty">이 달 사용 내역이 없습니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {rosterMonthRequests.map((r: any) => (
                    <div key={r.id} className="leave-modal-row">
                      <div>
                        <div className="text-xs font-semibold">
                          {r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""} · {r.days}일
                        </div>
                        <div className="caption">{leaveTypeLabel(r.leave_type)}</div>
                      </div>
                      <span className="text-[11px] font-semibold text-[var(--success)]">
                        {r.approved_at ? `${kstDateStr(new Date(r.approved_at))} 승인` : "승인"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Certificate Tab ──
function CertificateTab({ employees, companyId, userId, queryClient }: any) {
  const { toast } = useToast();
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [certType, setCertType] = useState<"employment" | "career">("employment");
  const [purpose, setPurpose] = useState("");
  const [submitTo, setSubmitTo] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  //   회사 도장 출력 여부 (2026-08-26 사장님: 실물 출력해 직접 날인할 땐 도장 없이 발급). 기본 켬.
  const [includeSeal, setIncludeSeal] = useState(true);

  const db = supabase;

  // Certificate logs query
  const { data: certLogs = [] } = useQuery({
    queryKey: ["certificate-logs", companyId],
    queryFn: () => getCertificateLogs(companyId),
    enabled: !!companyId,
  });

  // Company info query
  const { data: companyInfo } = useQuery({
    queryKey: ["company-info", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await db.from("companies").select("*").eq("id", companyId).maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const activeEmployees = employees.filter((e: any) => ["active", "joined"].includes(e.status));
  const allEmployees = employees;

  const CERT_TYPES = [
    { value: "employment", label: "재직증명서" },
    { value: "career", label: "경력증명서" },
  ];

  const handleIssue = async () => {
    if (!selectedEmpId || !companyId || !userId) return;

    const employee = allEmployees.find((e: any) => e.id === selectedEmpId);
    if (!employee) return;

    setIsGenerating(true);
    try {
      const empData = {
        name: employee.name,
        department: employee.department,
        position: employee.position,
        hire_date: employee.hire_date || todayKst(),
        end_date: !["active", "joined"].includes(employee.status) ? employee.updated_at?.slice(0, 10) : undefined,
        employee_number: employee.employee_number,
        birth_date: employee.birth_date,
      };

      const companyData = {
        name: companyInfo?.name || "",
        representative: companyInfo?.representative ?? undefined,
        address: companyInfo?.address ?? undefined,
        business_number: companyInfo?.business_number ?? undefined,
        seal_url: companyInfo?.seal_url ?? undefined,
      };

      let result;
      if (certType === "employment") {
        result = await generateEmploymentCertificate({
          employee: empData,
          company: companyData,
          purpose: purpose || undefined,
          submitTo: submitTo || undefined,
          includeSeal,
        });
      } else {
        //   H10 (2026-08-27) — 발령 이력에서 소속·직위 변천을 자동으로 싣는다
        const appts = await listAppointments(companyId, selectedEmpId).catch(() => []);
        result = await generateCareerCertificate({
          employee: empData,
          company: companyData,
          purpose: purpose || undefined,
          submitTo: submitTo || undefined,
          includeSeal,
          history: appointmentLines(appts),
        });
      }

      // Download the PDF
      const url = URL.createObjectURL(result.pdf);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${certType === "employment" ? "재직증명서" : "경력증명서"}_${employee.name}_${result.certificateNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      // Save log
      await saveCertificateLog({
        companyId,
        employeeId: selectedEmpId,
        certificateType: certType === "employment" ? "재직증명서" : "경력증명서",
        certificateNumber: result.certificateNumber,
        issuedBy: userId,
        purpose: purpose || undefined,
        submitTo: submitTo || undefined,
      });

      queryClient.invalidateQueries({ queryKey: ["certificate-logs"] });
      setPurpose("");
      setSubmitTo("");
      toast(`증명서가 발급되었습니다.\n증명서번호: ${result.certificateNumber}`, "success");
    } catch (err: any) {
      toast("증명서 발급 실패: " + (err?.message || err), "error");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div>
      {/* Issue Form — 실제 증명서 발급(최상단, 2026-06-29 순서 조정) */}
      <div className="certificate-issue-form glass-card">
        <h3 className="section-title">증명서 발급</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">직원 선택 *</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="field-input"
            >
              <option value="">직원을 선택하세요</option>
              {allEmployees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.department || "미배정"}) {!["active", "joined"].includes(e.status) ? "[퇴직]" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">증명서 유형 *</label>
            <select
              value={certType}
              onChange={(e) => setCertType(e.target.value as "employment" | "career")}
              className="field-input"
            >
              {CERT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <CertChoiceField label="용도" options={CERT_PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} />
          <CertChoiceField label="제출처" options={CERT_SUBMIT_TO_OPTIONS} value={submitTo} onChange={setSubmitTo} />
          {/* 회사 도장 출력 선택 (2026-08-26 사장님: 실물 출력해 직접 날인할 땐 도장 없이) */}
          <div className="flex items-end">
            <label className="flex items-center gap-2 py-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
              <input type="checkbox" checked={includeSeal} onChange={(e) => setIncludeSeal(e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
              <span>회사 도장 출력</span>
              <span className="text-[10px] text-[var(--text-dim)]">(실물 날인 시 해제)</span>
            </label>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleIssue}
              disabled={!selectedEmpId || isGenerating}
              className="w-full btn-primary"
            >
              {isGenerating ? "발급 중..." : "발급"}
            </button>
          </div>
        </div>
      </div>

      {/* Certificate Logs */}
      <div className="certificate-log-table glass-card">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-muted)]">발급 이력</span>
        </div>
        {certLogs.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4"><Ico e="📜" /></div>
            <div className="text-sm text-[var(--text-muted)]">발급된 증명서가 없습니다</div>
            <div className="text-xs text-[var(--text-dim)] mt-1">직원을 선택하고 증명서를 발급하세요</div>
          </div>
        ) : (
          <div className="ev-scroll leave-req-scroll"><table className="ev-table ev-lined cert-log-tbl">
            <thead>
              <tr>
                <th>증명서번호</th>
                <th>유형</th>
                <th>직원</th>
                <th>소속/직위</th>
                <th>용도</th>
                <th>발급자</th>
                <th>발급일</th>
              </tr>
            </thead>
            <tbody>
              {certLogs.map((log: any) => (
                <tr key={log.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-xs font-mono text-[var(--primary)]">{log.certificate_number}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      log.certificate_type === "재직증명서"
                        ? "bg-[var(--info)]/10 text-[var(--info)]"
                        : "bg-purple-500/10 text-purple-400"
                    }`}>
                      {log.certificate_type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm font-medium">{log.employees?.name || "--"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                    {log.employees?.department || "--"} / {log.employees?.position || "--"}
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{log.purpose || "--"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{log.issuer?.name || log.issuer?.email || "--"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                    {log.created_at ? kstDateStr(new Date(log.created_at)) : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* 연말정산 간소화 자료 수집 — 증명서 발급/이력 아래로 이동(2026-06-29) */}
      <div className="mt-6">
        <YearEndTaxSection employees={activeEmployees} companyId={companyId} />
      </div>
    </div>
  );
}

// ── 연말정산 간소화 자료 수집 ──
function YearEndTaxSection({ employees, companyId }: { employees: any[]; companyId: string | null }) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  //   G6 (2026-08-27 인사 6차) — 제출 상태를 localStorage(브라우저마다 달랐다) 대신 year_end_tax_status 표에. 담당자 둘이 봐도 같다.
  type Status = "pending" | "submitted" | "reviewed";
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (supabase as any).from("year_end_tax_status").select("employee_id, status").eq("company_id", companyId).eq("year", year)
      .then(({ data }: { data: { employee_id: string; status: Status }[] | null }) => { if (!alive) return; const m: Record<string, Status> = {}; for (const r of (data || [])) m[r.employee_id] = r.status; setStatuses(m); });
    return () => { alive = false; };
  }, [companyId, year]);

  const setStatus = async (id: string, s: Status) => {
    setStatuses((prev) => ({ ...prev, [id]: s }));
    if (!companyId) return;
    const { error } = await (supabase as any).from("year_end_tax_status").upsert({ company_id: companyId, employee_id: id, year, status: s, updated_at: new Date().toISOString() }, { onConflict: "company_id,employee_id,year" });
    if (error) toast(friendlyError(error, "상태를 저장하지 못했습니다"), "error");
  };

  const counts = useMemo(() => {
    const c = { pending: 0, submitted: 0, reviewed: 0 };
    employees.forEach((e: any) => {
      const s = statuses[e.id] || "pending";
      c[s] += 1;
    });
    return c;
  }, [employees, statuses]);

  const total = employees.length || 1;
  const completedPct = Math.round(((counts.submitted + counts.reviewed) / total) * 100);

  const sendReminderToAll = () => {
    const subject = encodeURIComponent(`[연말정산] ${year}년 간소화 자료 제출 안내`);
    const body = encodeURIComponent(
      `안녕하세요.\n\n${year}년 연말정산 간소화 자료 제출 기간입니다.\n\n` +
      `1) 홈택스 (https://www.hometax.go.kr) 접속 → 장려금·연말정산·전자기부금 → 연말정산 간소화\n` +
      `2) 본인 인증 후 PDF 일괄 다운로드\n` +
      `3) 부양가족 자료가 있는 경우 별도 동의 후 추가 다운로드\n` +
      `4) 의료비/기부금/월세 등 별도 영수증이 있다면 함께 첨부\n\n` +
      `회신: 회사 메일로 PDF 첨부 후 회신 부탁드립니다.\n\n감사합니다.`
    );
    const emails = employees.map((e: any) => e.email).filter(Boolean).join(",");
    if (!emails) {
      toast("등록된 이메일이 있는 직원이 없습니다", "error");
      return;
    }
    window.location.href = `mailto:${emails}?subject=${subject}&body=${body}`;
  };

  const STATUS_META: Record<Status, { label: string; bg: string; text: string }> = {
    pending: { label: "미제출", bg: "bg-[var(--danger)]/10", text: "text-[var(--danger)]" },
    submitted: { label: "제출완료", bg: "bg-[var(--info)]/10", text: "text-[var(--info)]" },
    reviewed: { label: "검토완료", bg: "bg-[var(--success)]/10", text: "text-[var(--success)]" },
  };

  return (
    <div className="certificate-yeartax-panel glass-card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Ico e="🧾" /> 연말정산 간소화 자료 수집
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">{year}년</span>
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">홈택스 간소화 자료 제출 현황을 직원별로 추적합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => <option key={y} value={y}>{y}년 귀속</option>)}
          </select>
          <a href="https://www.hometax.go.kr" target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm no-underline">
            홈택스 열기 ↗
          </a>
          <button onClick={sendReminderToAll} className="btn-secondary btn-sm">
            전체 안내 발송
          </button>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="yeartax-progress-bar">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-[var(--text-muted)]">제출 진행률</span>
          <span className="font-bold">{counts.submitted + counts.reviewed} / {employees.length}명 ({completedPct}%)</span>
        </div>
        <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden flex">
          <div className="bg-[var(--info)]" style={{ width: `${(counts.submitted / total) * 100}%` }} />
          <div className="bg-[var(--success)]" style={{ width: `${(counts.reviewed / total) * 100}%` }} />
        </div>
        <div className="flex gap-4 mt-2 text-[10px]">
          <span className="text-[var(--danger)]">미제출 {counts.pending}명</span>
          <span className="text-[var(--info)]">제출완료 {counts.submitted}명</span>
          <span className="text-[var(--success)]">검토완료 {counts.reviewed}명</span>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="text-center py-8 text-xs text-[var(--text-dim)]">재직 중인 직원이 없습니다</div>
      ) : (
        <div className="yeartax-status-table">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-center px-3 py-2 font-medium">직원</th>
                <th className="text-center px-3 py-2 font-medium">이메일</th>
                <th className="text-center px-3 py-2 font-medium">상태</th>
                <th className="text-center px-3 py-2 font-medium">상태 변경</th>
              </tr>
            </thead>
            <tbody>
              {[...employees].sort(comparePeople).map((e: any) => {
                const s = statuses[e.id] || "pending";
                const meta = STATUS_META[s];
                return (
                  <tr key={e.id} className="border-b border-[var(--border)]/50">
                    <td className="px-3 py-2 text-sm">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-[10px] text-[var(--text-dim)] ml-2">{e.department || ""}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{e.email || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {(["pending", "submitted", "reviewed"] as Status[]).map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setStatus(e.id, opt)}
                            className={`text-[10px] px-2 py-1 rounded-md transition ${s === opt ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg)]"}`}
                          >
                            {STATUS_META[opt].label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]/50">
        <div className="text-[10px] font-semibold text-[var(--text-muted)] mb-1.5"><Ico e="📌" /> 안내</div>
        <ul className="text-[11px] text-[var(--text-muted)] leading-relaxed space-y-0.5">
          <li>• 홈택스 일정: 매년 1월 15일부터 간소화 자료 일괄제공</li>
          <li>• 부양가족 자료는 부양가족 본인이 자료제공 동의 후 조회 가능</li>
          <li>• 의료비/기부금/월세 등은 간소화에 누락될 수 있어 별도 영수증 수집 권장</li>
        </ul>
      </div>
    </div>
  );
}

// ── 반차 시간 회사 설정 (2026-08-11 사장님 — 구성원 > 휴가 > 설정) ──
//   오전/오후 반차의 시간 구간을 회사 규정대로 지정. 비워두면 기존처럼 근무시간 절반 자동 산정.
//   저장처: company_settings.settings.half_day_slots — 이후 반차 "신청"부터 적용(기존 신청 시간 불변).
function HalfDaySlotSettings({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState({ amStart: "", amEnd: "", pmStart: "", pmEnd: "" });

  const { data: slots = {} } = useQuery({
    queryKey: ["half-day-slots", companyId],
    queryFn: () => getHalfDaySlots(companyId),
    enabled: !!companyId,
    staleTime: 300_000,
  });

  const startEdit = () => {
    setVals({
      amStart: (slots as any)?.am?.start || "",
      amEnd: (slots as any)?.am?.end || "",
      pmStart: (slots as any)?.pm?.start || "",
      pmEnd: (slots as any)?.pm?.end || "",
    });
    setEditing(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const pair = (st: string, en: string) => (st && en ? (st < en ? { start: st, end: en } : (() => { throw new Error("시작 시각이 끝 시각보다 빨라야 합니다"); })()) : undefined);
      await setHalfDaySlots(companyId, { am: pair(vals.amStart, vals.amEnd), pm: pair(vals.pmStart, vals.pmEnd) });
    },
    onSuccess: () => {
      toast("반차 시간이 저장되었습니다. 이후 반차 신청부터 적용됩니다.", "success");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["half-day-slots", companyId] });
    },
    onError: (e: any) => toast(e?.message || "저장 실패", "error"),
  });

  const fmt = (v?: { start: string; end: string }) => (v?.start && v?.end ? `${v.start}~${v.end}` : "자동(근무시간 절반)");

  return (
    <div className="leave-halfday-panel glass-card">
      {!editing ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-[var(--text-muted)]">
            <b className="text-[var(--text)]">반차 시간</b>
            <span className="ml-2">오전 {fmt((slots as any)?.am)} · 오후 {fmt((slots as any)?.pm)}</span>
          </div>
          <button onClick={startEdit} className="btn-secondary btn-sm">변경</button>
        </div>
      ) : (
        <div>
          <div className="text-xs font-bold text-[var(--text)] mb-1">반차 시간 설정</div>
          <p className="text-[11px] text-[var(--text-dim)] mb-3">회사 규정의 반차 시간대를 지정하세요. 비워두면 근무시간의 절반으로 자동 계산됩니다. 이미 승인된 반차의 시간은 바뀌지 않습니다.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([["am", "오전 반차", "amStart", "amEnd"], ["pm", "오후 반차", "pmStart", "pmEnd"]] as const).map(([, label, ks, ke]) => (
              <div key={ks} className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-dim)] w-14 shrink-0">{label}</span>
                <input type="time" value={vals[ks]} onChange={(e) => setVals((v) => ({ ...v, [ks]: e.target.value }))} className="field-input flex-1" />
                <span className="text-[var(--text-dim)]">~</span>
                <input type="time" value={vals[ke]} onChange={(e) => setVals((v) => ({ ...v, [ke]: e.target.value }))} className="field-input flex-1" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 justify-end">
            <button onClick={() => setEditing(false)} disabled={saveMut.isPending} className="btn-secondary btn-sm">취소</button>
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="btn-primary btn-sm">{saveMut.isPending ? "저장 중..." : "저장"}</button>
          </div>
        </div>
      )}
    </div>
  );
}


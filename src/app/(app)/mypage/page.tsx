"use client";
import { logRead } from "@/lib/log-read";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, clearCurrentUserCache } from "@/lib/queries";
import { getCompanyLeaveTypes, defaultCompanyLeaveTypes } from "@/lib/leave-grants";
import { useUser } from "@/components/user-context";
import { Avatar } from "@/components/avatar";
import { QueryScreen, QueryHead, QueryBody, ResultStrip, Stat } from "@/components/query-kit";
import Link from "next/link";
import { getMyPendingApprovals } from "@/lib/approval-workflow";
import { getScheduleItems } from "@/lib/schedule";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
// 개인 계정 영역 — 회사 설정에서 마이페이지로 이관(2026-07-08). 컴포넌트 위치는 유지, 마운트만 옮김.
import { AccountTab } from "../settings/_components/AccountTab";
import { NotificationsTab } from "../settings/_components/NotificationsTab";
// 개인 인사기록 허브(2026-07-15) — 근로계약서/급여명세/증명서를 마이페이지로 이관.
import { MyContractsCard } from "./_components/MyContractsCard";
import { MyPayslips } from "./_components/MyPayslips";
// 내 근태(2026-07-20) — 인사관리>근태관리는 전 직원, 여기는 본인 출퇴근만.
import { MyAttendance } from "./_components/MyAttendance";
import { MyAttendanceCard } from "@/components/my-attendance-card";
import { listLeaveGrants, GRANT_TYPE_LABELS } from "@/lib/leave-grants";

const EMP_STATUS: Record<string, { label: string; color: string }> = {
  invited: { label: "초대중", color: "text-[var(--warning)]" },
  joined: { label: "가입완료", color: "text-[var(--info)]" },
  active: { label: "재직", color: "text-[var(--success)]" },
  inactive: { label: "퇴직", color: "text-[var(--text-muted)]" },
};

// 회사 설정에 없는 레거시 유형(경조휴가·무급휴가)까지 덮는 폴백 표기
const LEAVE_TYPE_LABELS: Record<string, string> = { annual: "연차", sick: "병가", special: "경조휴가", unpaid: "무급휴가" };
// 연차 원장 표기 — 'YYYY-MM-DD' → 'M월 D일'
// ⚠️ 날짜가 결재 custom_fields(jsonb)에서도 와서 문자열이 아닐 수 있다 — 숫자가 오면 .slice 에서
//   마이페이지 전체가 죽었다(2026-08-19 에러로그 3건). 어떤 값이 와도 크래시하지 않게 방어.
const fmtLedgerDate = (d?: string | number | null) => {
  const s = d == null ? "" : String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일` : (s || "—");
};

//   2026-08-19 재편(docs/20260819_PLAN_mypage_redesign.md): 내 현황 · 근태 · 휴가·연차 · 급여·계약·증명 · 내 정보·설정
type MyPageTab = "home" | "attendance" | "leave" | "docs" | "me";
const TAB_FROM_QUERY: Record<string, MyPageTab> = { records: "docs", notif: "me", account: "me", home: "home", attendance: "attendance", leave: "leave", docs: "docs", me: "me" };

export default function MyPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<MyPageTab>(() => { if (typeof window === "undefined") return "home"; const t = new URLSearchParams(window.location.search).get("tab") || ""; return TAB_FROM_QUERY[t] || "home"; });
  // 연봉 기본 가림 (2026-08-19 사장님: 급여가 화면에 바로 보이면 안 됨) — 눌러야 표시.
  const [showSalary, setShowSalary] = useState(false);
  const { role, user: ctxUser, refresh } = useUser();
  // 휴가 유형 이름은 회사 설정을 따른다 — 구성원 > 휴가 탭에서 바꾸면 직원 화면도 같이 바뀐다.
  //   queryKey 는 휴가 탭과 동일해 캐시를 공유한다. (2026-08-06)
  const { data: companyLeaveTypes = defaultCompanyLeaveTypes() } = useQuery({
    queryKey: ["company-leave-types", companyId],
    queryFn: () => getCompanyLeaveTypes(companyId!),
    enabled: !!companyId,
  });
  const leaveTypeLabel = useCallback(
    (t: string) => companyLeaveTypes.find((x) => x.value === t)?.label || LEAVE_TYPE_LABELS[t] || t,
    [companyLeaveTypes],
  );
  // 회원 탈퇴
  const [withdrawText, setWithdrawText] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);

  const handleWithdraw = async () => {
    if (withdrawText.trim() !== "탈퇴" || withdrawing) return;
    setWithdrawing(true);
    setWithdrawErr(null);
    try {
      const res = await fetch("/api/delete-account", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "탈퇴 처리 실패");
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      window.location.href = "/auth";
    } catch (e: any) {
      setWithdrawErr(e?.message || "탈퇴 처리 중 오류가 발생했습니다.");
      setWithdrawing(false);
    }
  };

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  const { data: userInfo } = useQuery({
    queryKey: ["my-user-info", userId],
    queryFn: async () => {
      const data = logRead('mypage/page:data', await supabase.from("users").select("name, email, role, avatar_url").eq("id", userId!).maybeSingle());
      return data;
    },
    enabled: !!userId,
  });

  // 프로필 사진 업로드/제거
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const refreshAvatar = () => {
    // 프로필 사진은 여러 화면(대시보드·채팅·게시판·팀·결재 등)이 각자 users 조인으로 표시 →
    //   한 곳만 무효화하면 다른 곳이 옛 사진으로 남음. getCurrentUser 메모이즈 캐시까지 비우고
    //   전체 쿼리를 무효화해 어디서든 새 사진이 즉시 반영되게 한다.
    clearCurrentUserCache();
    refresh();
    qc.invalidateQueries();
  };
  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) { toast("이미지 파일만 업로드할 수 있습니다", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { toast("5MB 이하 이미지만 업로드할 수 있습니다", "error"); return; }
    if (!companyId) { toast("회사 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "error"); return; }
    setUploadingAvatar(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      // company-assets 버킷 RLS: 첫 폴더 = 회사ID 여야 업로드 허용. (avatars/ 로 시작하면 거부됨)
      const path = `${companyId}/avatars/${userId}-${Date.now()}.${ext}`;
      const prevAvatarPath = (() => {
        const m = String((userInfo as any)?.avatar_url || "").match(/\/object\/(?:public|sign|authenticated)\/company-assets\/([^?]+)/);
        return m ? decodeURIComponent(m[1]) : null;
      })();
      const { error: upErr } = await supabase.storage.from("company-assets").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from("company-assets").getPublicUrl(path);
      const { error: updErr } = await supabase.from("users").update({ avatar_url: urlData.publicUrl }).eq("id", userId);
      if (updErr) {
        await supabase.storage.from("company-assets").remove([path]).catch(() => {});   // 고아 방지
        throw new Error(updErr.message);
      }
      // 예전 사진 정리 (2026-08-20 감사): 경로에 Date.now() 가 들어가 바꿀 때마다 한 장씩
      //   영구히 쌓였다. 교체가 확정된 다음에 지운다.
      if (prevAvatarPath && prevAvatarPath !== path) {
        await supabase.storage.from("company-assets").remove([prevAvatarPath]).catch(() => {});
      }
      toast("프로필 사진이 변경되었습니다", "success");
      refreshAvatar();
    } catch (err: any) {
      toast(`업로드 실패: ${err?.message || ""}`, "error");
    } finally { setUploadingAvatar(false); }
  };
  const handleAvatarRemove = async () => {
    if (!userId) return;
    setUploadingAvatar(true);
    try {
      const { error } = await supabase.from("users").update({ avatar_url: null }).eq("id", userId);
      if (error) throw new Error(error.message);
      toast("기본 이미지로 변경되었습니다", "success");
      refreshAvatar();
    } catch (err: any) {
      toast(`변경 실패: ${err?.message || ""}`, "error");
    } finally { setUploadingAvatar(false); }
  };

  const { data: employee } = useQuery({
    queryKey: ["my-employee-info", companyId, userId],
    queryFn: async () => {
      if (!userInfo?.email) return null;
      // 계정 연결(user_id) 우선, 이메일은 폴백 — 서버 current_employee_id() 와 같은 순서 (2026-08-13).
      //   종전엔 이메일 완전일치뿐이라, 인사기록 이메일이 계정 이메일과 다르면 연결이 걸려 있어도
      //   마이페이지(근태·계약·급여명세)가 통째로 비었다.
      if (userId) {
        const byLink = logRead('mypage/page:byLink', await supabase
          .from("employees").select("*")
          .eq("company_id", companyId!).eq("user_id", userId).maybeSingle());
        if (byLink) return byLink;
      }
      const data = logRead('mypage/page:data', await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId!)
        .eq("email", userInfo.email)
        .maybeSingle());
      return data;
    },
    enabled: !!companyId && !!userInfo?.email,
  });

  const { data: company } = useQuery({
    queryKey: ["my-company-info", companyId],
    queryFn: async () => {
      const data = logRead('mypage/page:data', await supabase.from("companies").select("name").eq("id", companyId!).maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const currentYear = new Date().getFullYear();
  const { data: leaveBalance } = useQuery({
    queryKey: ["my-leave-balance-page", employee?.id, currentYear],
    queryFn: async () => {
      const data = logRead('mypage/page:data', await supabase
        .from("leave_balances")
        .select("total_days, used_days, remaining_days, year")
        .eq("employee_id", employee!.id)
        .eq("year", currentYear)
        .maybeSingle());
      return data;
    },
    enabled: !!employee?.id,
  });

  // 연차 원장(사용 내역) — 연차 현황의 "사용" 타일 클릭 시 열린다.
  //   발생(부여) → 사용 건별 차감 → 잔여를 순서대로 누적 표시. 연도 전환으로 전년도 이전 기록도 조회.
  const [showUsedLeaves, setShowUsedLeaves] = useState(false);
  const [ledgerYear, setLedgerYear] = useState(currentYear);

  // 연도 목록 — 이 직원에게 연차가 부여된 모든 해(전년도 이월 확인용)
  const { data: allBalances = [] } = useQuery({
    queryKey: ["my-leave-balances-all", employee?.id],
    queryFn: async () => {
      const data = logRead('mypage/page:data', await supabase
        .from("leave_balances")
        .select("year, total_days, used_days, remaining_days")
        .eq("employee_id", employee!.id)
        .order("year", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!employee?.id && showUsedLeaves,
  });
  const ledgerBalance = allBalances.find((b: any) => Number(b.year) === ledgerYear) || null;

  // 발생 이력 — 입사일 기준 부여·월 발생·이월·조정을 날짜별로. (leave_grants, 2026-07-20 신설)
  const { data: grants = [] } = useQuery({
    queryKey: ["my-leave-grants", employee?.id, ledgerYear],
    queryFn: () => listLeaveGrants(employee!.id, ledgerYear),
    enabled: !!employee?.id && showUsedLeaves,
  });

  const { data: usedLeaves = [], isLoading: usedLeavesLoading } = useQuery({
    queryKey: ["my-used-leaves", employee?.id, userId, ledgerYear],
    queryFn: async () => {
      const db = supabase;
      const [{ data: native }, { data: approvals }] = await Promise.all([
        db.from("leave_requests")
          .select("id, leave_type, start_date, end_date, days, status")
          .eq("employee_id", employee!.id)
          .eq("status", "approved")
          .gte("start_date", `${ledgerYear}-01-01`)
          .lte("start_date", `${ledgerYear}-12-31`)
          .order("start_date", { ascending: true }),
        db.from("approval_requests")
          .select("id, status, created_at, custom_fields, description")
          .eq("request_type", "leave")
          .eq("requester_id", userId!)
          .eq("status", "approved")
          .order("created_at", { ascending: true }),
      ]);
      const fromApprovals = (approvals || [])
        .map((a: any) => {
          const lv = a.custom_fields?.leave || {};
          const start = lv.start_date || a.created_at?.slice(0, 10);
          return {
            id: `approval-${a.id}`,
            leave_type: lv.leave_type || "annual",
            start_date: start,
            end_date: lv.end_date || start,
            // 구버전 요청은 구조화 필드가 없어 본문에서 일수를 파싱(승인 차감 로직과 동일 규칙).
            days: Number(lv.days ?? a.description?.match(/(\d+(?:\.\d+)?)일/)?.[1] ?? 0),
          };
        })
        .filter((l: any) => l.start_date?.startsWith(String(ledgerYear)));
      // 발생 → 사용 순으로 읽도록 날짜 오름차순.
      return [...(native || []), ...fromApprovals].sort((x: any, y: any) =>
        (x.start_date || "").localeCompare(y.start_date || ""),
      );
    },
    enabled: !!employee?.id && !!userId && showUsedLeaves,
  });
  const usedLeavesTotal = usedLeaves.reduce((sum: number, l: any) => sum + (Number(l.days) || 0), 0);
  const ledgerGranted = Number(ledgerBalance?.total_days ?? 0);

  // 원장 = 발생(+) · 사용(−) 을 날짜순으로 합쳐 잔여를 누적. 발생 이력이 없는 과거 연도는
  //   leave_balances 합계만으로 1월 1일 부여 1건이 있었던 것으로 본다(백필 이전 데이터 방어).
  const grantEntries = grants.length > 0
    ? grants.map((g) => ({
        id: `grant-${g.id}`, kind: "grant" as const, date: g.grant_date,
        label: GRANT_TYPE_LABELS[g.grant_type] || "발생", days: Number(g.days) || 0, memo: g.memo,
      }))
    : ledgerBalance
      ? [{ id: "grant-legacy", kind: "grant" as const, date: `${ledgerYear}-01-01`, label: "연차 부여", days: ledgerGranted, memo: null }]
      : [];
  const useEntries = usedLeaves.map((l: any) => ({
    id: l.id, kind: "use" as const, date: l.start_date, label: leaveTypeLabel(l.leave_type),
    days: Number(l.days) || 0, endDate: l.end_date as string | undefined,
  }));
  let runningRemain = 0;
  const ledgerRows = [...grantEntries, ...useEntries]
    // 같은 날이면 발생이 먼저(부여 후 사용).
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.kind === "grant" ? -1 : 1))
    .map((e) => {
      runningRemain = Math.round((runningRemain + (e.kind === "grant" ? e.days : -e.days)) * 10) / 10;
      return { ...e, remain: runningRemain };
    });
  const balanceRemain = ledgerBalance ? Number(ledgerBalance.remaining_days ?? ledgerGranted - Number(ledgerBalance.used_days)) : null;
  const ledgerMismatch = balanceRemain !== null && Math.abs(balanceRemain - runningRemain) > 0.05;

  // 최근 휴가 — 네이티브 leave_requests(과거) + 전자결재 approval_requests(휴가, 2026-07-15 일원화) 병합.
  const { data: recentLeaves = [] } = useQuery({
    queryKey: ["my-recent-leaves", employee?.id, userId],
    queryFn: async () => {
      const db = supabase;
      const [{ data: native }, { data: approvals }] = await Promise.all([
        db.from("leave_requests").select("*").eq("employee_id", employee!.id).order("created_at", { ascending: false }).limit(5),
        db.from("approval_requests").select("id, status, created_at, custom_fields, description").eq("request_type", "leave").eq("requester_id", userId!).order("created_at", { ascending: false }).limit(5),
      ]);
      const mappedApprovals = (approvals || []).map((a: any) => {
        const lv = a.custom_fields?.leave || {};
        return {
          id: `approval-${a.id}`,
          leave_type: lv.leave_type || a.description?.match(/유형:\s*(\S+)/)?.[1] || "annual",
          start_date: lv.start_date || a.created_at?.slice(0, 10),
          end_date: lv.end_date || lv.start_date || a.created_at?.slice(0, 10),
          status: a.status,
          created_at: a.created_at,
        };
      });
      return [...(native || []), ...mappedApprovals]
        .sort((x: any, y: any) => (y.created_at || "").localeCompare(x.created_at || ""))
        .slice(0, 5);
    },
    enabled: !!employee?.id && !!userId,
  });

  //   ── 내 현황(2026-08-19) — 이번 주 근무 · 내가 처리할 것(결재·서명·할 일·내 요청) · 최근 공지 ──
  const todayStr = todayKst();
  //   toISOString 은 UTC 로 바꿔 KST 에서 하루 밀렸다(월요일 시작인데 08/30 일요일로 표시, 2026-09-01 전수점검) — 로컬 포맷으로
  const weekStart = (() => { const d = new Date(todayStr + "T00:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const { data: weekRecs = [] } = useQuery({
    queryKey: ["my-week-attendance", employee?.id, weekStart],
    queryFn: async () => { const data = logRead("mypage:week", await supabase.from("attendance_records").select("date, work_hours, overtime_minutes, is_late, status").eq("employee_id", employee!.id).gte("date", weekStart).lte("date", todayStr)); return (data || []) as any[]; },
    enabled: !!employee?.id,
  });
  const weekHours = weekRecs.reduce((s: number, r: any) => s + Number(r.work_hours || 0), 0);
  const weekOt = weekRecs.reduce((s: number, r: any) => s + Number(r.overtime_minutes || 0), 0);
  const weekLate = weekRecs.filter((r: any) => r.is_late).length;
  const { data: myPendingApprovals = [] } = useQuery({ queryKey: ["my-pending-approvals", userId, companyId], queryFn: () => getMyPendingApprovals(userId!, companyId!), enabled: !!userId && !!companyId, staleTime: 60_000 });
  const { data: myRequestsPending = 0 } = useQuery({
    queryKey: ["my-requests-pending", userId], enabled: !!userId, staleTime: 60_000,
    queryFn: async () => { const { count } = await supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("requester_id", userId!).eq("status", "pending"); return count || 0; },
  });
  const { data: signPackages = [] } = useQuery({
    queryKey: ["my-contracts", userId, companyId], enabled: !!userId && !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const emp = logRead("mypage:emp-for-sign", await supabase.from("employees").select("id").eq("user_id", userId!).eq("company_id", companyId!).maybeSingle());
      if (!emp) return [] as any[];
      const data = logRead("mypage:sign", await supabase.from("hr_contract_packages").select("id, title, status, sign_token, sent_at, expires_at, completed_at, created_at, hr_contract_package_items(id, status)").eq("employee_id", (emp as any).id).order("created_at", { ascending: false }));
      return (data || []) as any[];
    },
  });
  const signPending = signPackages.filter((p: any) => ["sent", "partially_signed"].includes(p.status) && !(p.expires_at && new Date(p.expires_at) < new Date()));
  //   schedule_todos(2026-08-10 일정 통합 후 죽은 테이블) → schedule_events 로 교체 (2026-08-31) — 완료 불가능한 옛 할 일이 "처리할 것"에 영구 잔류하던 것
  const { data: todosToday = [] } = useQuery({ queryKey: ["my-todos-open", companyId, userId], enabled: !!userId && !!companyId, staleTime: 60_000, queryFn: async () => (await getScheduleItems(companyId!, { mineOnly: true, userId: userId! }))
    .filter((t: any) => !t.completed && (!t.start_at || String(t.start_at).slice(0, 10) <= todayStr))
    .map((t: any) => ({ ...t, due_date: t.start_at ? String(t.start_at).slice(0, 10) : null })) });
  const { data: recentNotices = [] } = useQuery({
    queryKey: ["my-recent-notices", companyId], enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => { const data = logRead("mypage:notices", await supabase.from("announcements").select("id, title, created_at").eq("company_id", companyId!).order("created_at", { ascending: false }).limit(3)); return (data || []) as any[]; },
  });
  //   증명서 발급 신청(결재 허브 유형 certificate) — 내 신청 목록 (2026-08-19)
  const { data: certReqs = [] } = useQuery({
    queryKey: ["my-certificate-requests", userId], enabled: !!userId, staleTime: 60_000,
    queryFn: async () => { const data = logRead("mypage:cert", await supabase.from("approval_requests").select("id, title, description, status, created_at, attachments").eq("requester_id", userId!).eq("request_type", "certificate").order("created_at", { ascending: false }).limit(20)); return (data || []) as any[]; },
  });
  //   휴가·연차 갈래는 원장을 바로 연다(모달이 아니라 표)
  useEffect(() => { if (tab === "leave") setShowUsedLeaves(true); }, [tab]);

  if (!userId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  const st = employee ? EMP_STATUS[employee.status as string] || EMP_STATUS.active : null;
  const remaining = leaveBalance
    ? (leaveBalance.remaining_days ?? (Number(leaveBalance.total_days) - Number(leaveBalance.used_days)))
    : null;

  const roleLabel = (ctxUser as any)?.is_master ? "마스터" : role === "partner" ? "파트너" : "멤버"; // (P3) 역할 라벨 개편

  return (
    <div className="qk-shell mypage-page">
      {/* ── 조회 화면 표준 상자 (2026-08-19 확산) — 그라데이션 히어로 + 바깥 seg-bar → 갈래 탭 상자 안 파란 밑줄 + 신원 한 줄(아바타·이름·역할·이메일·회사), 본문만 스크롤 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print" role="tablist" aria-label="마이페이지 메뉴">
            {([["home", "내 현황"], ["attendance", "근태"], ["leave", "휴가·연차"], ["docs", "급여·계약·증명"], ["me", "내 정보·설정"]] as const)
              .filter(([k]) => role !== "partner" || k === "home" || k === "me")
              .map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"} role="tab" aria-selected={tab === k}>
                {l}{k === "docs" && signPending.length > 0 && <span className="collect-tab-cnt ap-tab-alert">{signPending.length}</span>}
              </button>
            ))}
          </div>
          <div className="mypage-identity">
            <span className="mypage-identity-avatar">
              <Avatar name={userInfo?.name} src={(userInfo as any)?.avatar_url} size={36} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingAvatar} className="mypage-avatar-cam-btn" title="프로필 사진 변경" aria-label="프로필 사진 변경">
                {uploadingAvatar ? <span className="w-3 h-3 border-2 border-[var(--border)] border-t-[var(--primary)] rounded-full animate-spin" />
                  : <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>}
              </button>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} className="hidden" />
            </span>
            <b>{userInfo?.name || "—"}</b>
            <span className="badge badge-primary">{roleLabel}</span>
            <span className="text-[var(--text-muted)]">{[userInfo?.email, company?.name, employee ? [employee.department, employee.position].filter(Boolean).join(" ") : null, employee?.hire_date ? `입사 ${employee.hire_date}` : null].filter(Boolean).join(" · ") || "—"}</span>
          </div>
          {tab === "home" && (
            <ResultStrip>
              <Stat label="이번 주 근무" value={<>{weekHours.toFixed(1)}h <small className="font-normal text-[var(--text-dim)]">/ 52h</small></>} />
              <Stat label="연차 잔여" value={remaining !== null ? `${remaining}일` : "—"} tone={remaining !== null && remaining <= 3 ? "minus" : undefined} />
              <Stat label="내가 처리할 것" value={`${myPendingApprovals.length + signPending.length + todosToday.length}건`} tone={myPendingApprovals.length + signPending.length + todosToday.length > 0 ? "minus" : undefined} />
              <Stat label="내 요청 대기" value={`${myRequestsPending}건`} />
            </ResultStrip>
          )}
        </QueryHead>
        <QueryBody>
        <div className="mypage-scroll">

      {/* ── 내 현황 — 오늘 출퇴근 · 이번 주 근무 · 연차 · 내가 처리할 것 · 최근 소식 ── */}
      {tab === "home" && (
        <div className="bz-body">
          <div className="bz-grid3">
            <section className="pnl-panel mypage-today-panel">
              <h3>오늘 출퇴근</h3>
              <p>{todayStr} · 출근·퇴근 버튼은 여기서</p>
              {companyId && <MyAttendanceCard companyId={companyId} userId={userId} compact />}
            </section>
            <section className="pnl-panel">
              <h3>이번 주 근무</h3>
              <p>{weekStart.slice(5).replace("-", "/")}~ · 52시간 한도</p>
              <div className="bz-big mono-number">{weekHours.toFixed(1)}h</div>
              <div className="att-ratio mypage-gauge"><i style={{ width: `${Math.min(100, Math.round((weekHours / 52) * 100))}%` }} /></div>
              <dl className="bz-kv">
                <div><dt>연장</dt><dd className="mono-number">{weekOt > 0 ? `${Math.floor(weekOt / 60)}h ${weekOt % 60}m` : "—"}</dd></div>
                <div><dt>지각</dt><dd className={weekLate > 0 ? "text-[var(--warning)]" : ""}>{weekLate > 0 ? `${weekLate}회` : "—"}</dd></div>
                <div><dt>남은 한도</dt><dd className="mono-number">{Math.max(0, 52 - weekHours).toFixed(1)}h</dd></div>
              </dl>
              <p className="bz-why"><button type="button" onClick={() => setTab("attendance")} className="bz-link">이 달 출퇴근 기록 →</button></p>
            </section>
            <section className="pnl-panel">
              <h3>연차</h3>
              <p>{currentYear}년{leaveBalance ? ` · 발생 ${leaveBalance.total_days} · 사용 ${leaveBalance.used_days}` : ""}</p>
              <div className={`bz-big mono-number ${remaining !== null && remaining <= 3 ? "bz-minus" : ""}`}>{remaining !== null ? `${remaining}일` : "—"} <small className="text-[13px] font-medium text-[var(--text-dim)]">남음</small></div>
              <dl className="bz-kv">
                <div><dt>최근 신청</dt><dd>{recentLeaves[0] ? `${recentLeaves[0].start_date} ${leaveTypeLabel(recentLeaves[0].leave_type)} · ${recentLeaves[0].status === "approved" ? "승인" : recentLeaves[0].status === "rejected" ? "반려" : "대기"}` : "없음"}</dd></div>
                <div><dt>대기 중</dt><dd>{recentLeaves.filter((l: any) => l.status === "pending").length}건</dd></div>
              </dl>
              <p className="bz-why"><Link href="/approvals?tab=new-request&new=leave" className="bz-link">휴가 신청 → 결재 허브</Link> · <button type="button" onClick={() => setTab("leave")} className="bz-link">내역 →</button></p>
            </section>
          </div>
          <div className="bz-grid2">
            <section className="pnl-panel">
              <h3>내가 처리할 것 <small className="font-normal text-[var(--text-dim)]">{myPendingApprovals.length + signPending.length + todosToday.length}건</small></h3>
              <p>나한테 온 것 — 결재·서명·할 일. 누르면 그 화면으로</p>
              {myPendingApprovals.length + signPending.length + todosToday.length + myRequestsPending === 0 ? <div className="collect-empty">지금 처리할 것이 없습니다</div> : (
                <ul className="bz-todos">
                  {myPendingApprovals.slice(0, 5).map((a: any) => (
                    <li key={a.stepId} className="bz-todo"><span className="bz-kind bz-kind-r">결재</span><span className="bz-todo-text">{a.title || "결재 요청"}{a.requesterName && <small> · {a.requesterName}</small>}{a.amount ? <small className="mono-number"> · ₩{Number(a.amount).toLocaleString()}</small> : null}</span><Link href="/approvals" className="bz-link">결재 허브 →</Link></li>
                  ))}
                  {signPending.map((p: any) => (
                    <li key={p.id} className="bz-todo"><span className="bz-kind bz-kind-y">서명</span><span className="bz-todo-text">{p.title}<small> · 회사가 보낸 서명 요청{p.expires_at ? ` · ${p.expires_at.slice(0, 10)}까지` : ""}</small></span><button type="button" onClick={() => p.sign_token && window.open(`/sign?token=${p.sign_token}`, "_blank", "noopener")} className="bz-link">서명하기 →</button></li>
                  ))}
                  {todosToday.slice(0, 5).map((t: any) => (
                    <li key={t.id} className="bz-todo"><span className="bz-kind bz-kind-g">할 일</span><span className="bz-todo-text">{t.title}{t.due_date && <small> · {t.due_date}</small>}</span><Link href="/schedule" className="bz-link">일정/할 일 →</Link></li>
                  ))}
                  {myRequestsPending > 0 && <li className="bz-todo bz-todo-done"><span className="bz-kind bz-kind-y">내 요청</span><span className="bz-todo-text">승인 기다리는 내 요청 {myRequestsPending}건</span><Link href="/approvals?tab=my-requests" className="bz-link">내 요청 →</Link></li>}
                </ul>
              )}
            </section>
            <section className="pnl-panel">
              <h3>최근 소식</h3>
              <p>공지 · 내 휴가 결과</p>
              <dl className="bz-kv">
                {recentNotices.map((n: any) => <div key={n.id}><dt className="truncate">공지 · {n.title}</dt><dd><Link href="/announcements" className="bz-link">보기 →</Link></dd></div>)}
                {recentLeaves.slice(0, 3).map((l: any) => <div key={l.id}><dt>{leaveTypeLabel(l.leave_type)} {l.start_date}</dt><dd className={l.status === "approved" ? "bz-plus" : l.status === "rejected" ? "bz-minus" : "bz-tone-y"}>{l.status === "approved" ? "승인" : l.status === "rejected" ? "반려" : "대기"}</dd></div>)}
                {recentNotices.length + recentLeaves.length === 0 && <div><dt className="text-[var(--text-dim)]">최근 소식이 없습니다</dt><dd /></div>}
              </dl>
            </section>
          </div>
        </div>
      )}

      {/* ── 근태 — 월별 내 출퇴근 기록 + 정정 요청 (오늘 찍기는 내 현황) ── */}
      {tab === "attendance" && (
        <div className="mypage-attendance-tab space-y-5">
          {employee?.id ? (
            <MyAttendance employeeId={employee.id} />
          ) : (
            <div className="collect-empty">구성원 정보와 연결되지 않았습니다 — 인사관리에서 내 계정이 구성원으로 등록되면 출퇴근 기록이 표시됩니다</div>
          )}
        </div>
      )}

      {/* ── 휴가·연차 — 결과 요약 · 사용 내역 표 · 발생 내역 (예전 인사기록 카드 + 원장 모달) ── */}
      {tab === "leave" && (
        <div className="bz-body">
          <div className="qk-bar">
            <div className="qk-bar-left">
              {allBalances.length > 1 ? (
                <select value={ledgerYear} onChange={(e) => setLedgerYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">{allBalances.map((b: any) => <option key={b.year} value={b.year}>{b.year}년</option>)}</select>
              ) : <span className="text-xs font-semibold text-[var(--text-muted)]">{ledgerYear}년</span>}
              <span className="text-[11px] text-[var(--text-dim)]">발생분에서 승인된 휴가를 차례로 차감한 내역 · 신청·승인은 결재 허브</span>
            </div>
            <div className="qk-bar-right"><Link href="/approvals?tab=new-request&new=leave" className="btn-primary btn-sm">휴가 신청</Link></div>
          </div>
          <ResultStrip>
            <Stat label="발생" value={`${ledgerBalance ? ledgerGranted : (leaveBalance?.total_days ?? 0)}일`} />
            <Stat label="사용" value={`${ledgerBalance ? usedLeavesTotal : (leaveBalance?.used_days ?? 0)}일`} />
            <Stat label="잔여" value={`${ledgerBalance ? (balanceRemain ?? runningRemain) : (remaining ?? 0)}일`} tone="plus" />
            <Stat label="대기 중" value={`${recentLeaves.filter((l: any) => l.status === "pending").length}건`} />
          </ResultStrip>
          {!leaveBalance && !ledgerBalance ? (
            <div className="collect-empty">연차 정보가 설정되지 않았습니다 — 관리자가 연차를 설정하면 여기 표시됩니다</div>
          ) : (
            <div className="bz-grid2">
              <section className="pnl-panel">
                <h3>사용 내역 <small className="font-normal text-[var(--text-dim)]">{ledgerYear}년 · {useEntries.length}건</small></h3>
                <p>발생(+) · 사용(−)을 날짜순으로, 오른쪽은 그때 잔여</p>
                {usedLeavesLoading ? <div className="collect-empty">불러오는 중…</div> : (
                  <table className="ev-table ev-lined mypage-leave-table">
                    <thead><tr><th>날짜</th><th className="text-left">구분</th><th>일수</th><th>잔여</th></tr></thead>
                    <tbody>
                      {ledgerRows.map((e: any) => (
                        <tr key={e.id} className={e.kind === "grant" ? "bg-[var(--bg-surface)]/50" : ""}>
                          <td className="text-center mono-number">{fmtLedgerDate(e.date)}{e.kind === "use" && e.endDate && e.endDate !== e.date ? ` ~ ${fmtLedgerDate(e.endDate)}` : ""}</td>
                          <td className="text-left">{e.kind === "grant" ? <><span className="badge badge-primary">{e.label}</span>{e.memo && <small className="ml-1 text-[var(--text-dim)]">{e.memo}</small>}</> : e.label}</td>
                          <td className={`text-right mono-number font-bold ${e.kind === "grant" ? (e.days < 0 ? "bz-minus" : "bz-plus") : "bz-minus"}`}>{e.kind === "grant" ? (e.days < 0 ? "−" : "+") : "−"}{Math.abs(e.days)}</td>
                          <td className="text-right mono-number">{e.remain}</td>
                        </tr>
                      ))}
                      {ledgerRows.length === 0 && <tr><td colSpan={4} className="text-center text-[var(--text-dim)] py-6">{ledgerYear}년 내역이 없습니다</td></tr>}
                    </tbody>
                  </table>
                )}
                {ledgerMismatch && <p className="mt-2 text-[11px] text-[var(--text-dim)]">※ 관리자가 연차를 직접 조정한 이력이 있어 최종 잔여({balanceRemain}일)가 내역 합계와 다릅니다.</p>}
              </section>
              <section className="pnl-panel">
                <h3>최근 신청</h3>
                <p>네이티브 휴가 신청 + 결재 허브 휴가 요청</p>
                {recentLeaves.length === 0 ? <div className="collect-empty">신청이 없습니다</div> : (
                  <table className="ev-table ev-lined mypage-leave-table">
                    <thead><tr><th>기간</th><th className="text-left">종류</th><th>상태</th></tr></thead>
                    <tbody>{recentLeaves.map((leave: any) => (
                      <tr key={leave.id}><td className="text-center mono-number">{leave.start_date}{leave.end_date && leave.end_date !== leave.start_date ? ` ~ ${leave.end_date}` : ""}</td><td className="text-left">{leaveTypeLabel(leave.leave_type)}</td><td className="text-center"><span className={`ol-sure ${leave.status === "approved" ? "ol-sure-ok" : leave.status === "rejected" ? "" : "ol-sure-est"}`}>{leave.status === "approved" ? "승인" : leave.status === "rejected" ? "반려" : "대기"}</span></td></tr>
                    ))}</tbody>
                  </table>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {/* ── 급여·계약·증명 — 급여명세 · 근로계약서/서명 요청(예전 '내 서명 요청' 메뉴 흡수) ── */}
      {tab === "docs" && (
        <div className="bz-body">
          <section className="pnl-panel">
            <h3>서명 요청 <small className="font-normal text-[var(--text-dim)]">회사가 보낸 계약서 — 서명하고 보관</small>{signPending.length > 0 && <span className="collect-tab-cnt ap-tab-alert ml-2">{signPending.length}</span>}</h3>
            <p>예전 사이드바 '내 서명 요청'이 여기로 왔습니다. 전체 목록·정렬은 <Link href="/my-contracts" className="bz-link">내 서명 요청 →</Link></p>
            {signPackages.length === 0 ? <div className="collect-empty">받은 서명 요청이 없습니다</div> : (
              <table className="ev-table ev-lined mypage-leave-table">
                <thead><tr><th className="text-left">문서</th><th>문서 수</th><th>보낸 날</th><th>만료</th><th>상태</th><th>동작</th></tr></thead>
                <tbody>{signPackages.slice(0, 10).map((p: any) => {
                  const expired = p.expires_at && new Date(p.expires_at) < new Date();
                  const st = expired ? "만료됨" : p.status === "completed" ? "서명 완료" : p.status === "partially_signed" ? "일부 서명" : p.status === "sent" ? "서명 대기" : p.status === "cancelled" ? "취소됨" : "준비 중";
                  return (
                    <tr key={p.id}><td className="text-left font-semibold">{p.title}</td><td className="text-center mono-number">{(p.hr_contract_package_items || []).length}</td><td className="text-center mono-number">{(p.sent_at || p.created_at || "").slice(0, 10)}</td><td className="text-center mono-number">{p.expires_at ? p.expires_at.slice(0, 10) : "—"}</td>
                      <td className="text-center"><span className={`ol-sure ${st === "서명 완료" ? "ol-sure-ok" : st === "서명 대기" || st === "일부 서명" ? "ol-sure-est" : ""}`}>{st}</span></td>
                      <td className="text-center">{["sent", "partially_signed"].includes(p.status) && !expired && p.sign_token ? <button type="button" onClick={() => window.open(`/sign?token=${p.sign_token}`, "_blank", "noopener")} className="btn-primary btn-sm">서명</button> : "—"}</td></tr>
                  );
                })}</tbody>
              </table>
            )}
          </section>
          <div className="bz-grid2">
            {employee?.id && <MyPayslips employeeId={employee.id} />}
            {employee?.id && <MyContractsCard employeeId={employee.id} />}
          </div>
          <section className="pnl-panel">
            <h3>증명서 <small className="font-normal text-[var(--text-dim)]">재직·경력·급여 증명 — 신청하면 인사팀이 결재 허브에서 승인·발급</small></h3>
            <p>신청 제목에 종류(재직/경력/급여)와 용도(은행 제출 등)를 적어 주세요. 발급본은 결재 건의 첨부로 돌아옵니다.</p>
            <div className="mb-2"><Link href="/approvals?tab=new-request&new=certificate" className="btn-secondary btn-sm">증명서 발급 신청</Link></div>
            {certReqs.length === 0 ? <div className="collect-empty">신청한 증명서가 없습니다</div> : (
              <table className="ev-table ev-lined mypage-leave-table">
                <thead><tr><th className="text-left">신청</th><th>신청일</th><th>상태</th><th>발급본</th></tr></thead>
                <tbody>{certReqs.map((r: any) => (
                  <tr key={r.id}><td className="text-left font-semibold">{r.title}{r.description && <small className="ml-1 text-[var(--text-dim)]">{String(r.description).slice(0, 40)}</small>}</td><td className="text-center mono-number">{String(r.created_at || "").slice(0, 10)}</td>
                    {/* 승인 = 발급이 아니다 (2026-08-21 감사): 결재 승인만으로는 증명서가
                        만들어지지 않는데 '발급 완료' 로 찍혀, 직원은 받을 파일이 없는데
                        다 됐다고 알고 있었다. 발급본(첨부)이 붙어야 완료로 본다. */}
                    <td className="text-center">{(() => {
                      const hasFile = Array.isArray(r.attachments) && r.attachments.length > 0;
                      const label = r.status === "rejected" ? "반려"
                        : r.status === "approved" ? (hasFile ? "발급 완료" : "승인됨 · 발급 대기")
                        : "처리 중";
                      const cls = r.status === "rejected" ? "" : (r.status === "approved" && hasFile) ? "ol-sure-ok" : "ol-sure-est";
                      return <span className={`ol-sure ${cls}`}>{label}</span>;
                    })()}</td>
                    <td className="text-center">{Array.isArray(r.attachments) && r.attachments.length > 0 ? <Link href={`/approvals?tab=my-requests&request=${r.id}`} className="bz-link">첨부 {r.attachments.length}건 →</Link> : "—"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* ── 내 정보·설정 — 인사 정보 · 알림 · 계정·보안 ── */}
      {tab === "me" && (
        <div className="bz-body">
          {employee && (
            <section className="pnl-panel">
              <h3>인사 정보</h3>
              <p>회사가 관리하는 값 — 틀리면 인사팀에 정정을 요청하세요</p>
              <div className="mypage-info-grid">
                <div className="mypage-info-tile"><div className="text-xs text-[var(--text-dim)] mb-0.5">부서</div><div className="font-medium">{employee.department || "—"}</div></div>
                <div className="mypage-info-tile"><div className="text-xs text-[var(--text-dim)] mb-0.5">직위</div><div className="font-medium">{employee.position || "—"}</div></div>
                <div className="mypage-info-tile"><div className="text-xs text-[var(--text-dim)] mb-0.5">입사일</div><div className="font-medium">{employee.hire_date || "—"}</div></div>
                <div className="mypage-info-tile"><div className="text-xs text-[var(--text-dim)] mb-0.5">상태</div><div className={`font-medium ${st?.color || ""}`}>{st?.label || employee.status}</div></div>
                {Number(employee.salary) > 0 && (
                  <button type="button" onClick={() => setShowSalary((v) => !v)} className="mypage-info-tile text-left cursor-pointer" title={showSalary ? "누르면 가립니다" : "누르면 표시됩니다"}>
                    <div className="text-xs text-[var(--text-dim)] mb-0.5">연봉</div>
                    <div className={`font-medium mono-number ${showSalary ? "" : "text-[var(--text-dim)] tracking-widest"}`}>{showSalary ? `₩${(Number(employee.salary) * 12).toLocaleString()}` : "₩ ••••••"}</div>
                  </button>
                )}
                {employee.employee_number && <div className="mypage-info-tile"><div className="text-xs text-[var(--text-dim)] mb-0.5">사번</div><div className="font-medium">{employee.employee_number}</div></div>}
              </div>
            </section>
          )}
          <section className="pnl-panel">
            <h3>프로필</h3>
            <p>내가 고치는 값</p>
            <dl className="bz-kv">
              <div><dt>이메일</dt><dd>{userInfo?.email || "—"}</dd></div>
              <div><dt>프로필 사진</dt><dd><span className="inline-flex gap-1.5"><button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingAvatar} className="btn-secondary btn-sm">변경</button>{(userInfo as any)?.avatar_url && <button type="button" onClick={handleAvatarRemove} disabled={uploadingAvatar} className="btn-secondary btn-sm">기본으로</button>}</span></dd></div>
            </dl>
          </section>
          {companyId && <NotificationsTab companyId={companyId} />}
          <AccountTab />
          <div className="mypage-withdraw-card pnl-panel">
            <h3 className="text-[var(--danger)]">회원 탈퇴</h3>
            <p>탈퇴하면 <b>로그인 계정이 영구 삭제</b>되고 이름·이메일 등 개인정보가 파기됩니다. <b>되돌릴 수 없습니다.</b>{(ctxUser as any)?.is_master && <span className="block mt-1 text-amber-500">※ 마스터 계정입니다. 탈퇴해도 회사·직원·거래 데이터는 남으니, 회사 정리가 필요하면 먼저 처리하세요.</span>}</p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input value={withdrawText} onChange={(e) => setWithdrawText(e.target.value)} placeholder='탈퇴하려면 "탈퇴" 입력' className="qk-input h-8 px-2.5 text-xs sm:w-48" />
              <button onClick={handleWithdraw} disabled={withdrawText.trim() !== "탈퇴" || withdrawing} className="btn-secondary btn-sm text-[var(--danger)] disabled:cursor-not-allowed">{withdrawing ? "처리 중..." : "회원 탈퇴"}</button>
            </div>
            {withdrawErr && <p className="text-xs text-[var(--danger)] mt-2">{withdrawErr}</p>}
          </div>
        </div>
      )}

      {/* 연차 원장 모달은 2026-08-19 '휴가·연차' 갈래의 표로 대체 */}
        </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}

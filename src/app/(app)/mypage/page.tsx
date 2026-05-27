"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";

const EMP_STATUS: Record<string, { label: string; color: string }> = {
  invited: { label: "초대중", color: "text-amber-500" },
  joined: { label: "가입완료", color: "text-blue-400" },
  active: { label: "재직", color: "text-green-400" },
  inactive: { label: "퇴직", color: "text-gray-400" },
};

export default function MyPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const { role } = useUser();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  const { data: userInfo } = useQuery({
    queryKey: ["my-user-info", userId],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("name, email, role").eq("id", userId!).maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  const { data: employee } = useQuery({
    queryKey: ["my-employee-info", companyId, userId],
    queryFn: async () => {
      if (!userInfo?.email) return null;
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId!)
        .eq("email", userInfo.email)
        .maybeSingle();
      return data;
    },
    enabled: !!companyId && !!userInfo?.email,
  });

  const { data: company } = useQuery({
    queryKey: ["my-company-info", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name").eq("id", companyId!).maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

  const currentYear = new Date().getFullYear();
  const { data: leaveBalance } = useQuery({
    queryKey: ["my-leave-balance-page", employee?.id, currentYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_balances")
        .select("total_days, used_days, remaining_days, year")
        .eq("employee_id", employee!.id)
        .eq("year", currentYear)
        .maybeSingle();
      return data;
    },
    enabled: !!employee?.id,
  });

  const { data: recentLeaves = [] } = useQuery({
    queryKey: ["my-recent-leaves", employee?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", employee!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!employee?.id,
  });

  if (!userId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  const st = employee ? EMP_STATUS[employee.status as string] || EMP_STATUS.active : null;
  const remaining = leaveBalance
    ? (leaveBalance.remaining_days ?? (Number(leaveBalance.total_days) - Number(leaveBalance.used_days)))
    : null;

  return (
    <div className="max-w-[700px]">
      <h1 className="text-2xl font-extrabold mb-1">마이페이지</h1>
      <p className="text-sm text-[var(--text-muted)] mb-6">내 정보 및 연차 현황</p>

      {/* 기본 정보 */}
      <div className="glass-card p-6 mb-4">
        <h2 className="text-sm font-bold mb-4">기본 정보</h2>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <div>
            <div className="text-xs text-[var(--text-dim)] mb-0.5">이름</div>
            <div className="font-medium">{userInfo?.name || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-dim)] mb-0.5">이메일</div>
            <div className="font-medium">{userInfo?.email || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-dim)] mb-0.5">회사</div>
            <div className="font-medium">{company?.name || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-dim)] mb-0.5">권한</div>
            <div className="font-medium">{role === "owner" ? "대표" : role === "admin" ? "관리자" : "직원"}</div>
          </div>
        </div>
      </div>

      {/* 직원 정보 */}
      {employee && (
        <div className="glass-card p-6 mb-4">
          <h2 className="text-sm font-bold mb-4">인사 정보</h2>
          <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <div>
              <div className="text-xs text-[var(--text-dim)] mb-0.5">부서</div>
              <div className="font-medium">{employee.department || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-dim)] mb-0.5">직위</div>
              <div className="font-medium">{employee.position || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-dim)] mb-0.5">입사일</div>
              <div className="font-medium">{employee.hire_date || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-dim)] mb-0.5">상태</div>
              <div className={`font-medium ${st?.color || ""}`}>{st?.label || employee.status}</div>
            </div>
            {Number(employee.salary) > 0 && (
              <div>
                <div className="text-xs text-[var(--text-dim)] mb-0.5">연봉</div>
                <div className="font-medium">₩{(Number(employee.salary) * 12).toLocaleString()}</div>
              </div>
            )}
            {employee.employee_number && (
              <div>
                <div className="text-xs text-[var(--text-dim)] mb-0.5">사번</div>
                <div className="font-medium">{employee.employee_number}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 연차 현황 */}
      <div className="glass-card p-6 mb-4">
        <h2 className="text-sm font-bold mb-4">{currentYear}년 연차 현황</h2>
        {leaveBalance ? (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border)]">
              <div className="text-2xl font-extrabold text-[var(--primary)]">{leaveBalance.total_days}일</div>
              <div className="text-xs text-[var(--text-dim)] mt-1">총 연차</div>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border)]">
              <div className="text-2xl font-extrabold text-orange-400">{leaveBalance.used_days}일</div>
              <div className="text-xs text-[var(--text-dim)] mt-1">사용</div>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border)]">
              <div className={`text-2xl font-extrabold ${remaining !== null && remaining <= 3 ? "text-red-400" : "text-green-400"}`}>
                {remaining ?? 0}일
              </div>
              <div className="text-xs text-[var(--text-dim)] mt-1">잔여</div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]">
            연차 정보가 설정되지 않았습니다.
            <div className="text-xs text-[var(--text-dim)] mt-1">인력관리 &gt; 휴가 탭에서 연차를 초기화해주세요.</div>
          </div>
        )}

        {recentLeaves.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-[var(--text-dim)] mb-2 mt-2">최근 휴가 신청</div>
            <div className="space-y-2">
              {recentLeaves.map((leave: any) => (
                <div key={leave.id} className="flex items-center justify-between text-xs bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{leave.leave_type === "annual" ? "연차" : leave.leave_type === "sick" ? "병가" : leave.leave_type}</span>
                    <span className="text-[var(--text-muted)]">{leave.start_date}{leave.end_date && leave.end_date !== leave.start_date ? ` ~ ${leave.end_date}` : ""}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    leave.status === "approved" ? "bg-green-500/10 text-green-400"
                      : leave.status === "rejected" ? "bg-red-500/10 text-red-400"
                      : "bg-amber-500/10 text-amber-500"
                  }`}>
                    {leave.status === "approved" ? "승인" : leave.status === "rejected" ? "반려" : "대기"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

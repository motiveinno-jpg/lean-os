"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, clearCurrentUserCache } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
// 개인 계정 영역 — 회사 설정에서 마이페이지로 이관(2026-07-08). 컴포넌트 위치는 유지, 마운트만 옮김.
import { AccountTab } from "../settings/_components/AccountTab";
import { NotificationsTab } from "../settings/_components/NotificationsTab";
// 개인 인사기록 허브(2026-07-15) — 근로계약서/급여명세/증명서를 마이페이지로 이관.
import { MyContractsCard } from "./_components/MyContractsCard";
import { MyPayslips } from "./_components/MyPayslips";
import { MyCertificates } from "./_components/MyCertificates";

const EMP_STATUS: Record<string, { label: string; color: string }> = {
  invited: { label: "초대중", color: "text-[var(--warning)]" },
  joined: { label: "가입완료", color: "text-[var(--info)]" },
  active: { label: "재직", color: "text-[var(--success)]" },
  inactive: { label: "퇴직", color: "text-[var(--text-muted)]" },
};

export default function MyPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const { role, refresh } = useUser();
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
      const { data } = await supabase.from("users").select("name, email, role, avatar_url").eq("id", userId!).maybeSingle();
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
      const { error: upErr } = await supabase.storage.from("company-assets").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from("company-assets").getPublicUrl(path);
      const { error: updErr } = await supabase.from("users").update({ avatar_url: urlData.publicUrl }).eq("id", userId);
      if (updErr) throw new Error(updErr.message);
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

  // 최근 휴가 — 네이티브 leave_requests(과거) + 전자결재 approval_requests(휴가, 2026-07-15 일원화) 병합.
  const { data: recentLeaves = [] } = useQuery({
    queryKey: ["my-recent-leaves", employee?.id, userId],
    queryFn: async () => {
      const db = supabase as any;
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

  if (!userId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  const st = employee ? EMP_STATUS[employee.status as string] || EMP_STATUS.active : null;
  const remaining = leaveBalance
    ? (leaveBalance.remaining_days ?? (Number(leaveBalance.total_days) - Number(leaveBalance.used_days)))
    : null;

  return (
    <div className="mypage-layout">
      {/* 좌 1/3 — 프로필 카드 */}
      <div className="space-y-5">
      {/* 기본 정보 */}
      <div className="mypage-profile-card glass-card">
        <h2 className="section-title">기본 정보</h2>
        {/* 프로필 사진 — 업로드하면 전 화면 아바타가 이 사진으로. 제거 시 이니셜로 복귀. */}
        <div className="mypage-avatar-row">
          <Avatar name={userInfo?.name} src={(userInfo as any)?.avatar_url} size={64} />
          <div className="flex flex-col gap-1.5">
            <div className="text-xs text-[var(--text-dim)]">프로필 사진</div>
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={uploadingAvatar}
                className="btn-secondary btn-sm">
                {uploadingAvatar ? "처리 중..." : "사진 변경"}
              </button>
              {(userInfo as any)?.avatar_url && (
                <button onClick={handleAvatarRemove} disabled={uploadingAvatar}
                  className="btn-ghost btn-sm">
                  기본 이미지로
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} className="hidden" />
          </div>
        </div>
        <div className="mypage-basic-info">
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
      </div>

      {/* 우 2/3 — 인사·연차·계정 카드 */}
      <div className="lg:col-span-2 space-y-5">
      {/* 직원 정보 */}
      {employee && (
        <div className="mypage-employee-card glass-card">
          <h2 className="section-title">인사 정보</h2>
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

      {/* 내 근로계약서 — 나에게 온 서명 요청/계약서 (개인 인사기록) */}
      {employee?.id && <MyContractsCard employeeId={employee.id} />}

      {/* 내 급여명세 — 월별 명세 본인 조회 (개인 인사기록) */}
      {employee?.id && <MyPayslips employeeId={employee.id} />}

      {/* 연차 현황 */}
      <div className="mypage-leave-card glass-card">
        <h2 className="section-title">{currentYear}년 연차 현황</h2>
        {leaveBalance ? (
          <div className="mypage-leave-stats">
            <div className="stat-tile items-center text-center">
              <div className="stat-tile-label">총 연차</div>
              <div className="stat-tile-value mono-number text-[var(--primary)]">{leaveBalance.total_days}일</div>
            </div>
            <div className="stat-tile items-center text-center">
              <div className="stat-tile-label">사용</div>
              <div className="stat-tile-value mono-number text-[var(--warning)]">{leaveBalance.used_days}일</div>
            </div>
            <div className="stat-tile items-center text-center">
              <div className="stat-tile-label">잔여</div>
              <div className={`stat-tile-value mono-number ${remaining !== null && remaining <= 3 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
                {remaining ?? 0}일
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-3xl mb-3">🌴</div>
            <div className="text-sm font-semibold text-[var(--text-muted)]">연차 정보가 설정되지 않았습니다.</div>
            <div className="text-xs text-[var(--text-dim)] mt-1">관리자가 연차를 설정하면 이곳에 표시됩니다. (휴가 신청은 전자결재에서)</div>
          </div>
        )}

        {recentLeaves.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-[var(--text-dim)] mb-2 mt-2">최근 휴가 신청</div>
            <div className="mypage-recent-leaves">
              {recentLeaves.map((leave: any) => (
                <div key={leave.id} className="flex items-center justify-between text-xs bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{leave.leave_type === "annual" ? "연차" : leave.leave_type === "sick" ? "병가" : leave.leave_type}</span>
                    <span className="text-[var(--text-muted)]">{leave.start_date}{leave.end_date && leave.end_date !== leave.start_date ? ` ~ ${leave.end_date}` : ""}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    leave.status === "approved" ? "bg-[var(--success-dim)] text-[var(--success)]"
                      : leave.status === "rejected" ? "bg-[var(--danger-dim)] text-[var(--danger)]"
                      : "bg-[var(--warning-dim)] text-[var(--warning)]"
                  }`}>
                    {leave.status === "approved" ? "승인" : leave.status === "rejected" ? "반려" : "대기"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 내 증명서 — 재직/경력 증명서 본인 발급 (개인 인사기록) */}
      {employee?.id && <MyCertificates companyId={companyId} userId={userId} employee={employee} />}

      {/* 계정·보안 — 비밀번호 변경 (회사 설정에서 이관) */}
      <AccountTab />

      {/* 알림 설정 — 내 알림 수신 채널·이벤트 (회사 설정에서 이관) */}
      {companyId && <NotificationsTab companyId={companyId} />}

      {/* 회원 탈퇴 */}
      <div className="mypage-withdraw-card glass-card">
        <h2 className="text-sm font-bold mb-2 text-[var(--danger)]">회원 탈퇴</h2>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
          탈퇴하면 <b>로그인 계정이 영구 삭제</b>되고 이름·이메일 등 개인정보가 파기됩니다. <b>되돌릴 수 없습니다.</b>
          {role === "owner" && <span className="block mt-1 text-amber-500">※ 대표 계정입니다. 탈퇴해도 회사·직원·거래 데이터는 남으니, 회사 정리가 필요하면 먼저 처리하세요.</span>}
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            value={withdrawText}
            onChange={(e) => setWithdrawText(e.target.value)}
            placeholder='탈퇴하려면 "탈퇴" 입력'
            className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] sm:w-48"
          />
          <button
            onClick={handleWithdraw}
            disabled={withdrawText.trim() !== "탈퇴" || withdrawing}
            className="btn-danger disabled:cursor-not-allowed"
          >
            {withdrawing ? "처리 중..." : "회원 탈퇴"}
          </button>
        </div>
        {withdrawErr && <p className="text-xs text-[var(--danger)] mt-2">{withdrawErr}</p>}
      </div>
      </div>
    </div>
  );
}

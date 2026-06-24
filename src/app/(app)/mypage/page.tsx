"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";

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
    qc.invalidateQueries({ queryKey: ["my-user-info"] });
    qc.invalidateQueries({ queryKey: ["my-avatar"] });
  };
  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) { toast("이미지 파일만 업로드할 수 있습니다", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { toast("5MB 이하 이미지만 업로드할 수 있습니다", "error"); return; }
    setUploadingAvatar(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `avatars/${userId}-${Date.now()}.${ext}`;
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
    <div className="">
      <div className="page-sticky-header mb-6">
        <h1 className="text-2xl font-extrabold mb-1">마이페이지</h1>
        <p className="text-sm text-[var(--text-muted)]">내 정보 및 연차 현황</p>
      </div>

      {/* 기본 정보 */}
      <div className="glass-card p-6 mb-4">
        <h2 className="section-title">기본 정보</h2>
        {/* 프로필 사진 — 업로드하면 전 화면 아바타가 이 사진으로. 제거 시 이니셜로 복귀. */}
        <div className="flex items-center gap-4 mb-5 pb-5 border-b border-[var(--border)]">
          <Avatar name={userInfo?.name} src={(userInfo as any)?.avatar_url} size={64} />
          <div className="flex flex-col gap-1.5">
            <div className="text-xs text-[var(--text-dim)]">프로필 사진</div>
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={uploadingAvatar}
                className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition">
                {uploadingAvatar ? "처리 중..." : "사진 변경"}
              </button>
              {(userInfo as any)?.avatar_url && (
                <button onClick={handleAvatarRemove} disabled={uploadingAvatar}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] text-xs font-semibold hover:text-[var(--text)] disabled:opacity-50 transition">
                  기본 이미지로
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} className="hidden" />
          </div>
        </div>
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

      {/* 연차 현황 */}
      <div className="glass-card p-6 mb-4">
        <h2 className="section-title">{currentYear}년 연차 현황</h2>
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

      {/* 회원 탈퇴 */}
      <div className="glass-card p-6 mb-4 border border-red-500/30">
        <h2 className="text-sm font-bold mb-2 text-red-400">회원 탈퇴</h2>
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
            className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {withdrawing ? "처리 중..." : "회원 탈퇴"}
          </button>
        </div>
        {withdrawErr && <p className="text-xs text-red-400 mt-2">{withdrawErr}</p>}
      </div>
    </div>
  );
}

"use client";

// 사람의 지금 근무 상태를 화면들이 같은 계산으로 얻는 훅.
//   구성원 디렉토리·메신저 구성원·1:1 대화 머리가 모두 이걸 쓴다. 규칙은 lib/work-status.ts 한 곳.
//   재료: 계정 상태(users.presence_*) · 오늘 출퇴근·휴가(get_company_work_today) · 회사 근무 규칙 · 오늘 공휴일.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCompanyUsers } from "@/lib/queries";
import type { PresenceRow } from "@/lib/presence";
import { deriveWorkStatus, type WorkStatus, type WorkTodayRow } from "@/lib/work-status";
import { companyWorkCfgFromRow, kstNowMin } from "@/lib/attendance-schedule";
import { todayKst } from "@/lib/kst";

type PersonLike = { id?: string | null; user_id?: string | null; email?: string | null };

export function useWorkStatus(companyId: string | null | undefined, opts?: { withDirectory?: boolean }) {
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });
  const { data: workToday = [] } = useQuery({
    queryKey: ["company-work-today", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_work_today");
      if (error) throw error;
      return (data ?? []) as WorkTodayRow[];
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });
  const { data: workCfg } = useQuery({
    queryKey: ["company-work-cfg", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("company_settings")
        .select("work_start_time, work_end_time, lunch_minutes, late_grace_minutes, workdays_mask").eq("company_id", companyId!).maybeSingle();
      return companyWorkCfgFromRow(data as any);
    },
    enabled: !!companyId,
  });
  const todayStr = todayKst();
  const { data: holidayToday = false } = useQuery({
    queryKey: ["company-holiday-today", companyId, todayStr],
    queryFn: async () => {
      const { data } = await supabase.from("holidays").select("date").eq("company_id", companyId!).eq("date", todayStr).limit(1);
      return (data?.length ?? 0) > 0;
    },
    enabled: !!companyId,
  });
  // 계정(user_id)만 아는 화면이 직원 기록을 찾을 때만 디렉토리를 읽는다.
  const { data: directory = [] } = useQuery({
    queryKey: ["company-directory", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; user_id?: string | null; email?: string | null; status?: string | null }>;
    },
    enabled: !!companyId && !!opts?.withDirectory,
  });
  const [nowMin, setNowMin] = useState(() => kstNowMin());
  useEffect(() => { const t = setInterval(() => setNowMin(kstNowMin()), 60_000); return () => clearInterval(t); }, []);

  return useMemo(() => {
    const usersById = new Map<string, PresenceRow>();
    const usersByEmail = new Map<string, PresenceRow>();
    for (const u of companyUsers as any[]) { usersById.set(u.id, u); if (u.email) usersByEmail.set(String(u.email).toLowerCase(), u); }
    const todayByEmp = new Map<string, WorkTodayRow>();
    for (const r of workToday) todayByEmp.set(r.employee_id, r);
    const cfg = workCfg ?? companyWorkCfgFromRow(null);
    const holidays = holidayToday ? new Set([todayStr]) : null;
    const presenceOf = (e: PersonLike): PresenceRow | null =>
      (e.user_id && usersById.get(e.user_id)) || (e.email ? usersByEmail.get(String(e.email).toLowerCase()) : null) || null;
    const statusOf = (e: PersonLike): WorkStatus | null =>
      deriveWorkStatus({ presence: presenceOf(e), today: e.id ? todayByEmp.get(e.id) : null, cfg, todayStr, nowMin, holidays });
    const empByUser = new Map<string, PersonLike>();
    const empByEmail = new Map<string, PersonLike>();
    for (const d of directory) {
      if (d.status && d.status !== "active" && d.status !== "joined") continue;
      if (d.user_id) empByUser.set(d.user_id, d);
      if (d.email) empByEmail.set(String(d.email).toLowerCase(), d);
    }
    const statusForUser = (userId: string | null | undefined): WorkStatus | null => {
      if (!userId) return null;
      const u = usersById.get(userId) as any;
      const emp = empByUser.get(userId) || (u?.email ? empByEmail.get(String(u.email).toLowerCase()) : undefined);
      return statusOf(emp ? { ...emp, user_id: userId } : { user_id: userId, email: u?.email });
    };
    return { statusOf, statusForUser, presenceOf, companyUsers };
  }, [companyUsers, workToday, workCfg, holidayToday, todayStr, nowMin, directory]);
}

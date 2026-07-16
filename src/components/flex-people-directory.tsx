"use client";
import { logRead } from "@/lib/log-read";

// 플렉스(flex.team) 스타일 구성원 디렉토리 (2026-06-12).
//   아바타 카드 그리드/리스트 + 팀·상태 필터 + 클릭 시 우측 프로필 슬라이드 패널
//   (인사정보 · 연차 잔여 · 이번 주 근무 · 바로가기). 읽기 전용 — 추가/수정은 기존 관리 화면.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { EmployeeDetailPanel } from "@/app/(app)/employees/_components/EmployeeDetailPanel";

const db = supabase as any;

type Emp = {
  id: string; name: string; email?: string | null; phone?: string | null;
  department?: string | null; position?: string | null; job_title?: string | null;
  employment_type?: string | null; employee_number?: string | null;
  hire_date?: string | null; status?: string | null; user_id?: string | null;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "재직", color: "var(--success)", bg: "var(--success-dim)" },
  joined: { label: "재직", color: "var(--success)", bg: "var(--success-dim)" },
  invited: { label: "초대됨", color: "var(--warning)", bg: "var(--warning-dim)" },
  contract_pending: { label: "계약 대기", color: "var(--info)", bg: "var(--info-dim)" },
  resigned: { label: "퇴사", color: "var(--text-dim)", bg: "var(--bg-surface)" },
  inactive: { label: "비활성", color: "var(--text-dim)", bg: "var(--bg-surface)" },
};
const statusMeta = (s?: string | null) => STATUS_META[String(s || "")] || { label: s || "—", color: "var(--text-dim)", bg: "var(--bg-surface)" };

function avatarColor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const palette = ["#6C5CE7", "#0984E3", "#00B894", "#E17055", "#00CEC9", "#A29BFE", "#FF7675", "#55A3FF"];
  return palette[Math.abs(h) % palette.length];
}
const initials = (name: string) => (/[가-힣]/.test(name) ? name.slice(-2) : name.slice(0, 2).toUpperCase());

// 근속: N년 N개월
function tenure(hire?: string | null): string {
  if (!hire) return "—";
  const h = new Date(hire);
  if (isNaN(h.getTime())) return "—";
  const now = new Date();
  let months = (now.getFullYear() - h.getFullYear()) * 12 + (now.getMonth() - h.getMonth());
  if (now.getDate() < h.getDate()) months -= 1;
  months = Math.max(0, months);
  const y = Math.floor(months / 12), m = months % 12;
  return y > 0 ? `${y}년 ${m}개월` : `${m}개월`;
}

const kstYmd = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
};

export function FlexPeopleDirectory({ companyId, employees, isManager }: {
  companyId: string; employees: Emp[]; isManager: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("");
  const [statusF, setStatusF] = useState<"active" | "all" | "left">("active");
  const [view, setView] = useState<"card" | "list">("card");
  const [sel, setSel] = useState<Emp | null>(null);
  const [contractsEmpId, setContractsEmpId] = useState<string | null>(null);

  const depts = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))] as string[], [employees]);

  // 프로필 사진 — 마이페이지에서 설정한 users.avatar_url 을 회사 단위로 조회해
  //   employees 행과 user_id(우선) 또는 email 로 매칭. 없으면 기존 이니셜 원형 유지.
  const { data: userAvatars = [] } = useQuery<{ id: string; email: string | null; avatar_url: string | null }[]>({
    queryKey: ["company-user-avatars", companyId],
    queryFn: async () => {
      const data = logRead('components/flex-people-directory:data', await db.from("users").select("id, email, avatar_url").eq("company_id", companyId));
      return data || [];
    },
    enabled: !!companyId,
  });
  const avatarSrc = useMemo(() => {
    const byId: Record<string, string> = {};
    const byEmail: Record<string, string> = {};
    for (const u of userAvatars) {
      if (!u.avatar_url) continue;
      byId[u.id] = u.avatar_url;
      if (u.email) byEmail[u.email.toLowerCase()] = u.avatar_url;
    }
    return (e: Emp) => (e.user_id && byId[e.user_id]) || (e.email && byEmail[e.email.toLowerCase()]) || null;
  }, [userAvatars]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      const left = ["resigned", "inactive"].includes(String(e.status || ""));
      if (statusF === "active" && left) return false;
      if (statusF === "left" && !left) return false;
      if (dept && e.department !== dept) return false;
      if (q && !`${e.name} ${e.department || ""} ${e.position || ""} ${e.email || ""}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [employees, search, dept, statusF]);

  return (
    <div className="flex-people-directory">
      {/* ── 필터 바 ── */}
      <div className="flex-people-filter-bar glass-card">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·팀·직책 검색"
            className="pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] w-52 focus:outline-none focus:border-[var(--primary)]" />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] cursor-pointer">
          <option value="">팀 전체</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="seg-bar">
          {([["active", "재직"], ["all", "전체"], ["left", "퇴사"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setStatusF(k)}
              className={`seg-item ${statusF === k ? "seg-item-active" : ""}`}>{l}</button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--text-dim)]">{shown.length}명</span>
        <div className="ml-auto seg-bar">
          {([["card", "카드"], ["list", "리스트"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`seg-item ${view === k ? "seg-item-active" : ""}`}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── 카드 그리드 ── */}
      {view === "card" ? (
        <div className="flex-people-card-grid">
          {shown.length === 0 && <div className="col-span-full glass-card p-12 text-center text-sm text-[var(--text-muted)]">조건에 맞는 구성원이 없습니다.</div>}
          {shown.map((e) => {
            const sm = statusMeta(e.status);
            return (
              <button key={e.id} onClick={() => setSel(e)}
                className="flex-people-card glass-card group">
                <div className="flex items-center gap-3">
                  {avatarSrc(e) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarSrc(e)!} alt={e.name} className="w-12 h-12 rounded-2xl object-cover shrink-0" />
                  ) : (
                    <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-[15px] font-bold text-white shrink-0" style={{ background: avatarColor(e.id) }}>
                      {initials(e.name)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[14px] font-bold text-[var(--text)] truncate group-hover:text-[var(--primary)]">{e.name}</span>
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
                    </span>
                    <span className="block text-[11px] text-[var(--text-muted)] truncate mt-0.5">{[e.job_title || e.position, e.department].filter(Boolean).join(" · ") || "직책 미지정"}</span>
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border)]/60 flex items-center justify-between text-[10px] text-[var(--text-dim)]">
                  <span>입사 {e.hire_date || "—"}</span>
                  <span className="font-semibold text-[var(--text-muted)]">근속 {tenure(e.hire_date)}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        /* ── 리스트 ── */
        <div className="flex-people-list glass-card">
          <table className="w-full text-xs">
            <thead className="text-xs text-[var(--text-dim)]">
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-4 py-2.5 font-semibold">이름</th>
                <th className="text-left px-4 py-2.5 font-semibold">팀</th>
                <th className="text-left px-4 py-2.5 font-semibold">직책</th>
                <th className="text-left px-4 py-2.5 font-semibold">입사일</th>
                <th className="text-left px-4 py-2.5 font-semibold">근속</th>
                <th className="text-center px-4 py-2.5 font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const sm = statusMeta(e.status);
                return (
                  <tr key={e.id} onClick={() => setSel(e)} className="flex-people-list-row">
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        {avatarSrc(e) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarSrc(e)!} alt={e.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(e.id) }}>{initials(e.name)}</span>
                        )}
                        <span className="font-semibold text-[var(--text)]">{e.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{e.department || "—"}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{e.job_title || e.position || "—"}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)] mono-number">{e.hire_date || "—"}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{tenure(e.hire_date)}</td>
                    <td className="px-4 py-2 text-center"><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <div className="p-12 text-center text-sm text-[var(--text-muted)]">조건에 맞는 구성원이 없습니다.</div>}
        </div>
      )}

      {/* ── 프로필 슬라이드 패널 ── */}
      {sel && (
        <ProfilePanel
          companyId={companyId}
          emp={sel}
          avatarUrl={avatarSrc(sel)}
          isManager={isManager}
          onClose={() => setSel(null)}
          onOpenContracts={(id) => { setSel(null); setContractsEmpId(id); }}
        />
      )}

      {/* ── 직원 상세(계약서 탭) — 디렉토리에서 "계약서" 클릭 시 ── */}
      {contractsEmpId && (
        <div className="flex-people-contracts-modal-backdrop fixed inset-0" onClick={() => setContractsEmpId(null)}>
          <div className="w-full max-w-5xl my-6" onClick={(e) => e.stopPropagation()}>
            <EmployeeDetailPanel employeeId={contractsEmpId} companyId={companyId} initialTab="contracts" onClose={() => setContractsEmpId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfilePanel({ companyId, emp, avatarUrl, isManager, onClose, onOpenContracts }: { companyId: string; emp: Emp; avatarUrl?: string | null; isManager: boolean; onClose: () => void; onOpenContracts: (employeeId: string) => void }) {
  const sm = statusMeta(emp.status);
  const year = new Date().getFullYear();

  // ESC 닫기 — 읽기 전용 프로필 패널(수정 없음, 링크만 있어 Enter 확인 액션 없음)
  useModalKeys(true, onClose);

  // 연차 잔여 (leave_balances 올해)
  const { data: leave } = useQuery<{ total: number; used: number; remaining: number } | null>({
    queryKey: ["flex-profile-leave", emp.id, year],
    queryFn: async () => {
      const data = logRead('components/flex-people-directory:data', await db.from("leave_balances").select("total_days, used_days, remaining_days")
        .eq("employee_id", emp.id).eq("year", year).maybeSingle());
      if (!data) return null;
      const total = Number(data.total_days || 0), used = Number(data.used_days || 0);
      return { total, used, remaining: data.remaining_days != null ? Number(data.remaining_days) : Math.max(0, total - used) };
    },
  });

  // 이번 주 근무 (월~오늘)
  const { data: weekMin = 0 } = useQuery<number>({
    queryKey: ["flex-profile-week", emp.id],
    queryFn: async () => {
      const now = new Date(Date.now() + 9 * 3600 * 1000);
      const today = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const monday = new Date(today); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const data = logRead('components/flex-people-directory:data', await db.from("attendance_records")
        .select("regular_minutes, overtime_minutes, work_hours")
        .eq("company_id", companyId).eq("employee_id", emp.id)
        .gte("date", kstYmd(new Date(monday.getTime() - 9 * 3600 * 1000)))
        .lte("date", kstYmd(new Date(today.getTime() - 9 * 3600 * 1000))));
      return ((data || []) as any[]).reduce((s, a) => {
        const m = Number(a.regular_minutes || 0) + Number(a.overtime_minutes || 0);
        return s + (m > 0 ? m : Math.round(Number(a.work_hours || 0) * 60));
      }, 0);
    },
  });

  const hm = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h}h ${m}m` : `${h}h`; };
  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border)]/50">
      <span className="text-[11px] text-[var(--text-dim)]">{label}</span>
      <span className="text-[12px] font-semibold text-[var(--text)] text-right truncate max-w-[60%]">{value}</span>
    </div>
  );

  return (
    <div className="flex-people-profile-backdrop fixed inset-0" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="flex-people-profile-panel" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex-people-profile-header">
          <button onClick={onClose} className="absolute top-4 right-4 text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={emp.name} className="inline-block w-20 h-20 rounded-3xl object-cover" />
          ) : (
            <span className="inline-flex w-20 h-20 rounded-3xl items-center justify-center text-2xl font-bold text-white" style={{ background: avatarColor(emp.id) }}>
              {initials(emp.name)}
            </span>
          )}
          <div className="mt-3 text-lg font-bold text-[var(--text)]">{emp.name}</div>
          <div className="text-[12px] text-[var(--text-muted)] mt-0.5">{[emp.job_title || emp.position, emp.department].filter(Boolean).join(" · ") || "직책 미지정"}</div>
          <span className="inline-block mt-2 text-[10px] px-2.5 py-1 rounded-full font-bold" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
        </div>

        {/* 핵심 지표 2 */}
        <div className="flex-people-profile-metrics">
          <div className="flex-people-metric-work">
            <div className="text-[10px] font-semibold text-[var(--primary)]">이번 주 근무</div>
            <div className="text-lg font-bold mono-number text-[var(--text)] mt-0.5">{hm(weekMin)}</div>
          </div>
          <div className="flex-people-metric-leave">
            <div className="text-[10px] font-semibold text-[var(--success)]">연차 잔여</div>
            <div className="text-lg font-bold mono-number text-[var(--text)] mt-0.5">
              {leave ? `${leave.remaining}일` : "—"}
              {leave && <span className="text-[10px] font-semibold text-[var(--text-dim)]"> / {leave.total}일</span>}
            </div>
          </div>
        </div>

        {/* 인사 정보 */}
        <div className="flex-people-profile-info">
          <div className="text-[11px] font-bold text-[var(--text-muted)] mb-1">인사 정보</div>
          <InfoRow label="이메일" value={emp.email || "—"} />
          <InfoRow label="연락처" value={emp.phone || "—"} />
          <InfoRow label="입사일" value={emp.hire_date || "—"} />
          <InfoRow label="근속" value={tenure(emp.hire_date)} />
          <InfoRow label="고용형태" value={emp.employment_type || "—"} />
          {emp.employee_number && <InfoRow label="사번" value={emp.employee_number} />}
        </div>

        {/* 바로가기 */}
        <div className="flex-people-profile-shortcuts">
          <Link href="/attendance" className="block w-full text-center px-4 py-2.5 rounded-xl text-xs font-bold text-white transition hover:brightness-110 bg-[var(--primary)]">
            근태 기록 보기
          </Link>
          {isManager && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onOpenContracts(emp.id)} className="text-center px-3 py-2 rounded-xl text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]">계약서</button>
              <Link href="/employees?tab=payroll" className="text-center px-3 py-2 rounded-xl text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]">급여명세</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

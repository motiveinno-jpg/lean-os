"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 사용자 관리 — 전체 회원 검색 + 계정 지원 액션 (비밀번호/재설정링크/이메일/역할/잠금)
// 고객 전화 응대 흐름: 이메일·이름으로 검색 → 행 펼침 → 즉시 조치. 모든 액션은 감사 기록됨.
// 운영자 페이지 v2 (2026-09-03): 역할 구성 도넛·회사별 상위 막대 + 목록. 조회·필터·액션은 종전 그대로.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PlatformMemberActions, PLATFORM_ROLE_META } from "@/components/platform-member-actions";
import { OpsSearch, exportCsv } from "../_components/ops-kit";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSeg, PfSkeleton, PfEmpty } from "@/app/platform/_components/pf/ui";
import { PfDonut, PfBars } from "@/app/platform/_components/pf/charts";

const db = supabase;

type MemberRow = {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  company_id: string | null;
  created_at: string | null;
  companies: { name: string | null } | null;
};

const ROLE_FILTERS = [
  { value: "all", label: "전체" },
  { value: "owner", label: "대표" },
  { value: "admin", label: "관리자" },
  { value: "employee", label: "직원" },
  { value: "partner", label: "파트너" },
];

const ROLE_TONE: Record<string, "info" | "ok" | "muted" | "warn"> = { owner: "info", admin: "ok", employee: "muted", partner: "warn" };

export default function PlatformMembersPage() {
  const qc = useQueryClient();
  // 시스템 화면 등에서 ?q=이메일 로 넘어오면 검색어 프리필 (마운트 시 1회).
  //   전체 클라이언트 렌더 화면이라 window 직접 접근 — useSearchParams 의 Suspense 요구 회피.
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [roleFilter, setRoleFilter] = useState("all");
  // 회사별 보기 (2026-07-28 사장님 요청)
  const [companyFilter, setCompanyFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: members = [], isLoading } = useQuery<MemberRow[]>({
    queryKey: ["p-members"],
    queryFn: async () => {
      const data = logRead("platform/members:data", await db
        .from("users")
        .select("id, name, email, role, company_id, created_at, companies(name)")
        .order("created_at", { ascending: false }));
      return (data || []) as MemberRow[];
    },
    refetchInterval: 60_000,
  });

  const companyOptions = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => { if (m.company_id && m.companies?.name) map.set(m.company_id, m.companies.name); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  }, [members]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (companyFilter === "none" && m.company_id) return false;
      if (companyFilter !== "all" && companyFilter !== "none" && m.company_id !== companyFilter) return false;
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (!q) return true;
      return (
        m.email.toLowerCase().includes(q) ||
        (m.name || "").toLowerCase().includes(q) ||
        (m.companies?.name || "").toLowerCase().includes(q)
      );
    });
  }, [members, search, roleFilter, companyFilter]);

  // 요약 — 역할 구성, 회사별 인원 상위 6, 이번 달 가입, 무소속
  const summary = useMemo(() => {
    const roles = new Map<string, number>();
    const byCompany = new Map<string, number>();
    let orphan = 0;
    const ym = new Date().toISOString().slice(0, 7);
    let newThisMonth = 0;
    for (const m of members) {
      const r = PLATFORM_ROLE_META[m.role || ""] ? (m.role as string) : "employee";
      roles.set(r, (roles.get(r) || 0) + 1);
      if (!m.company_id) orphan += 1;
      else { const name = m.companies?.name || "이름 없음"; byCompany.set(name, (byCompany.get(name) || 0) + 1); }
      if ((m.created_at || "").slice(0, 7) === ym) newThisMonth += 1;
    }
    const roleOrder = ["owner", "admin", "employee", "partner"];
    return {
      roles: roleOrder.filter((r) => roles.has(r)).map((r) => ({ label: PLATFORM_ROLE_META[r].label, value: roles.get(r) || 0 })),
      top: [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name: name.length > 10 ? `${name.slice(0, 10)}…` : name, n })),
      orphan, newThisMonth,
    };
  }, [members]);

  return (
    <PfPage>
      <PfPageHead
        eyebrow="고객"
        title="사용자 관리"
        desc="오너뷰에 가입한 모든 계정입니다. 이름·이메일로 찾아 행을 펼치면 비밀번호 재설정, 이메일 변경, 잠금, 역할 변경을 바로 할 수 있고, 모든 조치는 기록으로 남습니다."
        actions={
          <>
            <OpsSearch value={search} onChange={setSearch} placeholder="이름·이메일·회사 검색" />
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="platform-feed-company-select"
              title="회사별로 보기"
            >
              <option value="all">전체 회사</option>
              <option value="none">무소속</option>
              {companyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <PfSeg value={roleFilter} onChange={setRoleFilter} options={ROLE_FILTERS} />
            <button
              type="button"
              className="pf-btn"
              disabled={filtered.length === 0}
              title="현재 목록을 엑셀(CSV)로 저장"
              onClick={() => exportCsv(filtered.map((m) => ({
                이름: m.name || "", 이메일: m.email,
                역할: (PLATFORM_ROLE_META[m.role || ""] || PLATFORM_ROLE_META.employee).label,
                회사: m.companies?.name || "무소속",
                가입일: m.created_at ? kstDateStr(new Date(m.created_at)) : "",
              })), "사용자목록")}
            >
              ⬇ 내보내기
            </button>
          </>
        }
      />

      <div className="pf-kpi-grid">
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 1 }}><PfKpi label="전체 사용자" value={members.length} unit="명" accent /></div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 2 }}><PfKpi label="이번 달 가입" value={summary.newThisMonth} unit="명" /></div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 3 }}><PfKpi label="회사 없는 계정" value={summary.orphan} unit="명" /></div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 4 }}><PfKpi label="지금 표시 중" value={filtered.length} unit="명" /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PfCard i={5}>
          <PfCardHead title="역할 구성" sub="대표·관리자·직원·파트너가 몇 명씩인지" />
          <PfCardBody>
            {isLoading ? <PfSkeleton rows={4} h={18} /> : <PfDonut slices={summary.roles} size={170} centerLabel="전체" />}
          </PfCardBody>
        </PfCard>
        <PfCard i={6}>
          <PfCardHead title="회사별 인원 상위" sub="사용자가 많은 회사 6곳" />
          <PfCardBody>
            {isLoading ? <PfSkeleton rows={4} h={18} /> : <PfBars data={summary.top} series={[{ key: "n", label: "사용자 수" }]} height={190} horizontal />}
          </PfCardBody>
        </PfCard>
      </div>

      <PfCard i={7} hover={false}>
        <PfCardHead title="사용자 목록" sub={`${filtered.length}명 — 행을 누르면 계정 지원 조치가 펼쳐집니다`} />
        {isLoading ? (
          <div className="px-5 pb-5"><PfSkeleton rows={6} h={16} /></div>
        ) : filtered.length === 0 ? (
          <PfEmpty>검색 결과가 없습니다</PfEmpty>
        ) : (
          <div className="pf-rows">
            {filtered.map((m) => {
              const role = PLATFORM_ROLE_META[m.role || ""] || PLATFORM_ROLE_META.employee;
              const open = expandedId === m.id;
              return (
                <div key={m.id}>
                  <button type="button" onClick={() => setExpandedId(open ? null : m.id)} className="pf-row w-full text-left">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: "linear-gradient(135deg, var(--primary), #7C3AED)" }}>
                      {(m.name || m.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="pf-row-title">{m.name || "(이름 없음)"}</div>
                      <div className="pf-row-sub">{m.email}</div>
                    </div>
                    <span className="hidden sm:block text-[11px] text-[var(--text-muted)] max-w-[160px] truncate">{m.companies?.name || "무소속"}</span>
                    <PfBadge tone={ROLE_TONE[m.role || ""] || "muted"}>{role.label}</PfBadge>
                    <svg className={`w-4 h-4 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>

                  {open && (
                    <div className="platform-member-panel-wrap">
                      <PlatformMemberActions
                        member={m}
                        onChanged={() => qc.invalidateQueries({ queryKey: ["p-members"] })}
                      />
                      <div className="text-[11px] text-[var(--text-dim)] px-5 pb-4">
                        {m.company_id && (
                          <Link href={`/platform/companies/${m.company_id}`} className="pf-card-action">소속 회사 상세 →</Link>
                        )}
                        <span className="ml-2">가입 {m.created_at ? kstDateStr(new Date(m.created_at)) : "—"}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PfCard>
    </PfPage>
  );
}

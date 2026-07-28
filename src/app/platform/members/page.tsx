"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 사용자 관리 — 전체 회원 검색 + 계정 지원 액션 (비밀번호/재설정링크/이메일/역할/잠금)
// 고객 전화 응대 흐름: 이메일·이름으로 검색 → 행 펼침 → 즉시 조치. 모든 액션은 감사 기록됨.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PlatformMemberActions, PLATFORM_ROLE_META } from "@/components/platform-member-actions";
import { OpsPageHeader, OpsSearch, OpsExportButton, exportCsv } from "../_components/ops-kit";

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
  { key: "all", label: "전체" },
  { key: "owner", label: "대표" },
  { key: "admin", label: "관리자" },
  { key: "employee", label: "직원" },
  { key: "partner", label: "파트너" },
];

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

  return (
    <div className="max-w-6xl space-y-6">
      <OpsPageHeader title="사용자 관리" sub="계정 지원 — 비밀번호 재설정 · 이메일 변경 · 잠금 · 역할 · 1분마다 자동 갱신">
        <div className="flex flex-wrap items-center gap-2">
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
          <OpsExportButton
            disabled={filtered.length === 0}
            onClick={() => exportCsv(filtered.map((m) => ({
              이름: m.name || "", 이메일: m.email,
              역할: (PLATFORM_ROLE_META[m.role || ""] || PLATFORM_ROLE_META.employee).label,
              회사: m.companies?.name || "무소속",
              가입일: m.created_at ? kstDateStr(new Date(m.created_at)) : "",
            })), "사용자목록")}
          />
          <div className="seg-bar">
            {ROLE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setRoleFilter(f.key)}
                className={`seg-item ${roleFilter === f.key ? "seg-item-active" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </OpsPageHeader>

      <div className="text-xs text-[var(--text-dim)]">{filtered.length}명</div>

      <div className="platform-members-list glass-card">
        {isLoading ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">검색 결과가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((m) => {
              const role = PLATFORM_ROLE_META[m.role || ""] || PLATFORM_ROLE_META.employee;
              const open = expandedId === m.id;
              return (
                <div key={m.id}>
                  <button
                    onClick={() => setExpandedId(open ? null : m.id)}
                    className="platform-member-row"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {(m.name || m.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="font-semibold text-sm text-[var(--text)] truncate">{m.name || "(이름 없음)"}</div>
                        <div className="text-xs text-[var(--text-dim)] truncate">{m.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="hidden sm:block text-xs text-[var(--text-muted)] max-w-[140px] truncate">
                        {m.companies?.name || "—"}
                      </span>
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${role.cls}`}>{role.label}</span>
                      <svg className={`w-4 h-4 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </button>

                  {open && (
                    <div className="platform-member-panel-wrap">
                      <PlatformMemberActions
                        member={m}
                        onChanged={() => qc.invalidateQueries({ queryKey: ["p-members"] })}
                      />
                      <div className="text-[11px] text-[var(--text-dim)] px-5 pb-4">
                        {m.company_id && (
                          <Link href={`/platform/companies/${m.company_id}`} className="text-[var(--primary)] hover:underline">
                            소속 회사 상세 →
                          </Link>
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
      </div>
    </div>
  );
}

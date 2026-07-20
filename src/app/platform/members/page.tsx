"use client";
import { logRead } from "@/lib/log-read";

// 사용자 관리 — 전체 회원 검색 + 계정 지원 액션 (비밀번호/재설정링크/이메일/역할/잠금)
// 고객 전화 응대 흐름: 이메일·이름으로 검색 → 행 펼침 → 즉시 조치. 모든 액션은 감사 기록됨.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PlatformMemberActions, PLATFORM_ROLE_META } from "@/components/platform-member-actions";

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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
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
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (!q) return true;
      return (
        m.email.toLowerCase().includes(q) ||
        (m.name || "").toLowerCase().includes(q) ||
        (m.companies?.name || "").toLowerCase().includes(q)
      );
    });
  }, [members, search, roleFilter]);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="platform-members-toolbar">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">사용자 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">계정 지원 — 비밀번호 재설정 · 이메일 변경 · 잠금 · 역할</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·이메일·회사 검색..."
            className="field-input max-w-sm"
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
      </div>

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
                        <span className="ml-2">가입 {m.created_at ? new Date(m.created_at).toLocaleDateString("ko-KR") : "—"}</span>
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

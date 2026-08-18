"use client";

import { useMemo, useState } from "react";
import { QueryBar, QuickSearch, quickSearchHit } from "@/components/query-kit";
import { Ico } from "@/components/ui-icon";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

// 직원용 구성원 디렉토리 — 읽기 전용. 누가 어느 부서/직책에 있는지만 보여준다.
export default function TeamPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const [search, setSearch] = useState("");

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["team-directory", companyId],
    queryFn: async () => {
      // 회사 격리는 서버(RPC 내부 get_my_company_id())가 강제 — 클라이언트에서 company_id 전달 안 함.
      // RPC는 salary 등 민감 컬럼을 일절 반환하지 않는 안전 디렉토리 뷰.
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return (data ?? [])
        .filter((e) => e.status === "active" || e.status === "joined")
        .sort(
          (a, b) =>
            (a.department || "").localeCompare(b.department || "") ||
            (a.name || "").localeCompare(b.name || ""),
        );
    },
    enabled: !!companyId,
  });

  const filtered = useMemo(() => {
    return employees.filter((e) => quickSearchHit(search, [e.name, e.department, e.position, e.email]));
  }, [employees, search]);

  const byDept = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    filtered.forEach((e) => {
      const key = e.department || "미배정";
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return groups;
  }, [filtered]);

  if (!companyId) {
    return (
      <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>
    );
  }

  return (
    <div>
      {/* 조회 줄 — 디렉토리는 카드(D형)라 검색 줄만 표준 부품으로 (2026-08-18 Wave 3) */}
      <div className="mb-6">
        <QueryBar right={<span className="text-xs text-[var(--text-muted)]">총 {employees.length}명</span>}>
          <QuickSearch value={search} onApply={setSearch} placeholder="이름 · 부서 · 직책 — 쉼표로 여러 개, Enter" />
        </QueryBar>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card py-16 text-center">
          <div className="text-4xl mb-3"><Ico e="👥" /></div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {search ? "검색 결과가 없습니다" : "등록된 구성원이 없습니다"}
          </div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1.5">
            {search ? "다른 키워드로 검색해보세요." : "구성원이 등록되면 여기에 표시됩니다."}
          </div>
          {!search && role !== "employee" && (
            <Link href="/employees" className="btn-secondary mt-4">직원 관리로 →</Link>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byDept).map(([dept, list]) => (
            <div key={dept}>
              <h3 className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-3">
                {dept} <span className="text-[var(--text-muted)] font-normal">· {list.length}명</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((e) => (
                  <div
                    key={e.id}
                    className="glass-card p-5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-bold flex items-center justify-center shrink-0">
                        {(e.name || "?").slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">{e.name || "—"}</div>
                        <div className="text-xs text-[var(--text-muted)] truncate">
                          {e.position || "—"}
                        </div>
                        {e.email && (
                          <div className="text-[11px] text-[var(--text-dim)] truncate mt-1.5">
                            <Ico e="✉" /> {e.email}
                          </div>
                        )}
                        {e.phone && (
                          <div className="text-[11px] text-[var(--text-dim)] truncate">
                            <Ico e="📞" /> {e.phone}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

// 직원용 구성원 디렉토리 — 읽기 전용. 누가 어느 부서/직책에 있는지만 보여준다.
export default function TeamPage() {
  const { user } = useUser();
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
    if (!search.trim()) return employees;
    const q = search.trim().toLowerCase();
    return employees.filter((e) =>
      [e.name, e.department, e.position, e.email].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
    );
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
      <div className="page-sticky-header mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">구성원</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            팀에 어떤 동료가 있는지 확인하세요. 총 {employees.length}명
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름·부서·직책으로 검색"
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] w-full sm:w-72"
        />
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center text-sm text-[var(--text-muted)]">
          {search ? "검색 결과가 없습니다" : "등록된 구성원이 없습니다"}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byDept).map(([dept, list]) => (
            <div key={dept}>
              <h3 className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-3">
                {dept} <span className="text-[var(--text-muted)] font-normal">· {list.length}명</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((e) => (
                  <div
                    key={e.id}
                    className="glass-card p-4 hover:border-[var(--primary)]/30 transition"
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
                            ✉️ {e.email}
                          </div>
                        )}
                        {e.phone && (
                          <div className="text-[11px] text-[var(--text-dim)] truncate">
                            📞 {e.phone}
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

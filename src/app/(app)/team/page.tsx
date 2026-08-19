"use client";

import { useMemo, useState } from "react";
import { QueryScreen, QueryHead, QueryBody, QueryBar, QuickSearch, quickSearchHit, ChipGroup, ConditionPanel, ConditionRow, AppliedChips, ResultStrip, Stat, Pager, usePager, type AppliedChip } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { Ico } from "@/components/ui-icon";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

// 직원용 구성원 디렉토리 — 읽기 전용. 누가 어느 부서/직책에 있는지만 보여준다.
//   2026-08-19 조회 화면 표준(인사 메뉴 점검): 상자 + [검색조건(부서) · 빠른검색 · 보기 칩(리스트/카드) ‖ 인원] + 표(정렬) + 쪽. 카드는 보기 옵션.
//   예전엔 상자 없이 부서별 유리 카드 격자만 있었다.
export default function TeamPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "card">("list");
  const [depts, setDepts] = useState<string[]>([]);
  const [draftDepts, setDraftDepts] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  type SK = "name" | "department" | "position" | "email";
  const [sort, setSort] = useState<SortState<SK>>({ key: "department", dir: "asc" });

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["team-directory", companyId],
    queryFn: async () => {
      // 회사 격리는 서버(RPC 내부 get_my_company_id())가 강제 — 클라이언트에서 company_id 전달 안 함.
      // RPC는 salary 등 민감 컬럼을 일절 반환하지 않는 안전 디렉토리 뷰.
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return (data ?? []).filter((e) => e.status === "active" || e.status === "joined");
    },
    enabled: !!companyId,
  });
  const allDepts = useMemo(() => [...new Set(employees.map((e) => e.department || "미배정"))].sort(), [employees]);

  const filtered = useMemo(() => {
    const rows = employees.filter((e) => quickSearchHit(search, [e.name, e.department, e.position, e.email, e.phone]) && (depts.length === 0 || depts.includes(e.department || "미배정")));
    const k = sort.key;
    return [...rows].sort((a, b) => (cmp((a as any)[k] || "", (b as any)[k] || "") * (sort.dir === "asc" ? 1 : -1)) || (a.name || "").localeCompare(b.name || ""));
  }, [employees, search, depts, sort]);
  const pager = usePager(filtered, 50, `${search}|${depts.join()}|${sort.key}${sort.dir}`);

  if (!companyId) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;

  const chips: AppliedChip[] = [
    ...(depts.length ? [{ group: "부서", label: depts.join(" · "), onRemove: () => { setDepts([]); setDraftDepts([]); } }] : []),
    ...(search ? [{ group: "빠른검색", label: search, onRemove: () => setSearch("") }] : []),
  ];
  const onSort = (key: SK) => setSort((s: SortState<SK>) => nextSort(s, key));

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <QueryBar right={<span className="text-xs text-[var(--text-muted)]">총 {employees.length}명</span>}>
            <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setDraftDepts(depts); setPanelOpen(v); }} activeCount={depts.length ? 1 : 0}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setDraftDepts([])}>기본으로</button>
                <span className="ml-auto" />
                <button type="button" className="btn-primary btn-sm" onClick={() => { setDepts(draftDepts); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="부서" hint="여러 개">
                <span className="qk-quicks">{allDepts.map((d) => <button key={d} type="button" onClick={() => setDraftDepts((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])} className={draftDepts.includes(d) ? "qk-quick qk-quick-on" : "qk-quick"}>{d}</button>)}</span>
              </ConditionRow>
            </ConditionPanel>
            <QuickSearch value={search} onApply={setSearch} placeholder="이름 · 부서 · 직책 · 이메일 · 연락처 — 쉼표로 여러 개, Enter" />
            <ChipGroup value={view} onChange={setView} options={[{ value: "list", label: "리스트" }, { value: "card", label: "카드" }] as const} />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={() => { setDepts([]); setDraftDepts([]); setSearch(""); }} />
          <ResultStrip>
            <Stat label="표시" value={`${filtered.length}명`} />
            <Stat label="부서" value={`${new Set(filtered.map((e) => e.department || "미배정")).size}개`} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          <div className="team-scroll">
            {isLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div className="collect-empty">
                {search || depts.length ? "조건에 맞는 구성원이 없습니다" : "등록된 구성원이 없습니다 — 구성원이 등록되면 여기에 표시됩니다"}
                {!search && !depts.length && role !== "employee" && <> · <Link href="/employees" className="bz-link">직원 관리로 →</Link></>}
              </div>
            ) : view === "list" ? (
              <>
                <table className="ev-table ev-lined team-table">
                  <thead>
                    <tr>
                      <SortableTh label="이름" sortKey="name" sort={sort} onSort={onSort} />
                      <SortableTh label="부서" sortKey="department" sort={sort} onSort={onSort} />
                      <SortableTh label="직책" sortKey="position" sort={sort} onSort={onSort} />
                      <SortableTh label="이메일" sortKey="email" sort={sort} onSort={onSort} />
                      <th>연락처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.view.map((e) => (
                      <tr key={e.id}>
                        <td className="text-left"><span className="team-avatar">{(e.name || "?").slice(0, 1)}</span><b>{e.name || "—"}</b></td>
                        <td className="text-center">{e.department || <span className="text-[var(--text-dim)]">미배정</span>}</td>
                        <td className="text-center">{e.position || "—"}</td>
                        <td className="text-left">{e.email ? <a href={`mailto:${e.email}`} className="bz-link font-normal">{e.email}</a> : "—"}</td>
                        <td className="text-center mono-number">{e.phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pager page={pager.page} pages={pager.pages} total={filtered.length} from={pager.from} to={pager.to} size={50} onPage={pager.setPage} />
              </>
            ) : (
              <div className="team-cards">
                {pager.view.map((e) => (
                  <div key={e.id} className="team-card">
                    <span className="team-avatar team-avatar-lg">{(e.name || "?").slice(0, 1)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate">{e.name || "—"}</div>
                      <div className="text-xs text-[var(--text-muted)] truncate">{[e.department, e.position].filter(Boolean).join(" · ") || "—"}</div>
                      {e.email && <div className="text-[11px] text-[var(--text-dim)] truncate mt-1"><Ico e="✉" /> {e.email}</div>}
                      {e.phone && <div className="text-[11px] text-[var(--text-dim)] truncate"><Ico e="📞" /> {e.phone}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}

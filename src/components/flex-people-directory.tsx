"use client";
import { comparePeople, compareByName } from "@/lib/people-sort";
import { formatPhone } from "@/lib/phone";
import { logRead } from "@/lib/log-read";

// 플렉스(flex.team) 스타일 구성원 디렉토리 (2026-06-12).
//   아바타 카드 그리드/리스트 + 클릭 시 우측 프로필 슬라이드 패널
//   (인사정보 · 연차 잔여 · 이번 주 근무 · 바로가기). 읽기 전용 — 추가/수정은 기존 관리 화면.
//   2026-08-18 조회 화면 표준(query-kit)으로 갈아탐 — 팀 select·재직/전체/퇴사 세그먼트 → 검색조건 패널,
//   검색 칸 → 빠른검색, 리스트 표 → SortableTh(정렬·≡·너비)·쪽. 카드/리스트는 보기 칩.

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ConditionPanel, ConditionRow, TokenField, ChipGroup, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, RowsPerPage, Pager, usePager, type TokenItem, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { EmployeeDetailPanel } from "@/app/(app)/employees/_components/EmployeeDetailPanel";

const db = supabase;

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

type Cond = { dept: string[]; pos: string[]; status: string[]; etype: string[]; from: string; to: string; rows: number };
//   기본값 = 재직만 — 예전 세그먼트 기본값(재직)을 그대로 조건 칩으로 옮겼다. 칩 ✕ 로 풀면 전체.
const EMPTY_COND: Cond = { dept: [], pos: [], status: [], etype: [], from: "", to: "", rows: 50 };
const DEFAULT_COND: Cond = { ...EMPTY_COND, status: ["active"] };
const condCount = (c: Cond) => c.dept.length + c.pos.length + c.status.length + c.etype.length + ((c.from || c.to) ? 1 : 0);
//   상태 조건은 화면에 보이는 묶음으로 — 재직(active·joined) / 초대됨 / 계약 대기 / 퇴사·비활성
const STATUS_GROUPS: { key: string; label: string; raw: string[] }[] = [
  { key: "active", label: "재직", raw: ["active", "joined"] },
  { key: "invited", label: "초대됨", raw: ["invited"] },
  { key: "contract_pending", label: "계약 대기", raw: ["contract_pending"] },
  { key: "left", label: "퇴사·비활성", raw: ["resigned", "inactive"] },
];
const statusGroup = (s?: string | null) => STATUS_GROUPS.find((g) => g.raw.includes(String(s || "")))?.key || "";
const ETYPE_LABEL: Record<string, string> = { regular: "정규직", full_time: "정규직", fulltime: "정규직", contract: "계약직", temporary: "계약직", parttime: "파트타임", part_time: "파트타임", intern: "인턴", freelancer: "프리랜서", dispatch: "파견", daily: "일용직" };
const etypeLabel = (t?: string | null) => (t ? ETYPE_LABEL[t] || t : "");
type SortKey = "employee_number" | "name" | "department" | "position" | "etype" | "hire_date" | "phone" | "status";
const VIEW_OPTS = [{ value: "list", label: "리스트" }, { value: "card", label: "카드" }] as const;

/**
 * 구성원 디렉토리 — 조회 화면 표준(2026-08-18 Wave 4).
 *   상자 하나: 갈래 탭(부모가 준다) → [검색조건 ▾] 빠른검색 · 보기 칩 ‖ 초대 버튼 → 걸린 조건 칩 → 결과 요약 → 카드/표 → 쪽.
 *   예전 필터 바(검색·팀 select·재직/전체/퇴사 세그먼트·카드/리스트 세그먼트)는 전부 이 부품으로 대체.
 */
export function FlexPeopleDirectory({ companyId, employees, isManager, tabs, stats, actions, before }: {
  companyId: string; employees: Emp[]; isManager: boolean;
  /** 상자 맨 위 갈래 탭(인력관리·급여·휴가·증명서) — 부모 화면이 그린다 */
  tabs?: ReactNode;
  /** 결과 요약 줄에 앞세울 지표(재직 인원·연 인건비 …) */
  stats?: ReactNode;
  /** 조회 줄 오른쪽 실행 버튼(직원 초대 등) */
  actions?: ReactNode;
  /** 표 위에 끼워 넣을 것(초대 폼·초대 대기 목록) */
  before?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(DEFAULT_COND);
  const [live, setLive] = useState<Cond>(DEFAULT_COND);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  const [view, setView] = useState<"card" | "list">("list");   //   2026-08-19 사장님: 규칙대로 리스트가 기본
  const [sel, setSel] = useState<Emp | null>(null);
  //   2026-08-19 사장님: 구성원(인력관리)에서 이름을 누르면 약식 패널 없이 **바로 상세보기** — 대부분 상세로 들어가므로 한 단계 덜 누른다.
  //   약식 프로필 패널(ProfilePanel)은 디렉토리(/team, 관리자 아님)에서만 쓴다. 근태 기록·급여명세 링크는 사람별 화면이 아니라 빼도 겹친다(사장님: 중복이면 안 넣음).
  const openEmp = (e: Emp) => { if (isManager) setContractsEmpId(e.id); else setSel(e); };
  const [contractsEmpId, setContractsEmpId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "name", dir: "asc" });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("employees-dir-colw-v1", {
    name: 180, department: 120, position: 140, etype: 96, hire_date: 110, tenure: 96, phone: 130, email: 200, status: 96,
  });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });

  const depts = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))] as string[], [employees]);
  const positions = useMemo(() => [...new Set(employees.map((e) => e.job_title || e.position).filter(Boolean))] as string[], [employees]);
  const etypes = useMemo(() => [...new Set(employees.map((e) => e.employment_type).filter(Boolean))] as string[], [employees]);
  const toTokens = (xs: string[], lab?: (x: string) => string): TokenItem[] => xs.map((x) => ({ value: x, label: lab ? lab(x) : x }));

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

  const condHit = (e: Emp, c: Cond) => {
    if (c.status.length && !c.status.includes(statusGroup(e.status))) return false;
    if (c.dept.length && !c.dept.includes(e.department || "")) return false;
    if (c.pos.length && !c.pos.includes((e.job_title || e.position) || "")) return false;
    if (c.etype.length && !c.etype.includes(e.employment_type || "")) return false;
    if (c.from && (!e.hire_date || e.hire_date < c.from)) return false;
    if (c.to && (!e.hire_date || e.hire_date > c.to)) return false;
    return true;
  };
  //   머리단 ≡ 필터가 고를 칸 값 — 표에 보이는 글자 그대로
  const colVal = (e: Emp) => ({
    department: e.department || "—", position: e.job_title || e.position || "—", etype: etypeLabel(e.employment_type) || "—",
    status: statusMeta(e.status).label,
  });
  const base = useMemo(() => employees.filter((e) => condHit(e, live)
    && quickSearchHit(q, [e.name, e.department, e.job_title, e.position, e.email, e.phone, e.employee_number, etypeLabel(e.employment_type)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, live, q]);
  const shown = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (e: Emp): string => {
      switch (sort.key) {
        case "department": return e.department || "";
        case "position": return e.job_title || e.position || "";
        case "etype": return etypeLabel(e.employment_type);
        case "hire_date": return e.hire_date || "";
        case "phone": return e.phone || "";
        case "status": return statusMeta(e.status).label;
        default: return e.name;
      }
    };
    //   사번 정렬 = 사번 순 → 가나다 → ABC. 이름 정렬 = **이름 가나다 → ABC**(사번 무시) (2026-08-31 사장님:
    //   "이름으로 정렬해도 사번으로 정렬된다" 수정). 다른 칸은 그 칸 값 뒤 사번규칙으로 안정 정렬.
    if (sort.key === "employee_number") return base.filter((e) => cf.hit(colVal(e))).sort((a, b) => comparePeople(a, b) * dir);
    if (sort.key === "name") return base.filter((e) => cf.hit(colVal(e))).sort((a, b) => compareByName(a, b) * dir);
    return base.filter((e) => cf.hit(colVal(e))).sort((a, b) => cmp(val(a), val(b)) * dir || comparePeople(a, b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, sort, cf.key]);
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, base.map((e) => colVal(e)[k]));
  const previewCount = employees.filter((e) => condHit(e, draft)).length;
  const pager = usePager(shown, live.rows, `${q}|${JSON.stringify(live)}|${cf.key}|${view}`);

  const drop = (patch: Partial<Cond>) => { const n = { ...live, ...patch }; setLive(n); setDraft(n); };
  const clearAll = () => { setLive({ ...EMPTY_COND, rows: live.rows }); setDraft({ ...EMPTY_COND, rows: live.rows }); setQ(""); cf.clear(); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.status.map((v) => ({ group: "상태", label: STATUS_GROUPS.find((g) => g.key === v)?.label || v, onRemove: () => drop({ status: live.status.filter((x) => x !== v) }) })),
    ...live.dept.map((v) => ({ group: "부서", label: v, onRemove: () => drop({ dept: live.dept.filter((x) => x !== v) }) })),
    ...live.pos.map((v) => ({ group: "직책", label: v, onRemove: () => drop({ pos: live.pos.filter((x) => x !== v) }) })),
    ...live.etype.map((v) => ({ group: "고용형태", label: etypeLabel(v), onRemove: () => drop({ etype: live.etype.filter((x) => x !== v) }) })),
    ...((live.from || live.to) ? [{ group: "입사일", label: `${live.from || "처음"} ~ ${live.to || "오늘"}`, onRemove: () => drop({ from: "", to: "" }) }] : []),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${({ department: "부서", position: "직책", etype: "고용형태", status: "상태" } as Record<string, string>)[a.k] || a.k} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];

  const renderCard = (e: Emp) => {
    const sm = statusMeta(e.status);
    return (
      <button key={e.id} onClick={() => openEmp(e)} className="flex-people-card glass-card group">
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
              {e.employee_number && <span className="emp-no">#{e.employee_number}</span>}
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
  };

  return (
    <>
      <QueryScreen>
        <QueryHead>
          {tabs}
          <QueryBar right={actions}>
            {/*   구성원은 기간이 없는 마스터라 조회 줄이 [검색조건] 으로 시작한다 */}
            <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(live)}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0}
                  onClick={() => setDraft({ ...EMPTY_COND, rows: draft.rows })}>조건 지우기</button>
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}명</span>
                <RowsPerPage value={draft.rows} onChange={setD("rows")} />
                <button type="button" className="btn-primary btn-sm"
                  onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="상태" hint="여러 개 · 아무것도 안 고르면 전체">
                <span className="qk-quicks">
                  {STATUS_GROUPS.map((g) => (
                    <button key={g.key} type="button"
                      onClick={() => setD("status")(draft.status.includes(g.key) ? draft.status.filter((x) => x !== g.key) : [...draft.status, g.key])}
                      className={draft.status.includes(g.key) ? "qk-quick qk-quick-on" : "qk-quick"}>{g.label}</button>
                  ))}
                </span>
              </ConditionRow>
              <ConditionRow label="부서" hint="여러 개">
                <TokenField items={toTokens(depts)} value={draft.dept} onChange={setD("dept")} placeholder="부서 이름 일부 (예: 마케팅)" />
              </ConditionRow>
              <ConditionRow label="직책" hint="여러 개">
                <TokenField items={toTokens(positions)} value={draft.pos} onChange={setD("pos")} placeholder="직책 일부 (예: 과장)" />
              </ConditionRow>
              {etypes.length > 0 && (
                <ConditionRow label="고용형태" hint="여러 개">
                  <TokenField items={toTokens(etypes, etypeLabel)} value={draft.etype} onChange={setD("etype")} placeholder="정규직 · 계약직 …" />
                </ConditionRow>
              )}
              <ConditionRow label="입사일" hint="비우면 전체">
                <DateRangeField label={null} from={draft.from} to={draft.to}
                  onChange={(f, t) => setDraft((c) => ({ ...c, from: f, to: t }))}
                  onClear={() => setDraft((c) => ({ ...c, from: "", to: "" }))} />
              </ConditionRow>
            </ConditionPanel>
            <QuickSearch value={q} onApply={setQ} placeholder="이름 · 부서 · 직책 · 이메일 · 연락처 · 사번 — 쉼표로 여러 개, Enter" />
            <ChipGroup value={view} onChange={setView} options={VIEW_OPTS} />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={clearAll} />
          <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{shown.length.toLocaleString("ko")}</b>명</span>}>
            {stats}
          </ResultStrip>
        </QueryHead>

        <QueryBody>
          <div className="ev-scroll">
            {before}
            {shown.length === 0 ? (
              <div className="collect-empty">조건에 맞는 구성원이 없습니다 — 검색조건을 풀어 보세요</div>
            ) : view === "card" ? (
              <div className="flex-people-card-grid emp-card-grid">{pager.view.map(renderCard)}</div>
            ) : (
              <table ref={tableRef} className="ev-table ev-lined emp-table">
                <thead>
                  <tr>
                    {/*   사번 열 — 맨 왼쪽 (2026-08-27 사장님 "좌측에 사번"). 정렬은 이름과 같은 규칙(사번 순 → 가나다 → ABC) */}
                    <SortableTh label="사번" sortKey="employee_number" sort={sort} onSort={onSort} resize={thResize("employee_number", 1)} />
                    <SortableTh label="이름" sortKey="name" sort={sort} onSort={onSort} resize={thResize("name", 2)} />
                    <SortableTh label="부서" sortKey="department" sort={sort} onSort={onSort} filter={cfSpec("department")} resize={thResize("department", 3)} />
                    <SortableTh label="직책" sortKey="position" sort={sort} onSort={onSort} filter={cfSpec("position")} resize={thResize("position", 4)} />
                    <SortableTh label="고용형태" sortKey="etype" sort={sort} onSort={onSort} filter={cfSpec("etype")} resize={thResize("etype", 5)} />
                    <SortableTh label="입사일" sortKey="hire_date" sort={sort} onSort={onSort} resize={thResize("hire_date", 6)} />
                    <SortableTh label="근속" resize={thResize("tenure", 7)} />
                    <SortableTh label="연락처" sortKey="phone" sort={sort} onSort={onSort} resize={thResize("phone", 8)} />
                    <SortableTh label="이메일" resize={thResize("email", 9)} />
                    <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} filter={cfSpec("status")} resize={thResize("status", 10)} />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((e) => {
                    const sm = statusMeta(e.status);
                    return (
                      <tr key={e.id} onClick={() => openEmp(e)} className="emp-row">
                        <td className="tc mono-number emp-no-cell">{e.employee_number || <span className="ev-dim">—</span>}</td>
                        <td className="text-left">
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
                        <td className="text-center">{e.department || "—"}</td>
                        <td className="text-center">{e.job_title || e.position || "—"}</td>
                        <td className="text-center">{etypeLabel(e.employment_type) || "—"}</td>
                        <td className="text-center mono-number">{e.hire_date || "—"}</td>
                        <td className="text-center">{tenure(e.hire_date)}</td>
                        <td className="text-center mono-number">{formatPhone(e.phone) || "—"}</td>
                        <td className="text-left">{e.email || "—"}</td>
                        <td className="text-center"><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </QueryBody>

        <Pager page={pager.page} pages={pager.pages} total={shown.length} size={live.rows}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>

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

      {/* ── 직원 상세(정보 탭) — 디렉토리에서 "상세보기" 클릭 시 (2026-07-30 계약서→상세보기 개편) ── */}
      {contractsEmpId && (
        <div className="flex-people-contracts-modal-backdrop fixed inset-0" onClick={() => setContractsEmpId(null)}>
          <div className="w-full max-w-5xl my-6" onClick={(e) => e.stopPropagation()}>
            <EmployeeDetailPanel employeeId={contractsEmpId} companyId={companyId} initialTab="info" onClose={() => setContractsEmpId(null)} />
          </div>
        </div>
      )}
    </>
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
      // KST 오늘·월요일을 UTC 앵커로 계산 (2026-08-19 감사: -9h/+9h 이중 보정이 상쇄돼
      //   KST 브라우저에서 범위가 하루 밀려 "오늘 근무"가 빠졌다)
      const now = new Date(Date.now() + 9 * 3600 * 1000);
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const monday = new Date(today); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      const data = logRead('components/flex-people-directory:data', await db.from("attendance_records")
        .select("regular_minutes, overtime_minutes, work_hours")
        .eq("company_id", companyId).eq("employee_id", emp.id)
        .gte("date", monday.toISOString().slice(0, 10))
        .lte("date", today.toISOString().slice(0, 10)));
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
          <InfoRow label="연락처" value={formatPhone(emp.phone) || "—"} />
          <InfoRow label="입사일" value={emp.hire_date || "—"} />
          <InfoRow label="근속" value={tenure(emp.hire_date)} />
          <InfoRow label="고용형태" value={etypeLabel(emp.employment_type) || "—"} />
          {emp.employee_number && <InfoRow label="사번" value={emp.employee_number} />}
        </div>

        {/* 바로가기 */}
        <div className="flex-people-profile-shortcuts">
          {/* 2026-07-30 사장님: 계약서→상세보기(정보 탭 연결)로 명칭·링크 변경 + 근태 기록 보기와 위치 맞교환 */}
          {isManager ? (
            <>
              <button onClick={() => onOpenContracts(emp.id)} className="btn-primary w-full">
                상세보기
              </button>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/attendance" className="btn-secondary btn-sm justify-center no-underline">근태 기록 보기</Link>
                <Link href="/employees?tab=payroll" className="btn-secondary btn-sm justify-center no-underline">급여명세</Link>
              </div>
            </>
          ) : (
            <Link href="/attendance" className="block w-full text-center px-4 py-2.5 rounded-xl text-xs font-bold text-white transition hover:brightness-110 bg-[var(--primary)]">
              근태 기록 보기
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

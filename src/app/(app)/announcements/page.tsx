"use client";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

// 사용자 화면 — **열람 전용** (2026-08-06 사장님 지시).
//   공지 작성·수정·삭제는 운영자 페이지(/platform/announcements)에서만 한다.
//   DB 도 announcements_*_operator 정책으로 쓰기를 is_platform_operator() 로 막아 두었다.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ConditionPanel, ConditionRow, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, Stat, RowsPerPage, Pager, usePager, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

type Announcement = {
  id: string;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  author_email: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

// 방금 "안 읽음"이었던 공지 스냅샷 — 읽음 처리 직후 컴포넌트가 다시 마운트돼도(개발 이중 마운트,
//   뒤로가기 재진입) NEW 표시가 사라지지 않게 잠깐 들고 있는다. 다시 조회하면 이미 읽음이라 빈다.
const RECENT_NEW = new Map<string, { ids: Set<string>; at: number }>();
const RECENT_NEW_TTL_MS = 15_000;

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  notice: { label: "공지", color: "bg-[var(--info-dim)] text-[var(--info)]" },
  update: { label: "업데이트", color: "bg-[var(--success-dim)] text-[var(--success)]" },
  maintenance: { label: "점검", color: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  event: { label: "이벤트", color: "bg-[var(--primary-light)] text-[var(--primary)]" },
};

type Cond = { cats: string[]; from: string; to: string; rows: number };
const EMPTY: Cond = { cats: [], from: "", to: "", rows: 50 };
const condCount = (c: Cond) => c.cats.length + ((c.from || c.to) ? 1 : 0);
type SortKey = "category" | "title" | "author" | "created";

export default function AnnouncementsPage() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 이 화면에 들어온 순간 안 읽은 상태였던 공지 — 읽음 처리 후에도 "NEW" 를 계속 보여주기 위한 스냅샷.
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const markedRef = useRef(false);

  //   전역(null) + 내 회사 공지만 — RLS 만 믿으면 운영자 계정(creative@)은 전 회사(QA 시드 포함)
  //   공지가 다 보인다 (2026-08-28 사장님 제보). 배지 RPC(unread_announcement_count)도 같은 조건으로 맞춤.
  const myCompanyId = (user as any)?.company_id as string | undefined;
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["announcements", myCompanyId],
    queryFn: async () => {
      const data = logRead('announcements/page:data', await supabase
        .from("announcements")
        .select("*")
        .or(myCompanyId ? `company_id.is.null,company_id.eq.${myCompanyId}` : "company_id.is.null")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false }));
      return (data || []) as Announcement[];
    },
  });

  // 공지사항 탭에 들어오면 = 확인한 것 → 안 읽은 공지를 모두 읽음 처리하고 사이드바 배지를 지운다.
  useEffect(() => {
    if (!userId || rows.length === 0 || markedRef.current) return;
    markedRef.current = true;
    const recent = RECENT_NEW.get(userId);
    if (recent && Date.now() - recent.at < RECENT_NEW_TTL_MS) {
      setNewIds(recent.ids);
      return;
    }
    (async () => {
      const read = logRead('announcements/page:read', await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", userId));
      const readIds = new Set((read || []).map((r: { announcement_id: string }) => r.announcement_id));
      const unread = rows.filter((r) => !readIds.has(r.id));
      if (unread.length === 0) return;
      const ids = new Set(unread.map((r) => r.id));
      RECENT_NEW.set(userId, { ids, at: Date.now() });
      setNewIds(ids);
      // 이미 있으면 무시 — DO NOTHING 이라 RETURNING(SELECT 정책) 을 타지 않는다.
      await supabase.from("announcement_reads").upsert(
        unread.map((r) => ({ announcement_id: r.id, user_id: userId })),
        { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
      );
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    })();
  }, [userId, rows]);

  // ── 조회 표준 (2026-08-18) — 상자 하나: [검색조건(분류·기간) ▾ · 빠른검색] → 결과 요약 → 표(고정 먼저) → 쪽. 줄을 누르면 아래로 본문 펼침 ──
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "created", dir: "desc" });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  // v3 (2026-08-25 사장님): 제목을 더 넓게, 나머지는 더 좁게 — 키를 올려 기존 저장 너비에도 적용
  const [colW, setColW] = useColWidths("announcements-colw-v3", { pin: 40, category: 60, title: 780, author: 88, created: 128 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const catLabel = (c: string) => (CATEGORY_META[c] || CATEGORY_META.notice).label;
  const day = (v: string) => String(v || "").slice(0, 10);
  const condHit = (a: Announcement, c: Cond) => {
    if (c.cats.length && !c.cats.includes(a.category)) return false;
    if (c.from && day(a.created_at) < c.from) return false;
    if (c.to && day(a.created_at) > c.to) return false;
    return true;
  };
  const colVal = (a: Announcement) => ({ category: catLabel(a.category), author: a.author_name || a.author_email || "운영자" });
  const base = useMemo(() => rows.filter((a) => condHit(a, live) && quickSearchHit(q, [a.title, a.content, catLabel(a.category), a.author_name, a.author_email])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, live, q]);
  const shown = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const val = (a: Announcement) => sort.key === "category" ? catLabel(a.category) : sort.key === "title" ? a.title : sort.key === "author" ? (a.author_name || a.author_email || "") : a.created_at;
    //   고정 공지는 항상 위 — 그 안에서 정렬
    return base.filter((a) => cf.hit(colVal(a))).sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || cmp(val(a), val(b)) * d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, sort, cf.key]);
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, base.map((a) => colVal(a)[k]));
  const pager = usePager(shown, live.rows, `${q}|${JSON.stringify(live)}|${cf.key}`);
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.cats.map((c) => ({ group: "분류", label: catLabel(c), onRemove: () => drop({ cats: live.cats.filter((x) => x !== c) }) })),
    ...((live.from || live.to) ? [{ group: "기간", label: `${live.from || "처음"} ~ ${live.to || "오늘"}`, onRemove: () => drop({ from: "", to: "" }) }] : []),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${a.k === "category" ? "분류" : "작성자"} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];
  const clearAll = () => { setQ(""); setLive(EMPTY); setDraft(EMPTY); cf.clear(); };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <QueryBar>
            <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(live)}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0} onClick={() => setDraft({ ...EMPTY, rows: draft.rows })}>조건 지우기</button>
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{rows.filter((a) => condHit(a, draft)).length}건</span>
                <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
                <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="분류" hint="여러 개 · 아무것도 안 고르면 전체">
                <span className="qk-quicks">
                  {Object.entries(CATEGORY_META).map(([k, m]) => (
                    <button key={k} type="button" onClick={() => setDraft((c) => ({ ...c, cats: c.cats.includes(k) ? c.cats.filter((x) => x !== k) : [...c.cats, k] }))}
                      className={draft.cats.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{m.label}</button>
                  ))}
                </span>
              </ConditionRow>
              <ConditionRow label="기간" hint="비우면 전체">
                <DateRangeField label={null} from={draft.from} to={draft.to} onChange={(f, t) => setDraft((c) => ({ ...c, from: f, to: t }))} onClear={() => setDraft((c) => ({ ...c, from: "", to: "" }))} />
              </ConditionRow>
            </ConditionPanel>
            <QuickSearch value={q} onApply={setQ} placeholder="제목 · 내용 · 분류 · 작성자 — 쉼표로 여러 개, Enter" />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={clearAll} />
          <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{shown.length}</b>건</span>}>
            <Stat label="공지" value={`${rows.length}건`} />
            <Stat label="고정" value={`${rows.filter((r) => r.pinned).length}건`} />
            {newIds.size > 0 && <Stat label="새 공지" value={`${newIds.size}건`} tone="minus" />}
          </ResultStrip>
        </QueryHead>

        <QueryBody>
          {isLoading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="collect-empty">등록된 공지가 없습니다 — 서비스 공지·업데이트 소식이 등록되면 여기에 표시됩니다</div>
          ) : shown.length === 0 ? (
            <div className="collect-empty">이 조건에 맞는 공지가 없습니다 — 검색조건을 풀어 보세요</div>
          ) : (
            <div className="ev-scroll">
              <table ref={tableRef} className="ev-table ev-lined annc-table">
                <thead>
                  <tr>
                    <SortableTh label="고정" resize={thResize("pin", 1)} />
                    <SortableTh label="분류" sortKey="category" sort={sort} onSort={onSort} filter={cfSpec("category")} resize={thResize("category", 2)} />
                    <SortableTh label="제목" sortKey="title" sort={sort} onSort={onSort} resize={thResize("title", 3)} />
                    <SortableTh label="작성자" sortKey="author" sort={sort} onSort={onSort} filter={cfSpec("author")} resize={thResize("author", 4)} />
                    <SortableTh label="등록" sortKey="created" sort={sort} onSort={onSort} resize={thResize("created", 5)} />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((a) => {
                    const cat = CATEGORY_META[a.category] || CATEGORY_META.notice;
                    const expanded = expandedId === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr className={expanded ? "annc-row annc-row-open" : "annc-row"} onClick={() => setExpandedId(expanded ? null : a.id)}>
                          <td className="text-center">{a.pinned ? <Ico e="📌" /> : ""}</td>
                          <td className="text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.label}</span></td>
                          <td className="text-left">
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-[var(--text)] truncate">{a.title}</span>
                              {newIds.has(a.id) && <span className="announcement-new-tag">NEW</span>}
                              <svg className={`w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                            </span>
                          </td>
                          <td className="text-center">{a.author_name || a.author_email || "운영자"}</td>
                          {/* 초 단위 없이 24시간 표기 — 등록칸을 최대한 좁히기 위함 (2026-08-25) */}
                          <td className="text-center mono-number whitespace-nowrap">{new Date(a.created_at).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}{a.updated_at !== a.created_at && <span className="text-[10px] text-[var(--text-dim)]"> (수정됨)</span>}</td>
                        </tr>
                        {expanded && (
                          // 본문은 제목 칸 폭 안에서만 — 양 옆(고정·분류 / 작성자·등록)은 여백 (2026-08-25 사장님)
                          <tr className="annc-detail-row">
                            <td colSpan={2} />
                            <td>
                              <div className="annc-detail-body">{a.content}</div>
                            </td>
                            <td colSpan={2} />
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryBody>

        <Pager page={pager.page} pages={pager.pages} total={shown.length} size={live.rows}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>
    </div>
  );
}

"use client";
import { logRead } from "@/lib/log-read";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { resolveNotificationHref, type NotificationRow } from "@/lib/notification-routes";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ConditionPanel, ConditionRow, ChipGroup, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, Stat, RowsPerPage, Pager, usePager, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";

type NotifData = { rows: NotificationRow[]; quoteMap: Record<string, { deal_id: string; stage: string }> };

//   알림 종류 라벨 — type 값이 화면 글자로 보이게. 모르는 값도 영어 원문 대신 '기타'
//   (2026-09-02 사장님: "종류에 영어로 나타나는 게 있다" — payment_due·leave_request 등 누락분 보강)
const TYPE_LABEL: Record<string, string> = {
  approval_request: "결재 요청", approval_approved: "결재 승인", approval_rejected: "결재 반려", approval_result: "결재 결과", approval_reference: "결재 참조", approval: "결재",
  signature_request: "전자계약", contract_signed: "계약 서명", signature: "전자계약", quote_approval: "견적 승인", document: "문서",
  leave: "휴가", leave_request: "휴가 신청", leave_approved: "휴가 승인", leave_rejected: "휴가 반려",
  attendance: "근태", attendance_edit_request: "근태 정정 요청", overtime_request: "연장근무 신청", overtime_approved: "연장근무 승인", overtime_auto_clockout: "자동 퇴근",
  project_checkin_due: "프로젝트 점검", deal_update: "프로젝트", payroll: "급여", expense: "경비",
  payment_due: "결제 예정", inventory: "재고", board: "게시판", board_post: "게시판 글", chat: "메신저", schedule: "일정",
  company_join_request: "합류 요청", announcement: "공지", system: "시스템",
};
const typeLabel = (t?: string | null) => (t ? TYPE_LABEL[t] || "기타" : "—");

type Cond = { types: string[]; read: "" | "unread" | "read"; from: string; to: string; rows: number };
const EMPTY: Cond = { types: [], read: "", from: "", to: "", rows: 50 };
const condCount = (c: Cond) => c.types.length + (c.read ? 1 : 0) + ((c.from || c.to) ? 1 : 0);
type SortKey = "read" | "type" | "title" | "created";

/**
 * 알림 — 조회 화면 표준 (2026-08-18). 예전 카드 목록(glass-card 줄) → 상자 하나:
 *   [검색조건(종류·읽음·기간·줄 수) ▾ · 빠른검색 · 보기 칩(전체/안읽음)] ‖ 모두 읽음 → 결과 요약 → 표(정렬·≡·너비) → 쪽.
 *   줄을 누르면 그 알림이 가리키는 화면으로 간다(읽음 처리).
 */
export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();

  // react-query 캐시 — 30초 내 재방문은 즉시 표시(staleTime 전역 30s). rows + quote_approval 라우팅 맵 동시 로드.
  const { data, isLoading: loading } = useQuery<NotifData>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const u = await getCurrentUser();
      if (!u) return { rows: [], quoteMap: {} };
      const nRows = logRead('notifications/page:nRows', await supabase
        .from('notifications')
        .select('id, type, title, message, entity_type, entity_id, is_read, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .limit(500));
      const list = (nRows || []) as NotificationRow[];

      // quote_approval entity_ids 추려서 deal_id+stage 한 번에 prefetch
      const quoteIds = Array.from(new Set(
        list.filter(n => n.entity_type === 'quote_approval' && n.entity_id).map(n => n.entity_id as string),
      ));
      const map: Record<string, { deal_id: string; stage: string }> = {};
      if (quoteIds.length > 0) {
        const qaRows = logRead('notifications/page:qaRows', await supabase
          .from('quote_approvals')
          .select('id, deal_id, stage')
          .in('id', quoteIds));
        for (const r of (qaRows || []) as Array<{ id: string; deal_id: string; stage: string }>) {
          map[r.id] = { deal_id: r.deal_id, stage: r.stage };
        }
      }
      return { rows: list, quoteMap: map };
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const quoteMap = data?.quoteMap ?? {};

  // 캐시 내 rows 의 is_read 만 즉시 패치 (낙관적 갱신)
  const patchCache = (fn: (r: NotificationRow) => NotificationRow) => {
    queryClient.setQueryData<NotifData>(['notifications'], (old) =>
      old ? { ...old, rows: old.rows.map(fn) } : old,
    );
  };

  const markAllRead = async () => {
    const u = await getCurrentUser();
    if (!u) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', u.id).eq('is_read', false);
    patchCache(r => ({ ...r, is_read: true }));
    // 사이드바 뱃지 즉시 갱신
    window.dispatchEvent(new Event('sidebar-refresh-badges'));
  };

  const markOneRead = async (id: string) => {
    const u = await getCurrentUser();
    if (!u) return;
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    patchCache(r => (r.id === id ? { ...r, is_read: true } : r));
    window.dispatchEvent(new Event('sidebar-refresh-badges'));
  };

  // ── 조회 표준 ──
  const [q, setQ] = useState("");
  //   들어오면 안읽음부터 (2026-08-19 사장님: 전체가 기본이라 읽은 것까지 한꺼번에 나옴). 안읽음이 0건이면 한 번만 전체로.
  const [view, setView] = useState<"all" | "unread">("unread");
  const autoSwitched = useRef(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "created", dir: "desc" });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("notifications-colw-v1", { read: 70, type: 110, title: 260, message: 420, created: 160 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const typeOpts = useMemo(() => [...new Set(rows.map((r) => String(r.type || "")).filter(Boolean))], [rows]);
  const day = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
  const condHit = (n: NotificationRow, c: Cond) => {
    if (c.types.length && !c.types.includes(String(n.type || ""))) return false;
    if (c.read === "unread" && n.is_read) return false;
    if (c.read === "read" && !n.is_read) return false;
    if (c.from && day(n.created_at) < c.from) return false;
    if (c.to && day(n.created_at) > c.to) return false;
    return true;
  };
  const colVal = (n: NotificationRow) => ({ read: n.is_read ? "읽음" : "안읽음", type: typeLabel(n.type) });
  const base = useMemo(() => rows.filter((n) => (view === "all" || !n.is_read) && condHit(n, live)
    && quickSearchHit(q, [n.title, n.message, typeLabel(n.type)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, view, live, q]);
  const shown = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const val = (n: NotificationRow) => sort.key === "read" ? (n.is_read ? "1" : "0") : sort.key === "type" ? typeLabel(n.type) : sort.key === "title" ? String(n.title || "") : String(n.created_at || "");
    return base.filter((n) => cf.hit(colVal(n))).sort((a, b) => cmp(val(a), val(b)) * d || cmp(String(b.created_at || ""), String(a.created_at || "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, sort, cf.key]);
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, base.map((n) => colVal(n)[k]));
  const pager = usePager(shown, live.rows, `${view}|${q}|${JSON.stringify(live)}|${cf.key}`);
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const clearAll = () => { setQ(""); setLive(EMPTY); setDraft(EMPTY); cf.clear(); setView("all"); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.types.map((t) => ({ group: "종류", label: typeLabel(t), onRemove: () => drop({ types: live.types.filter((x) => x !== t) }) })),
    ...(live.read ? [{ group: "읽음", label: live.read === "unread" ? "안읽음" : "읽음", onRemove: () => drop({ read: "" }) }] : []),
    ...((live.from || live.to) ? [{ group: "기간", label: `${live.from || "처음"} ~ ${live.to || "오늘"}`, onRemove: () => drop({ from: "", to: "" }) }] : []),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${a.k === "read" ? "읽음" : "종류"} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];

  const unread = rows.filter(r => !r.is_read).length;
  useEffect(() => { if (!loading && !autoSwitched.current) { autoSwitched.current = true; if (unread === 0) setView("all"); } }, [loading, unread]);
  const open = (n: NotificationRow) => {
    if (!n.is_read) markOneRead(n.id);
    router.push(resolveNotificationHref(n, quoteMap));
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <QueryBar right={<>
            {unread > 0 && <button onClick={markAllRead} className="btn-secondary btn-sm whitespace-nowrap">모두 읽음 표시</button>}
          </>}>
            <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(live)}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0} onClick={() => setDraft({ ...EMPTY, rows: draft.rows })}>조건 지우기</button>
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{rows.filter((n) => condHit(n, draft)).length.toLocaleString("ko")}건</span>
                <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
                <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="종류" hint="여러 개 · 아무것도 안 고르면 전체">
                <span className="qk-quicks">
                  {typeOpts.map((t) => (
                    <button key={t} type="button"
                      onClick={() => setDraft((c) => ({ ...c, types: c.types.includes(t) ? c.types.filter((x) => x !== t) : [...c.types, t] }))}
                      className={draft.types.includes(t) ? "qk-quick qk-quick-on" : "qk-quick"}>{typeLabel(t)}</button>
                  ))}
                  {typeOpts.length === 0 && <span className="text-[11px] text-[var(--text-dim)]">알림이 아직 없습니다</span>}
                </span>
              </ConditionRow>
              <ConditionRow label="읽음">
                <ChipGroup value={draft.read} onChange={(v) => setDraft((c) => ({ ...c, read: v }))}
                  options={[{ value: "", label: "전체" }, { value: "unread", label: "안읽음" }, { value: "read", label: "읽음" }] as const} />
              </ConditionRow>
              <ConditionRow label="기간" hint="비우면 전체">
                <DateRangeField label={null} from={draft.from} to={draft.to} onChange={(f, t) => setDraft((c) => ({ ...c, from: f, to: t }))} onClear={() => setDraft((c) => ({ ...c, from: "", to: "" }))} />
              </ConditionRow>
            </ConditionPanel>
            <QuickSearch value={q} onApply={setQ} placeholder="제목 · 내용 · 종류 — 쉼표로 여러 개, Enter" />
            <ChipGroup value={view} onChange={setView} options={[{ value: "all", label: "전체" }, { value: "unread", label: unread > 0 ? `안읽음 ${unread}` : "안읽음" }] as const} />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={clearAll} />
          <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{shown.length.toLocaleString("ko")}</b>건</span>}>
            <Stat label="전체" value={`${rows.length.toLocaleString("ko")}건`} />
            <Stat label="안읽음" value={`${unread.toLocaleString("ko")}건`} tone={unread > 0 ? "minus" : undefined} />
          </ResultStrip>
        </QueryHead>

        <QueryBody>
          {loading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="collect-empty">알림이 없습니다 — 새 알림이 도착하면 여기에 표시됩니다</div>
          ) : shown.length === 0 ? (
            <div className="collect-empty">이 조건에 맞는 알림이 없습니다 — 검색조건을 풀어 보세요</div>
          ) : (
            <div className="ev-scroll">
              <table ref={tableRef} className="ev-table ev-lined notif-table">
                <thead>
                  <tr>
                    <SortableTh label="읽음" sortKey="read" sort={sort} onSort={onSort} filter={cfSpec("read")} resize={thResize("read", 1)} />
                    <SortableTh label="종류" sortKey="type" sort={sort} onSort={onSort} filter={cfSpec("type")} resize={thResize("type", 2)} />
                    <SortableTh label="제목" sortKey="title" sort={sort} onSort={onSort} resize={thResize("title", 3)} />
                    <SortableTh label="내용" resize={thResize("message", 4)} />
                    <SortableTh label="시각" sortKey="created" sort={sort} onSort={onSort} resize={thResize("created", 5)} />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((n) => (
                    <tr key={n.id} className={n.is_read ? "notif-row" : "notif-row notif-row-unread"} onClick={() => open(n)}>
                      <td className="text-center">
                        {n.is_read
                          ? <span className="text-[10px] text-[var(--text-dim)]">읽음</span>
                          : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--primary)]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />안읽음</span>}
                      </td>
                      <td className="text-center">{typeLabel(n.type)}</td>
                      <td className={`text-left ${n.is_read ? "text-[var(--text-muted)]" : "font-semibold text-[var(--text)]"}`}>{n.title}</td>
                      <td className="text-left text-[var(--text-dim)] truncate" title={n.message || ""}>{n.message || "—"}</td>
                      <td className="text-center mono-number text-[var(--text-muted)] whitespace-nowrap">{n.created_at ? new Date(n.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</td>
                    </tr>
                  ))}
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

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { SupportCompanyCard } from "@/components/support-company-card";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, QuickSearch, quickSearchHit,
  ConditionPanel, ConditionRow, TokenField, AmountRange, amountHit,
  AppliedChips, ResultStrip, Stat, RowsPerPage, Pager, usePager, SelectionBar,
  ChipGroup, type AppliedChip,
} from "@/components/query-kit";
import {
  listPrograms, listSaved, loadCompanyProfile, judge, daysLeft, lastSyncAt, scoreProgram,
  saveProgram, unsaveProgram, setSavedStatus,
  VERDICT_LABEL, SAVED_STATUS_LABEL, CARD_TOTAL,
  type GovProgram, type Judgement, type Verdict, type SavedRow, type FitScore,
} from "@/lib/support-programs";
import {
  loadCompanyFiles, requiredDocsOf, docsAreEstimated, checkDocs, readyCount,
  DOC_STATUS_LABEL, type DocCheck,
} from "@/lib/support-docs";
import { todayKst } from "@/lib/kst";

/**
 * 지원사업 — 회사 자료로 걸러 주는 정부 지원정책 (2026-08-21 사장님 지시)
 *
 * 기획: docs/20260821_PLAN_support_programs.md
 *
 * ★ 목록을 보여주는 게 아니라 **우리 회사 기준으로 걸러진 것**을 보여준다.
 *   그래서 첫 갈래가 '추천'이고, 판정 근거를 줄마다 적는다.
 * ★ Phase 1 은 상시 제도(고용장려금·두루누리 등)만 담는다. 공고형(기업마당·K-Startup)은
 *   인증키가 나온 뒤 같은 표에 source 만 달리해서 들어온다.
 * ★ 판정은 화면을 열 때 계산한다 — 제도가 10건뿐이라 캐시할 이유가 없고, 규칙을 고치면 즉시 반영된다.
 */

type Tab = "recommend" | "all" | "saved" | "history";
type SortKey = "dday" | "title" | "field" | "org" | "amount" | "verdict" | "fit" | "docs";

const TABS: { key: Tab; label: string }[] = [
  { key: "recommend", label: "추천" },
  { key: "all", label: "전체 찾기" },
  { key: "saved", label: "담아둔 것" },
  { key: "history", label: "신청 이력" },
];

//   판정 순서 — 처리할 것이 위 (조회 표준: 상태 정렬은 할 일이 위)
const VERDICT_ORDER: Record<Verdict, number> = { high: 0, check: 1, none: 2 };

const won = (n: number) => n.toLocaleString("ko-KR");

export default function SupportProgramsPage() {
  const { role } = useUser();
  if (role !== "owner" && role !== "admin") {
    return <AccessDenied detail="지원사업은 대표·관리자 전용입니다 — 직원 인사 정보로 자격을 판정합니다." />;
  }
  return <SupportProgramsInner />;
}

function SupportProgramsInner() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("recommend");
  const [cardOpen, setCardOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);   // 상세를 연 program id
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "card">("list");
  //   기본은 적합도 높은 순 — 사장님 지시: "가장 적합하거나 바로 신청할 수 있는 것이 상단으로"
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "fit", dir: "desc" });

  // ── 조건 — 패널 안은 초안이고, [조회] 를 눌러야 나간다 (기간 하나짜리가 아니라 여러 칸이라) ──
  const [condOpen, setCondOpen] = useState(false);
  const [q, setQ] = useState("");
  const [size, setSize] = useState(50);
  const [applied, setApplied] = useState({ fields: [] as string[], types: [] as string[], verdicts: [] as string[], min: "", max: "", ready: false });
  const [draft, setDraft] = useState(applied);
  const [draftSize, setDraftSize] = useState(size);

  const { data: programs = [], isLoading: programsLoading } = useQuery({
    queryKey: ["support-programs"],
    queryFn: listPrograms,
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["support-profile", companyId],
    queryFn: () => loadCompanyProfile(companyId!),
    enabled: !!companyId,
  });

  //   공고를 마지막으로 언제 받았는지 — 목록이 허전할 때 "안 받아온 건지" 를 알 수 있어야 한다
  const { data: syncedAt } = useQuery({
    queryKey: ["support-last-sync"],
    queryFn: lastSyncAt,
  });

  //   회사가 이미 가진 파일 — 신청 서류를 여기서 끌어온다
  const { data: files = [] } = useQuery({
    queryKey: ["support-files", companyId],
    queryFn: () => loadCompanyFiles(companyId!),
    enabled: !!companyId,
  });

  const { data: saved = [] } = useQuery({
    queryKey: ["support-saved", companyId],
    queryFn: () => listSaved(companyId!),
    enabled: !!companyId,
  });

  const savedByProgram = useMemo(() => {
    const m = new Map<string, SavedRow>();
    (saved as SavedRow[]).forEach((s) => m.set(s.program_id, s));
    return m;
  }, [saved]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["support-saved", companyId] });
  };

  const saveMut = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        if (savedByProgram.has(id)) continue;
        await saveProgram(companyId!, id, userId);
      }
    },
    onSuccess: () => { invalidate(); setPicked(new Set()); toast("관심 목록에 담았습니다", "success"); },
    onError: (e: unknown) => toast(friendlyError(e, "담지 못했습니다"), "error"),
  });

  const dropMut = useMutation({
    mutationFn: (programId: string) => unsaveProgram(companyId!, programId),
    onSuccess: () => { invalidate(); toast("관심 목록에서 뺐습니다", "success"); },
    onError: (e: unknown) => toast(friendlyError(e, "빼지 못했습니다"), "error"),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => setSavedStatus(id, status),
    onSuccess: () => { invalidate(); toast("진행 상태를 바꿨습니다", "success"); },
    onError: (e: unknown) => toast(friendlyError(e, "바꾸지 못했습니다"), "error"),
  });

  // ── 판정 — 제도마다 회사 프로필과 대조한다 ────────────────────────────
  type Row = {
    program: GovProgram; judgement: Judgement; savedRow?: SavedRow; dday: number | null;
    checks: DocCheck[]; needed: number; have: number; score: FitScore;
  };

  const judged: Row[] = useMemo(() => {
    if (!profile) return [];
    const today = todayKst();
    return (programs as GovProgram[]).map((program) => {
      const judgement = judge(program, profile);
      const needed = requiredDocsOf(program);
      const checks = checkDocs(needed, files, today);
      return {
        program, judgement,
        savedRow: savedByProgram.get(program.id),
        dday: daysLeft(program.apply_end),
        checks, needed: needed.length, have: readyCount(checks),
        score: scoreProgram(program, judgement, checks, today),
      };
    });
  }, [programs, profile, savedByProgram, files]);

  // ── 갈래 → 조건 → 빠른검색 → 정렬 ──────────────────────────────────────
  const rows: Row[] = useMemo(() => {
    let list = judged;

    if (tab === "recommend") list = list.filter((r) => r.judgement.verdict !== "none");
    if (tab === "saved") list = list.filter((r) => r.savedRow && ["saved", "preparing"].includes(r.savedRow.status));
    if (tab === "history") list = list.filter((r) => r.savedRow && ["applied", "selected", "rejected", "dropped"].includes(r.savedRow.status));

    if (applied.fields.length) list = list.filter((r) => r.program.field && applied.fields.includes(r.program.field));
    if (applied.types.length) list = list.filter((r) => r.program.support_type && applied.types.includes(r.program.support_type));
    if (applied.verdicts.length) list = list.filter((r) => applied.verdicts.includes(r.judgement.verdict));
    if (applied.ready) list = list.filter((r) => r.score.ready);
    if (applied.min || applied.max) {
      list = list.filter((r) => amountHit(Number(r.judgement.estimate?.amount ?? r.program.amount_max ?? 0), applied.min, applied.max));
    }
    if (q) {
      list = list.filter((r) => quickSearchHit(q,
        [r.program.title, r.program.org, r.program.field, r.program.support_type, r.program.summary],
        [Number(r.judgement.estimate?.amount ?? r.program.amount_max ?? 0)]));
    }

    const dir = sort.dir === "asc" ? 1 : -1;
    const key = (r: Row): unknown => {
      switch (sort.key) {
        case "dday": return r.dday ?? 9999;                      // 상시는 맨 뒤 — 마감이 급한 게 위
        case "title": return r.program.title;
        case "field": return r.program.field;
        case "org": return r.program.org;
        case "amount": return Number(r.judgement.estimate?.amount ?? r.program.amount_max ?? 0);
        case "docs": return r.needed === 0 ? -1 : r.have / r.needed;
        case "verdict": return VERDICT_ORDER[r.judgement.verdict];
        default: return r.score.total;
      }
    };
    //   같은 판정 안에서는 예상액이 큰 것부터 — 대표가 먼저 볼 이유가 있는 순서
    return [...list].sort((a, b) => {
      const c = cmp(key(a), key(b)) * dir;
      if (c !== 0) return c;
      return Number(b.judgement.estimate?.amount ?? b.program.amount_max ?? 0)
           - Number(a.judgement.estimate?.amount ?? a.program.amount_max ?? 0);
    });
  }, [judged, tab, applied, q, sort]);

  const pager = usePager(rows, size, `${tab}-${q}-${JSON.stringify(applied)}`);

  const stats = useMemo(() => {
    const base = judged.filter((r) => r.judgement.verdict !== "none");
    return {
      high: judged.filter((r) => r.judgement.verdict === "high").length,
      check: judged.filter((r) => r.judgement.verdict === "check").length,
      soon: judged.filter((r) => r.dday !== null && r.dday >= 0 && r.dday <= 7).length,
      ready: judged.filter((r) => r.score.ready).length,
      estimate: base.reduce((s, r) => s + Number(r.judgement.estimate?.amount ?? 0), 0),
    };
  }, [judged]);

  const activeCount = applied.fields.length + applied.types.length + applied.verdicts.length
    + (applied.min || applied.max ? 1 : 0) + (applied.ready ? 1 : 0);

  const chips: AppliedChip[] = [
    ...applied.fields.map((v) => ({ group: "분야", label: v, onRemove: () => setBoth({ ...applied, fields: applied.fields.filter((x) => x !== v) }) })),
    ...applied.types.map((v) => ({ group: "지원형태", label: v, onRemove: () => setBoth({ ...applied, types: applied.types.filter((x) => x !== v) }) })),
    ...applied.verdicts.map((v) => ({ group: "판정", label: VERDICT_LABEL[v as Verdict], onRemove: () => setBoth({ ...applied, verdicts: applied.verdicts.filter((x) => x !== v) }) })),
    ...(applied.min || applied.max ? [{ group: "금액", label: `${applied.min || "0"}~${applied.max || "제한없음"}`, onRemove: () => setBoth({ ...applied, min: "", max: "" }) }] : []),
    ...(applied.ready ? [{ group: "보기", label: "지금 신청 가능", onRemove: () => setBoth({ ...applied, ready: false }) }] : []),
  ];

  function setBoth(next: typeof applied) { setApplied(next); setDraft(next); }

  const fieldItems = useMemo(() =>
    Array.from(new Set((programs as GovProgram[]).map((p) => p.field).filter(Boolean) as string[]))
      .map((v) => ({ value: v, label: v })), [programs]);
  const typeItems = useMemo(() =>
    Array.from(new Set((programs as GovProgram[]).map((p) => p.support_type).filter(Boolean) as string[]))
      .map((v) => ({ value: v, label: v })), [programs]);

  const detailRow = judged.find((r) => r.program.id === detail) || null;
  const loading = programsLoading || profileLoading;

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => { setTab(t.key); setPicked(new Set()); }}
                className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
                {t.label}
                {t.key === "saved" && savedCount(saved as SavedRow[], "open") > 0 && (
                  <span className="collect-tab-cnt">{savedCount(saved as SavedRow[], "open")}</span>
                )}
              </button>
            ))}
          </div>

          <QueryBar right={
            <>
              <span className="sp-card-meter" title="채운 만큼 판정이 정확해집니다">
                회사 카드 <b>{profile?.cardFilled ?? 0}/{CARD_TOTAL}</b>
              </span>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCardOpen(true)}>채우기</button>
              <span className="sp-count">{rows.length}건</span>
            </>
          }>
            <ConditionPanel
              open={condOpen} onOpenChange={(v) => { setCondOpen(v); if (v) { setDraft(applied); setDraftSize(size); } }}
              activeCount={activeCount}
              foot={
                <>
                  <RowsPerPage value={draftSize} onChange={setDraftSize} />
                  <div className="sp-panel-actions">
                    <button type="button" className="btn-secondary btn-sm"
                      onClick={() => setDraft({ fields: [], types: [], verdicts: [], min: "", max: "", ready: false })}>비우기</button>
                    <button type="button" className="btn-primary btn-sm"
                      onClick={() => { setApplied(draft); setSize(draftSize); setCondOpen(false); }}>조회</button>
                  </div>
                </>
              }>
              <ConditionRow label="분야">
                <TokenField items={fieldItems} value={draft.fields} onChange={(v) => setDraft({ ...draft, fields: v })}
                  placeholder="인력 · 세제 · 금융 …" />
              </ConditionRow>
              <ConditionRow label="지원형태">
                <TokenField items={typeItems} value={draft.types} onChange={(v) => setDraft({ ...draft, types: v })}
                  placeholder="인력지원 · 세액공제 · 보험료지원 …" />
              </ConditionRow>
              <ConditionRow label="판정">
                <TokenField
                  items={(["high", "check", "none"] as Verdict[]).map((v) => ({ value: v, label: VERDICT_LABEL[v] }))}
                  value={draft.verdicts} onChange={(v) => setDraft({ ...draft, verdicts: v })}
                  placeholder="가능성 높음 · 조건 확인 …" />
              </ConditionRow>
              {/* hint 를 안 준다 — 칸 오른쪽에 이미 '원' 이 붙어 있어 라벨 밑에 또 적으면 줄만 늘어난다 */}
              <ConditionRow label="예상 금액">
                <AmountRange min={draft.min} max={draft.max}
                  onMin={(v) => setDraft({ ...draft, min: v })} onMax={(v) => setDraft({ ...draft, max: v })} />
              </ConditionRow>
            </ConditionPanel>

            <QuickSearch value={q} onApply={setQ} placeholder="사업명 · 기관 · 분야 — 쉼표로 여러 개, Enter" />

            <ChipGroup value={view} onChange={setView}
              options={[{ value: "list", label: "리스트" }, { value: "card", label: "카드" }] as const} />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={() => setBoth({ fields: [], types: [], verdicts: [], min: "", max: "", ready: false })} />

          <ResultStrip right={
            syncedAt
              ? <span className="sp-synced">공고 갱신 {new Date(syncedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              : <span className="sp-synced">상시 제도만 — 공고는 아직 받지 않았습니다</span>
          }>
            {/*   숫자를 누르면 그 조건으로 좁혀 본다 (조회 화면 표준) */}
            <button type="button" className="sp-stat-btn"
              onClick={() => setBoth({ ...applied, ready: !applied.ready })}>
              <Stat label="지금 신청 가능" value={`${stats.ready}건`} tone="plus" />
            </button>
            <Stat label="가능성 높음" value={`${stats.high}건`} tone="plus" />
            <Stat label="조건 확인 필요" value={`${stats.check}건`} />
            <Stat label="이번 주 마감" value={`${stats.soon}건`} tone={stats.soon > 0 ? "minus" : undefined} />
            <Stat label="예상 수령 가능액" value={stats.estimate > 0 ? `${won(stats.estimate)}원` : "—"} tone="plus" />
          </ResultStrip>
        </QueryHead>

        <QueryBody>
          {loading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="collect-empty">
              {tab === "saved" ? "담아둔 지원사업이 없습니다 — 추천에서 ☆ 를 눌러 담아 두세요."
                : tab === "history" ? "신청 이력이 없습니다 — 담아둔 것에서 진행 상태를 바꾸면 여기로 옮겨집니다."
                : profile && profile.cardFilled < CARD_TOTAL
                  ? `조건에 맞는 지원사업이 없습니다. 회사 카드를 ${CARD_TOTAL - profile.cardFilled}개 더 채우면 후보가 늘어납니다.`
                  : "조건에 맞는 지원사업이 없습니다."}
            </div>
          ) : view === "card" ? (
            <div className="sp-cards">
              {pager.view.map((r) => (
                <button key={r.program.id} type="button" className="sp-card" onClick={() => setDetail(r.program.id)}>
                  <div className="sp-card-top">
                    <span className="sp-card-badges">
                      <VerdictBadge v={r.judgement.verdict} />
                      <b className="sp-fit-n">{r.score.total}</b>
                      {r.score.ready && <span className="sp-ready">지금 신청</span>}
                    </span>
                    <span className="sp-dday">{ddayLabel(r.dday)}</span>
                  </div>
                  <b className="sp-card-title">{r.program.title}</b>
                  <p className="sp-card-sum">{r.program.summary}</p>
                  <div className="sp-card-foot">
                    <span>{r.program.org}{r.needed > 0 ? ` · 서류 ${r.have}/${r.needed}` : ""}</span>
                    <b className="mono-number">{r.judgement.estimate?.text || r.program.amount_text || "—"}</b>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="ev-scroll">
              <table className="ev-table sp-table">
                <thead>
                  <tr>
                    <th className="sp-th-pick" />
                    <SortableTh label="마감" sortKey="dday" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} style={{ width: 74 }} />
                    <SortableTh label="사업명" sortKey="title" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
                    <SortableTh label="분야" sortKey="field" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} style={{ width: 84 }} />
                    <SortableTh label="주관" sortKey="org" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} style={{ width: 150 }} />
                    <SortableTh label="지원 규모 (예상)" sortKey="amount" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} style={{ width: 180 }} />
                    <SortableTh label="서류" sortKey="docs" sort={sort} onSort={(k) => setSort(nextSort(sort, k, "desc"))} style={{ width: 72 }} />
                    <SortableTh label="적합도" sortKey="fit" sort={sort} onSort={(k) => setSort(nextSort(sort, k, "desc"))} style={{ width: 148 }} />
                    <th style={{ width: 56 }}>담기</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((r) => (
                    <tr key={r.program.id} className="sp-row" onClick={() => setDetail(r.program.id)}>
                      <td className="sp-td-pick" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`${r.program.title} 고르기`}
                          checked={picked.has(r.program.id)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(r.program.id); else next.delete(r.program.id);
                            setPicked(next);
                          }} />
                      </td>
                      <td className="text-center">
                        <span className={r.dday !== null && r.dday <= 7 ? "sp-dday sp-dday-soon" : "sp-dday"}>{ddayLabel(r.dday)}</span>
                      </td>
                      <td className="sp-td-title">
                        <b>{r.program.title}</b>
                        <small>{firstReason(r.judgement)}</small>
                      </td>
                      <td className="text-center">{r.program.field || "—"}</td>
                      <td className="text-center">{r.program.org || "—"}</td>
                      <td className="text-right mono-number">
                        {r.judgement.estimate
                          ? <b className="sp-amt-est">{r.judgement.estimate.text}</b>
                          : <span className="sp-amt-plain">{r.program.amount_text || "—"}</span>}
                      </td>
                      <td className="text-center">
                        {r.needed === 0
                          ? <span className="sp-docs-none" title="공고 원문에서 확인하세요">—</span>
                          : <span className={r.have >= r.needed ? "sp-docs sp-docs-full" : "sp-docs"}>{r.have}/{r.needed}</span>}
                      </td>
                      <td>
                        <div className="sp-fit">
                          <VerdictBadge v={r.judgement.verdict} />
                          <span className="sp-fit-bar" aria-hidden><i style={{ width: `${r.score.total}%` }} /></span>
                          <b className="sp-fit-n">{r.score.total}</b>
                          {r.score.ready && <span className="sp-ready">지금 신청</span>}
                        </div>
                      </td>
                      <td className="text-center" onClick={(e) => e.stopPropagation()}>
                        {r.savedRow ? (
                          <button type="button" className="sp-star sp-star-on" aria-label="관심에서 빼기"
                            onClick={() => dropMut.mutate(r.program.id)}>★</button>
                        ) : (
                          <button type="button" className="sp-star" aria-label="관심에 담기"
                            onClick={() => saveMut.mutate([r.program.id])}>☆</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 선택 바는 표 위로 떠오른다 — 고를 때마다 표가 들썩이지 않게 (query-kit 표준) */}
          <SelectionBar count={picked.size} onClear={() => setPicked(new Set())}
            summary={<>고른 건을 관심 목록에 담습니다</>}>
            <button type="button" className="btn-primary btn-sm" disabled={saveMut.isPending}
              onClick={() => saveMut.mutate([...picked])}>관심 담기</button>
          </SelectionBar>
        </QueryBody>

        {/* ── 쪽·고지는 상자 바닥에 고정 — qk-body 안은 absolute 스크롤 영역이라 형제로 두면 표에 겹친다 ── */}
        <Pager page={pager.page} pages={pager.pages} total={rows.length}
          from={pager.from} to={pager.to} size={size} onPage={pager.setPage} />

        <p className="sp-disclaimer">
          오너뷰는 신청을 대행하지 않습니다. 금액은 <b>예상</b>이며, 최종 자격은 공고 원문과 주관기관 확인이 필요합니다.
        </p>
      </QueryScreen>

      {companyId && (
        <SupportCompanyCard companyId={companyId} userId={userId} open={cardOpen} onClose={() => setCardOpen(false)} />
      )}

      {detailRow && (
        <ProgramDetail row={detailRow} onClose={() => setDetail(null)}
          onSave={() => saveMut.mutate([detailRow.program.id])}
          onDrop={() => dropMut.mutate(detailRow.program.id)}
          onStatus={(status) => detailRow.savedRow && statusMut.mutate({ id: detailRow.savedRow.id, status })}
          onOpenCard={() => { setDetail(null); setCardOpen(true); }} />
      )}
    </div>
  );
}

// ── 조각들 ────────────────────────────────────────────────────────────────

function savedCount(rows: SavedRow[], kind: "open") {
  return rows.filter((s) => kind === "open" && ["saved", "preparing"].includes(s.status)).length;
}

function ddayLabel(d: number | null) {
  if (d === null) return "상시";
  if (d < 0) return "마감";
  if (d === 0) return "오늘";
  return `D-${d}`;
}

function firstReason(j: Judgement) {
  //   목록에는 한 줄만 — 걸리는 것이 있으면 그것을 먼저 보여준다(알아야 할 것이 그쪽이라)
  const blocker = j.reasons.find((r) => r.mark === "no") || j.reasons.find((r) => r.mark === "unknown");
  return (blocker || j.reasons[0])?.text ?? "";
}

function ScoreBar({ label, v, max }: { label: string; v: number; max: number }) {
  return (
    <div className="sp-sbar">
      <span className="sp-sbar-l">{label}</span>
      <span className="sp-sbar-t"><i style={{ width: `${Math.round((v / max) * 100)}%` }} /></span>
      <b className="sp-sbar-v">{v}<em>/{max}</em></b>
    </div>
  );
}

function VerdictBadge({ v }: { v: Verdict }) {
  return <span className={`sp-verdict sp-verdict-${v}`}>{VERDICT_LABEL[v]}</span>;
}

type DetailRow = {
  program: GovProgram; judgement: Judgement; savedRow?: SavedRow; dday: number | null;
  checks: DocCheck[]; needed: number; have: number; score: FitScore;
};

function ProgramDetail({ row, onClose, onSave, onDrop, onStatus, onOpenCard }: {
  row: DetailRow; onClose: () => void; onSave: () => void; onDrop: () => void;
  onStatus: (status: string) => void; onOpenCard: () => void;
}) {
  useModalKeys(true, onClose);
  const { program: p, judgement: j } = row;

  return (
    <div className="sp-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-modal sp-modal-detail" role="dialog" aria-label={p.title}>
        <div className="sp-modal-head">
          <div>
            <b className="sp-modal-title">{p.title}</b>
            <p className="sp-modal-desc">
              {p.org} · {p.apply_end ? `접수 ~${p.apply_end.slice(0, 10)}` : "상시 접수"} · {p.amount_text || "지원 규모 미표기"}
            </p>
          </div>
          <VerdictBadge v={j.verdict} />
        </div>

        <div className="sp-modal-body">
          {p.summary && <p className="sp-detail-sum">{p.summary}</p>}

          {/* 적합도 — 점수만 두면 못 믿는다. 무엇으로 매겨졌는지 줄로 적는다 */}
          <div className="sp-detail-sec">
            <b className="sp-detail-h">적합도 {row.score.total}점 {row.score.ready && <span className="sp-ready">지금 신청 가능</span>}</b>
            <div className="sp-score">
              <div className="sp-score-bars">
                <ScoreBar label="자격" v={row.score.fit} max={50} />
                <ScoreBar label="서류" v={row.score.docs} max={30} />
                <ScoreBar label="신청" v={row.score.ease} max={20} />
              </div>
              <ul className="sp-score-lines">
                {row.score.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          </div>

          {/* 필요 서류 — 회사 파일보관함에서 찾아 붙인다 */}
          <div className="sp-detail-sec">
            <b className="sp-detail-h">
              신청 서류 {row.needed > 0 && <span className="sp-detail-sub">{row.have}/{row.needed} 준비됨</span>}
            </b>
            {row.needed === 0 ? (
              <p className="sp-detail-req">이 공고의 제출 서류는 공고 원문에서 확인해 주세요.</p>
            ) : (
              <>
                {docsAreEstimated(p) && (
                  <p className="sp-docs-note">공고문을 읽어 확인한 목록이 아니라 <b>대부분의 사업이 요구하는 기본 서류</b>입니다 — 원문을 함께 보세요.</p>
                )}
                {row.have > 0 && (
                  <p className="sp-docs-note">✓ 표시는 <b>파일 이름으로 찾은 것</b>입니다 — 실제로 낼 서류가 맞는지 눌러서 확인해 주세요.</p>
                )}
                <ul className="sp-doclist">
                  {row.checks.map((c) => (
                    <li key={c.spec.key} className={`sp-doc sp-doc-${c.status}`}>
                      <span className="sp-doc-mark" aria-hidden>
                        {c.status === "have" ? "✓" : c.status === "stale" ? "!" : "·"}
                      </span>
                      <span className="sp-doc-body">
                        <b>{c.spec.label}</b>
                        <small>{c.status === "have" || c.status === "stale" ? c.file?.file_name : c.note}</small>
                        {c.spec.hint && <em>{c.spec.hint}</em>}
                      </span>
                      <span className="sp-doc-act">
                        {(c.status === "have" || c.status === "stale") && c.file?.file_url && (
                          <a href={c.file.file_url} target="_blank" rel="noreferrer noopener">열기 ↗</a>
                        )}
                        {c.status === "ownerview" && c.spec.ownerview && (
                          <Link href={c.spec.ownerview.href}>가기 →</Link>
                        )}
                        {(c.status === "issue" || c.status === "stale") && c.spec.url && (
                          <a href={c.spec.url} target="_blank" rel="noreferrer noopener">{c.spec.source} ↗</a>
                        )}
                        <em className="sp-doc-st">{DOC_STATUS_LABEL[c.status]}</em>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="sp-detail-sec">
            <b className="sp-detail-h">왜 이렇게 판정했나</b>
            <ul className="sp-why">
              {j.reasons.map((r, i) => (
                <li key={i} className={`sp-why-row sp-why-${r.mark}`}>
                  <span className="sp-why-mark" aria-hidden>{r.mark === "ok" ? "✓" : r.mark === "unknown" ? "?" : "✕"}</span>
                  <span className="sp-why-text">{r.text}</span>
                  <span className="sp-why-src">{r.src}</span>
                </li>
              ))}
            </ul>
          </div>

          {j.estimate && (
            <div className="sp-detail-sec">
              <b className="sp-detail-h">예상 수령 가능액</b>
              <div className="sp-est">
                <b className="mono-number">{j.estimate.text}</b>
                <small>{j.estimate.basis}</small>
              </div>
            </div>
          )}

          {p.requirement && (
            <div className="sp-detail-sec">
              <b className="sp-detail-h">제도가 정한 요건</b>
              <p className="sp-detail-req">{p.requirement}</p>
            </div>
          )}

          {row.savedRow && (
            <div className="sp-detail-sec">
              <b className="sp-detail-h">진행 상태</b>
              <div className="sp-pick-row">
                {Object.entries(SAVED_STATUS_LABEL).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => onStatus(k)}
                    className={row.savedRow!.status === k ? "sp-pick sp-pick-on" : "sp-pick"}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sp-modal-foot">
          <button type="button" className="btn-secondary btn-sm" onClick={onOpenCard}>회사 카드 채우기</button>
          {p.detail_url && (
            <a className="btn-secondary btn-sm" href={p.detail_url} target="_blank" rel="noreferrer noopener">공고 원문 열기 ↗</a>
          )}
          <Link className="btn-secondary btn-sm" href="/schedule">일정에 적기</Link>
          {row.savedRow
            ? <button type="button" className="btn-secondary btn-sm" onClick={onDrop}>관심에서 빼기</button>
            : <button type="button" className="btn-primary btn-sm" onClick={onSave}>관심 담기</button>}
        </div>
      </div>
    </div>
  );
}

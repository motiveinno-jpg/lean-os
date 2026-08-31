"use client";

// 프로젝트 상세 v3 — "한 장" (2026-08-31 기획 v2.6, 결정 0 시리즈 1단계)
//   개념은 둘: 프로젝트, 그리고 항목(구분 4: 할 일 · 매출·지출 · 회의·메모 · 증빙·문서).
//   자리 7·자리별 보기·템플릿 8·전용 입력 화면을 대체한다. feature_on('projecthub_items_v3')
//   게이트 뒤에서만 렌더 — 꺼진 회사는 legacy-detail 이 그대로 나온다.
//   1단계 범위: 현황 판 4칸 + 탭 4 + 입력줄 + 항목 팝업(팔로워·하위·태그·우선순위·기간) +
//   일괄 처리 + 단계 이름 편집 + 증빙·문서 읽기 전용. 연결 제안·초안·결재 게이트는 2~3단계.

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";
import { getCompanyUsers } from "@/lib/queries";
import {
  KIND_TABS, INPUT_KINDS, PRIORITIES, stagesOf, stageLabel,
  type ItemKind, type ItemStage,
} from "@/lib/project-items";

const db = supabase as any;

export type ItemRow = {
  id: string; deal_id: string; kind: ItemKind; money_kind: "spend" | "revenue" | null;
  name: string; status: string; assignee_id: string | null; followers: string[];
  start_date: string | null; due_date: string | null; tags: string[]; priority: "high" | "mid" | "low" | null;
  is_milestone: boolean; hours: number | null; plan_amount: number | null;
  partner_id: string | null; partner_name: string | null;
  parent_id: string | null; fields: Record<string, unknown> | null; body: string | null;
  draft_ref: unknown; position: number; archived_at: string | null; created_at: string;
};

type UserRow = { id: string; name: string | null; email: string | null };

const won = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`;
const man = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n / 10000).toLocaleString("ko-KR")}만`;

export function HubV3() {
  const params = useParams();
  const dealId = String(params?.id || "");
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;

  // ── 데이터 ──────────────────────────────────────────────
  const { data: deal, isLoading: dealLoading } = useQuery({
    queryKey: ["phv3-deal", dealId],
    enabled: !!dealId,
    queryFn: async () => logRead("phv3:deal", await db.from("deals")
      .select("id, name, company_id, partner_id, stage, start_date, end_date, contract_total, item_stages")
      .eq("id", dealId).maybeSingle()),
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["phv3-items", dealId],
    enabled: !!dealId,
    queryFn: async () => (logRead("phv3:items", await db.from("project_items")
      .select("*").eq("deal_id", dealId).is("archived_at", null)
      .order("position").order("created_at")) || []) as ItemRow[],
  });

  const { data: users = [] } = useQuery({
    queryKey: ["phv3-users", companyId],
    enabled: !!companyId,
    queryFn: () => getCompanyUsers(companyId!) as Promise<UserRow[]>,
  });

  const { data: partner } = useQuery({
    queryKey: ["phv3-partner", deal?.partner_id],
    enabled: !!deal?.partner_id,
    queryFn: async () => logRead("phv3:partner", await db.from("partners")
      .select("id, name").eq("id", deal!.partner_id).maybeSingle()),
  });

  // 확정 비용·수익 — 기존 v_deal_pnl (장부에 태그된 것만). 없으면 0 이 아니라 "—" 로.
  const { data: pnl } = useQuery({
    queryKey: ["phv3-pnl", dealId],
    enabled: !!dealId,
    queryFn: async () => logRead("phv3:pnl", await db.from("v_deal_pnl")
      .select("revenue, direct_cost, margin").eq("deal_id", dealId).maybeSingle()),
  });

  // 증빙·문서 (1단계: 읽기 전용 — 이미 이 프로젝트로 태그된 문서·계산서)
  const { data: docs = [] } = useQuery({
    queryKey: ["phv3-docs", dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const [documents, taxInvoices] = await Promise.all([
        db.from("documents").select("id, name, content_type, created_at").eq("deal_id", dealId)
          .order("created_at", { ascending: false }).limit(100),
        db.from("tax_invoices").select("id, type, total_amount, supply_amount, status, created_at")
          .eq("deal_id", dealId).order("created_at", { ascending: false }).limit(100),
      ]);
      const a = (logRead("phv3:docs", documents) || []).map((d: any) => ({
        id: `doc-${d.id}`, when: d.created_at, label: d.name || "문서",
        chip: d.content_type === "quote" || d.content_type === "invoice" ? "견적·청구" : "계약·문서", amt: null as number | null,
      }));
      const b = (logRead("phv3:taxinv", taxInvoices) || []).map((t: any) => ({
        id: `ti-${t.id}`, when: t.created_at, label: t.type === "sales" ? "세금계산서 (매출)" : "세금계산서 (매입)",
        chip: "세금계산서", amt: (t.total_amount ?? t.supply_amount ?? null) as number | null,
      }));
      return [...a, ...b].sort((x, y) => String(y.when).localeCompare(String(x.when)));
    },
  });

  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.id] = u.name || u.email || "?";
    return m;
  }, [users]);

  const stages: ItemStage[] = useMemo(() => stagesOf(deal?.item_stages), [deal?.item_stages]);

  // ── 파생 ────────────────────────────────────────────────
  const topOf = (k: ItemKind) => items.filter((i) => i.kind === k && !i.parent_id);
  const todoAll = items.filter((i) => i.kind === "todo");
  const todoTop = topOf("todo");
  const moneyTop = topOf("money");
  const noteTop = topOf("note");
  const childCount = useMemo(() => {
    const m: Record<string, { total: number; done: number }> = {};
    for (const i of items) if (i.parent_id) {
      m[i.parent_id] = m[i.parent_id] || { total: 0, done: 0 };
      m[i.parent_id].total++;
      if (i.status === "done") m[i.parent_id].done++;
    }
    return m;
  }, [items]);

  const doneN = todoAll.filter((i) => i.status === "done").length;
  const lateN = todoAll.filter((i) => i.status !== "done" && i.due_date && i.due_date < new Date().toISOString().slice(0, 10)).length;
  const assigneeOpen = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of todoAll) if (i.status !== "done" && i.assignee_id) m[i.assignee_id] = (m[i.assignee_id] || 0) + 1;
    return m;
  }, [todoAll]);
  const nextMs = todoAll
    .filter((i) => i.is_milestone && i.status !== "done")
    .sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")))[0];

  const planSpend = items.filter((i) => i.kind === "money" && i.money_kind === "spend")
    .reduce((s, i) => s + (i.plan_amount || 0), 0);
  const confirmedCost: number | null = pnl?.direct_cost ?? null;
  const contract: number | null = deal?.contract_total ?? null;
  const marginPct = contract && contract > 0 && confirmedCost != null
    ? Math.round((contract - confirmedCost) / contract * 1000) / 10 : null;

  // ── 탭 ─────────────────────────────────────────────────
  const tabParam = search?.get("tab");
  const [tab, setTab] = useState<ItemKind | "docs">(
    tabParam === "money" || tabParam === "note" || tabParam === "docs" ? tabParam : "todo");

  // ── 입력줄 ──────────────────────────────────────────────
  const [inKind, setInKind] = useState("todo");
  const [inName, setInName] = useState("");
  const [inWho, setInWho] = useState("");
  const [inDue, setInDue] = useState("");
  const [inPartner, setInPartner] = useState("");
  const [inAmt, setInAmt] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["phv3-items", dealId] });

  const addItem = useMutation({
    mutationFn: async () => {
      const def = INPUT_KINDS.find((k) => k.key === inKind)!;
      const nm = inName.trim();
      if (!nm) throw new Error("내용을 입력해 주세요");
      const row: Record<string, unknown> = {
        company_id: companyId, deal_id: dealId, kind: def.kind, money_kind: def.moneyKind ?? null,
        name: nm, status: "todo", created_by: userId,
        position: items.length,
      };
      if (def.kind === "todo") {
        if (inWho) row.assignee_id = inWho;
        if (inDue) row.due_date = inDue;
      }
      if (def.kind === "money") {
        if (inPartner.trim()) row.partner_name = inPartner.trim();
        const amt = Number(inAmt.replace(/[^0-9.-]/g, ""));
        if (amt) row.plan_amount = amt;
      }
      const { error } = await db.from("project_items").insert(row);
      if (error) throw new Error(error.message);
      return def;
    },
    onSuccess: (def) => {
      setInName(""); setInAmt("");
      setTab(def.kind);
      toast(def.kind === "money"
        ? "입력했습니다 — 장부 초안·결재 연결은 다음 단계에서 붙습니다"
        : "입력했습니다");
      invalidate();
    },
    onError: (e: any) => toast(String(e.message || e)),
  });

  const patchItem = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await db.from("project_items").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: any) => toast(String(e.message || e)),
  });

  // ── 일괄 처리 ───────────────────────────────────────────
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const bulk = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await db.from("project_items").update(patch).in("id", selIds);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setSel({}); invalidate(); },
    onError: (e: any) => toast(String(e.message || e)),
  });
  const bulkFollow = useMutation({
    mutationFn: async () => {
      for (const id of selIds) {
        const it = items.find((i) => i.id === id);
        if (!it || !userId || (it.followers || []).includes(userId)) continue;
        const { error } = await db.from("project_items")
          .update({ followers: [...(it.followers || []), userId] }).eq("id", id);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => { setSel({}); toast("팔로워로 추가했습니다 — 이 항목의 변경 알림을 받습니다"); invalidate(); },
    onError: (e: any) => toast(String(e.message || e)),
  });

  // ── 팝업 ────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null);
  const [showStages, setShowStages] = useState(false);
  const openItem = items.find((i) => i.id === openId) || null;

  if (dealLoading || itemsLoading) return <div className="phv3-loading">불러오는 중…</div>;
  if (!deal) return <div className="phv3-loading">프로젝트를 찾을 수 없습니다.</div>;

  const period = [deal.start_date, deal.end_date].filter(Boolean).join(" ~ ");

  return (
    <div className="phv3-page">
      {/* ── 머리 + 현황 판 ── */}
      <div className="phv3-panel">
        <div className="phv3-head">
          <div>
            <h2 className="phv3-title">{deal.name || "(이름 없음)"}</h2>
            <div className="phv3-meta">
              {partner?.name ? `${partner.name} · ` : ""}{period || "기간 미정"}
            </div>
          </div>
          <div className="phv3-verdict">
            {lateN > 0 && <span className="phv3-bad">기한 지난 할 일 {lateN}건</span>}
            {lateN === 0 && todoAll.length > 0 && <span>기한 지난 할 일 없음</span>}
            {todoAll.length === 0 && <span>아직 항목이 없습니다 — 아래 입력줄에 바로 적으면 됩니다</span>}
          </div>
        </div>

        <div className="phv3-statusboard">
          <button type="button" className="phv3-sb" onClick={() => setTab("todo")} title="할 일 탭으로">
            <div className="phv3-sb-k">진행 현황</div>
            <div className="phv3-sb-v">{doneN}/{todoAll.length} 완료{nextMs ? ` · 🚩 ${nextMs.name}` : ""}</div>
            <div className="phv3-sb-bar"><i style={{ width: `${todoAll.length ? Math.round(doneN / todoAll.length * 100) : 0}%` }} /></div>
          </button>
          <button type="button" className="phv3-sb" onClick={() => setTab("todo")} title="할 일 탭으로">
            <div className="phv3-sb-k">담당자</div>
            <div className="phv3-sb-v">{Object.keys(assigneeOpen).length}명</div>
            <div className="phv3-sb-s">
              {Object.keys(assigneeOpen).length
                ? Object.entries(assigneeOpen).map(([id, n]) => `${userName[id] || "?"} ${n}`).join(" · ")
                : "항목 담당에서 자동 집계"}
            </div>
          </button>
          <button type="button" className="phv3-sb" onClick={() => setTab("money")} title="매출·지출 탭으로">
            <div className="phv3-sb-k">돈</div>
            <div className="phv3-sb-v phv3-num">계약 {man(contract)} · 확정 {man(confirmedCost)}</div>
            <div className="phv3-sb-s phv3-num">지출 예정 {man(planSpend || null)} — 확정은 장부에서만 옵니다</div>
          </button>
          <button type="button" className="phv3-sb" onClick={() => setTab("docs")} title="증빙·문서 탭으로">
            <div className="phv3-sb-k">성과 — 마진율</div>
            <div className={`phv3-sb-v phv3-num ${marginPct != null && marginPct >= 0 ? "phv3-pos" : ""}`}>
              {marginPct != null ? `${marginPct}%` : "—"}
            </div>
            <div className="phv3-sb-s">계약 대비 확정 비용 기준 · 증빙 {docs.length}건</div>
          </button>
        </div>

        {/* ── 입력줄 ── */}
        <div className="phv3-writebar">
          <div className="phv3-kinds" role="group" aria-label="구분">
            {INPUT_KINDS.map((k) => (
              <button key={k.key} type="button"
                className={inKind === k.key ? "phv3-kind phv3-kind-on" : "phv3-kind"}
                onClick={() => setInKind(k.key)}>{k.icon} {k.label}</button>
            ))}
          </div>
          <input className="phv3-field phv3-grow" placeholder="내용을 입력하세요"
            value={inName} onChange={(e) => setInName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addItem.mutate(); }} />
          {inKind === "todo" && (<>
            <select className="phv3-field" value={inWho} onChange={(e) => setInWho(e.target.value)} aria-label="담당">
              <option value="">담당 없음</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
            <input className="phv3-field" type="date" value={inDue} onChange={(e) => setInDue(e.target.value)} aria-label="기한" />
          </>)}
          {(inKind === "spend" || inKind === "revenue") && (<>
            <input className="phv3-field phv3-w130" placeholder="거래처" value={inPartner} onChange={(e) => setInPartner(e.target.value)} />
            <input className="phv3-field phv3-w110 phv3-right" placeholder="금액" inputMode="numeric"
              value={inAmt} onChange={(e) => setInAmt(e.target.value)} />
          </>)}
          <button type="button" className="btn-primary btn-sm" disabled={addItem.isPending} onClick={() => addItem.mutate()}>입력</button>
        </div>

        {/* ── 탭 ── */}
        <div className="phv3-tabs">
          {KIND_TABS.map((t) => {
            const n = t.key === "todo" ? todoTop.length : t.key === "money" ? moneyTop.length
              : t.key === "note" ? noteTop.length : docs.length;
            return (
              <button key={t.key} type="button"
                className={tab === t.key ? "phv3-tab phv3-tab-on" : "phv3-tab"}
                onClick={() => setTab(t.key)}>
                {t.label} <span className="phv3-tab-n">{n}</span>
              </button>
            );
          })}
          {tab === "todo" && (
            <button type="button" className="phv3-stagebtn" onClick={() => setShowStages(true)}>단계 이름 바꾸기</button>
          )}
        </div>

        {/* ── 할 일 ── */}
        {tab === "todo" && (
          <div>
            <div className="phv3-scroll">
              <table className="ev-table ev-lined phv3-table">
                <thead><tr>
                  <th className="phv3-th-check"></th><th>내용</th><th>담당</th><th>기한</th><th>상태</th>
                </tr></thead>
                <tbody>
                  {todoTop.length === 0 && (
                    <tr><td colSpan={5} className="phv3-empty">할 일이 없습니다 — 위 입력줄에 적으면 바로 생깁니다.</td></tr>
                  )}
                  {[...todoTop].sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0))
                    .map((i) => {
                      const cc = childCount[i.id];
                      const isLate = i.status !== "done" && i.due_date && i.due_date < new Date().toISOString().slice(0, 10);
                      return (
                        <tr key={i.id} className="phv3-row" onClick={() => setOpenId(i.id)}>
                          <td className="phv3-td-c" onClick={(e) => e.stopPropagation()}>
                            {i.status !== "done" && (
                              <input type="checkbox" checked={!!sel[i.id]} aria-label="선택"
                                onChange={(e) => setSel((s) => ({ ...s, [i.id]: e.target.checked }))} />
                            )}
                          </td>
                          <td>
                            {i.priority && <i className={`phv3-prio phv3-prio-${i.priority}`} title={`우선순위 ${PRIORITIES.find((p) => p.id === i.priority)?.label}`} />}
                            {i.name}
                            {i.tags?.map((t) => <span key={t} className="phv3-tag">{t}</span>)}
                            {i.is_milestone && <span className="phv3-chip phv3-chip-plan">🚩 마일스톤</span>}
                            {cc && <span className="phv3-chip">하위 {cc.done}/{cc.total}</span>}
                            {(i.followers?.length || 0) > 0 && <span className="phv3-chip">👁 {i.followers.length}</span>}
                          </td>
                          <td className="phv3-td-c phv3-dim">{i.assignee_id ? userName[i.assignee_id] || "?" : "—"}</td>
                          <td className={`phv3-td-c ${isLate ? "phv3-bad" : "phv3-dim"}`}>
                            {i.start_date ? `${i.start_date} ~ ` : ""}{i.due_date || "—"}
                          </td>
                          <td className="phv3-td-c" onClick={(e) => e.stopPropagation()}>
                            <select className="phv3-stagesel" value={i.status} aria-label="상태"
                              onChange={(e) => patchItem.mutate({ id: i.id, patch: { status: e.target.value } })}>
                              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                              {!stages.some((s) => s.id === i.status) && <option value={i.status}>{stageLabel(stages, i.status)}</option>}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {selIds.length > 0 && (
              <div className="phv3-bulkbar">
                <b>{selIds.length}건 선택</b>
                <button type="button" className="btn-secondary btn-sm" onClick={() => bulk.mutate({ status: "done" })}>완료로 변경</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => bulkFollow.mutate()}>내가 팔로우</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSel({})}>해제</button>
              </div>
            )}
            <div className="phv3-foot phv3-note">
              항목을 누르면 상세(기간·태그·우선순위·팔로워·하위 작업)가 열립니다. 단계 이름은 프로젝트별로 바꿀 수 있습니다.
            </div>
          </div>
        )}

        {/* ── 매출·지출 ── */}
        {tab === "money" && (
          <div>
            <div className="phv3-sumline phv3-num">
              지출 예정 <b>{won(planSpend || null)}</b> · 장부 확정 <b>{won(confirmedCost)}</b> — 예정과 확정은 나란히, 섞지 않습니다
            </div>
            <div className="phv3-scroll">
              <table className="ev-table ev-lined phv3-table">
                <thead><tr><th>구분</th><th>내용</th><th>거래처</th><th className="phv3-th-r">예정</th><th className="phv3-th-r">확정(장부)</th><th>증빙</th></tr></thead>
                <tbody>
                  {moneyTop.length === 0 && (
                    <tr><td colSpan={6} className="phv3-empty">매출·지출 항목이 없습니다 — 진행현황만 관리하는 프로젝트라면 이 탭은 안 써도 됩니다.</td></tr>
                  )}
                  {moneyTop.map((i) => (
                    <tr key={i.id} className="phv3-row" onClick={() => setOpenId(i.id)}>
                      <td className="phv3-td-c">
                        {i.money_kind === "revenue"
                          ? <span className="phv3-chip phv3-chip-ok">매출</span>
                          : <span className="phv3-chip">지출</span>}
                      </td>
                      <td>{i.name}{i.tags?.map((t) => <span key={t} className="phv3-tag">{t}</span>)}</td>
                      <td className="phv3-dim">{i.partner_name || "—"}</td>
                      <td className="phv3-td-r phv3-num">{i.plan_amount != null ? i.plan_amount.toLocaleString("ko-KR") : "—"}</td>
                      <td className="phv3-td-r phv3-dim">—</td>
                      <td className="phv3-td-c phv3-dim">{i.draft_ref ? "초안 연결됨" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="phv3-foot phv3-note">
              확정 칸은 장부(전표·계산서·카드·통장)에서만 옵니다 — 항목별 확정 연결·장부 초안·결재 게이트는 다음 단계에서 붙습니다.
              여러 프로젝트에 걸친 비용은 나눠 입력하세요.
            </div>
          </div>
        )}

        {/* ── 회의·메모 ── */}
        {tab === "note" && (
          <div>
            <div className="phv3-scroll">
              <table className="ev-table ev-lined phv3-table">
                <thead><tr><th>날짜</th><th>내용</th><th>본문</th></tr></thead>
                <tbody>
                  {noteTop.length === 0 && (
                    <tr><td colSpan={3} className="phv3-empty">회의·메모가 없습니다.</td></tr>
                  )}
                  {noteTop.map((i) => (
                    <tr key={i.id} className="phv3-row" onClick={() => setOpenId(i.id)}>
                      <td className="phv3-td-c phv3-dim">{String(i.created_at).slice(0, 10)}</td>
                      <td>{i.name}</td>
                      <td className="phv3-dim">{i.body ? `${i.body.slice(0, 60)}${i.body.length > 60 ? "…" : ""}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="phv3-foot phv3-note">항목을 열면 본문을 적을 수 있습니다 — 회의록 양식(안건·결정·후속)은 4단계에서 팝업 속으로 들어옵니다.</div>
          </div>
        )}

        {/* ── 증빙·문서 ── */}
        {tab === "docs" && (
          <div>
            <div className="phv3-docs">
              {docs.length === 0 && (
                <div className="phv3-empty">아직 이 프로젝트로 태그된 증빙·문서가 없습니다 — 연결 제안(거래처·기간·금액으로 찾아 제안)은 2단계에서 붙습니다.</div>
              )}
              {docs.map((d: any) => (
                <div key={d.id} className="phv3-doc">
                  <span className="phv3-chip">{d.chip}</span>
                  <span className="phv3-doc-t">{d.label}</span>
                  {d.amt != null && <span className="phv3-num phv3-doc-amt">{Number(d.amt).toLocaleString("ko-KR")}원</span>}
                  <span className="phv3-dim phv3-doc-when">{String(d.when || "").slice(0, 10)}</span>
                </div>
              ))}
            </div>
            <div className="phv3-foot phv3-note">전표·통장·카드·결재·발주서까지 모으는 피드와 연결 제안은 2단계에서 완성됩니다.</div>
          </div>
        )}
      </div>

      {openItem && (
        <ItemModal item={openItem} users={users} userName={userName} stages={stages}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchItem.mutate({ id: openItem.id, patch })}
          onArchive={() => { patchItem.mutate({ id: openItem.id, patch: { archived_at: new Date().toISOString() } }); setOpenId(null); toast("항목을 지웠습니다(복구는 관리자에게)"); }}
          onAddChild={async (name) => {
            const { error } = await db.from("project_items").insert({
              company_id: companyId, deal_id: dealId, kind: openItem.kind, money_kind: openItem.money_kind,
              name, status: "todo", parent_id: openItem.id, created_by: userId, position: items.length,
            });
            if (error) toast(error.message); else invalidate();
          }}
          childItems={items.filter((i) => i.parent_id === openItem.id)}
          onPatchChild={(id, patch) => patchItem.mutate({ id, patch })}
        />
      )}

      {showStages && (
        <StageEditor stages={stages} onClose={() => setShowStages(false)}
          onSave={async (next) => {
            const { error } = await db.from("deals").update({ item_stages: next }).eq("id", dealId);
            if (error) toast(error.message);
            else { toast("단계 이름을 저장했습니다 — 이 프로젝트에만 적용됩니다"); qc.invalidateQueries({ queryKey: ["phv3-deal", dealId] }); }
            setShowStages(false);
          }} />
      )}
    </div>
  );
}

// ── 항목 상세 팝업 — 겉은 한 줄, 속만 깊어진다 ─────────────
function ItemModal({ item, users, userName, stages, childItems, onClose, onPatch, onArchive, onAddChild, onPatchChild }: {
  item: ItemRow; users: UserRow[]; userName: Record<string, string>; stages: ItemStage[];
  childItems: ItemRow[];
  onClose: () => void; onPatch: (patch: Record<string, unknown>) => void; onArchive: () => void;
  onAddChild: (name: string) => void; onPatchChild: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(item.name);
  const [body, setBody] = useState(item.body || "");
  const [tags, setTags] = useState((item.tags || []).join(", "));
  const [child, setChild] = useState("");
  const save = () => {
    onPatch({
      name: name.trim() || item.name,
      body: body || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    onClose();
  };
  const toggleFollower = (uid: string) => {
    const cur = item.followers || [];
    onPatch({ followers: cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid] });
  };
  return (
    <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="항목 상세">
        <input className="phv3-field phv3-modal-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="이름" />

        <div className="phv3-modal-grid">
          <label>상태
            <select className="phv3-field" value={item.status} onChange={(e) => onPatch({ status: e.target.value })}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              {!stages.some((s) => s.id === item.status) && <option value={item.status}>{item.status}</option>}
            </select>
          </label>
          <label>담당
            <select className="phv3-field" value={item.assignee_id || ""} onChange={(e) => onPatch({ assignee_id: e.target.value || null })}>
              <option value="">없음</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </label>
          <label>시작일
            <input className="phv3-field" type="date" value={item.start_date || ""} onChange={(e) => onPatch({ start_date: e.target.value || null })} />
          </label>
          <label>기한
            <input className="phv3-field" type="date" value={item.due_date || ""} onChange={(e) => onPatch({ due_date: e.target.value || null })} />
          </label>
          <label>우선순위
            <select className="phv3-field" value={item.priority || ""} onChange={(e) => onPatch({ priority: e.target.value || null })}>
              <option value="">없음</option>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label>🚩 마일스톤
            <select className="phv3-field" value={item.is_milestone ? "1" : ""} onChange={(e) => onPatch({ is_milestone: e.target.value === "1" })}>
              <option value="">아니오</option><option value="1">예 — 주요 진행 지점</option>
            </select>
          </label>
          {item.kind === "money" && (<>
            <label>거래처
              <input className="phv3-field" defaultValue={item.partner_name || ""} onBlur={(e) => onPatch({ partner_name: e.target.value || null })} />
            </label>
            <label>예정 금액
              <input className="phv3-field phv3-right" inputMode="numeric" defaultValue={item.plan_amount ?? ""}
                onBlur={(e) => onPatch({ plan_amount: Number(e.target.value.replace(/[^0-9.-]/g, "")) || null })} />
            </label>
          </>)}
        </div>

        <label className="phv3-modal-row">태그 <span className="phv3-note">(쉼표로 여러 개)</span>
          <input className="phv3-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예: 디자인, 제작" />
        </label>

        <div className="phv3-modal-row">
          <span>팔로워 <span className="phv3-note">— 상태·기한·담당이 바뀌면 알림(알림 발송은 2단계)</span></span>
          <div className="phv3-followers">
            {users.map((u) => (
              <button key={u.id} type="button"
                className={(item.followers || []).includes(u.id) ? "phv3-fol phv3-fol-on" : "phv3-fol"}
                onClick={() => toggleFollower(u.id)}>{u.name || u.email}</button>
            ))}
          </div>
        </div>

        {item.kind === "note" && (
          <label className="phv3-modal-row">본문
            <textarea className="phv3-field phv3-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="회의 내용·결정 사항을 적으세요 (안건·결정·후속 양식은 4단계에서)" />
          </label>
        )}

        <div className="phv3-modal-row">
          <span>하위 작업 {childItems.length > 0 && <span className="phv3-note">{childItems.filter((c) => c.status === "done").length}/{childItems.length} 완료</span>}</span>
          {childItems.map((c) => (
            <div key={c.id} className="phv3-childrow">
              <input type="checkbox" checked={c.status === "done"} aria-label="완료"
                onChange={(e) => onPatchChild(c.id, { status: e.target.checked ? "done" : "todo" })} />
              <span className={c.status === "done" ? "phv3-child-done" : ""}>{c.name}</span>
            </div>
          ))}
          <div className="phv3-childadd">
            <input className="phv3-field phv3-grow" placeholder="하위 작업 추가" value={child}
              onChange={(e) => setChild(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && child.trim()) { onAddChild(child.trim()); setChild(""); } }} />
          </div>
        </div>

        <div className="phv3-modal-foot">
          <button type="button" className="btn-secondary btn-sm phv3-danger" onClick={onArchive}>지우기</button>
          <span className="phv3-grow" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

// ── 단계 이름 편집 — 프로젝트별 (결정 0-3) ────────────────
function StageEditor({ stages, onClose, onSave }: {
  stages: ItemStage[]; onClose: () => void; onSave: (next: ItemStage[]) => void;
}) {
  const [rows, setRows] = useState<ItemStage[]>(stages.map((s) => ({ ...s })));
  return (
    <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="단계 이름 바꾸기">
        <h3 className="phv3-modal-title">할 일 단계 — 이 프로젝트</h3>
        <p className="phv3-modal-desc">이름을 바꾸거나 단계를 추가하세요(예: 요청 → 진행 → 검수 → 완료). &apos;완료&apos; 단계는 진행률 계산 기준이라 지울 수 없습니다.</p>
        {rows.map((s, i) => (
          <div key={s.id} className="phv3-stagerow">
            <span className={`phv3-stagedot phv3-stage-${s.color}`} />
            <input className="phv3-field phv3-grow" value={s.label}
              onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
            {s.id !== "done" && rows.length > 2 && (
              <button type="button" className="phv3-x" aria-label="단계 삭제"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}
        <button type="button" className="btn-secondary btn-sm" onClick={() =>
          setRows((r) => [...r.slice(0, -1), { id: `s${r.length}${Math.floor(Math.random() * 1000)}`, label: "새 단계", color: "indigo" }, r[r.length - 1]])
        }>+ 단계 추가</button>
        <div className="phv3-modal-foot">
          <span className="phv3-grow" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => onSave(rows.filter((r) => r.label.trim()))}>저장</button>
        </div>
      </div>
    </div>
  );
}

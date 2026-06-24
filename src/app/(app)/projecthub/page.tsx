"use client";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import { useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { getDeals, getCompanyUsers } from "@/lib/queries";
import { getPartners } from "@/lib/partners";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";
import { useCanAccessTab } from "@/lib/tab-access";

const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "");

export default function ProjectHubPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const router = useRouter();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/projecthub");
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editDeal, setEditDeal] = useState<any | null>(null);
  const [delDeal, setDelDeal] = useState<any | null>(null);

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["projecthub-deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["projecthub-partners", companyId],
    queryFn: () => getPartners(companyId!),
    enabled: !!companyId,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["projecthub-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
  });

  // 세부 프로젝트(캠페인)는 목록에서 숨기고 상위 프로젝트만 노출. 자식 수는 배지로 표시.
  const topDeals = useMemo(() => (deals as any[]).filter((d) => !d.parent_deal_id), [deals]);
  const childCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of deals as any[]) if (d.parent_deal_id) m[d.parent_deal_id] = (m[d.parent_deal_id] || 0) + 1;
    return m;
  }, [deals]);

  // 진행률 — deal_milestones 완료율 (없으면 null → "—")
  const dealIds = useMemo(() => topDeals.map((d) => d.id), [topDeals]);
  const { data: milestones = [] } = useQuery({
    queryKey: ["projecthub-milestones", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await supabase.from("deal_milestones").select("deal_id, status, completed_at").in("deal_id", dealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });

  // 손익 — v_deal_pnl (직접원가·직접원가율). 전표 deal_id 태그 전엔 0.
  const { data: pnl = [] } = useQuery({
    queryKey: ["projecthub-pnl", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("v_deal_pnl").select("deal_id, revenue, direct_cost, direct_cost_ratio, margin");
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const pnlByDeal = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of pnl as any[]) m[p.deal_id] = p;
    return m;
  }, [pnl]);

  const partnerName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of partners as any[]) m[p.id] = p.name;
    return m;
  }, [partners]);
  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users as any[]) m[u.id] = u.name;
    return m;
  }, [users]);
  const progressByDeal = useMemo(() => {
    const m: Record<string, { done: number; total: number }> = {};
    for (const ms of milestones as any[]) {
      const e = (m[ms.deal_id] ||= { done: 0, total: 0 });
      e.total += 1;
      if (ms.status === "completed" || ms.completed_at) e.done += 1;
    }
    return m;
  }, [milestones]);

  // 제목줄 클릭 정렬
  type PSortKey = "name" | "partner" | "manager" | "stage" | "contract" | "direct_cost" | "cost_ratio" | "progress" | "period";
  const [sortKey, setSortKey] = useState<PSortKey>("contract");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: PSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(["contract", "direct_cost", "cost_ratio", "progress"].includes(k) ? "desc" : "asc"); }
  };
  const sortableTh = (k: PSortKey, label: string, cls: string) => (
    <th className={`${cls} cursor-pointer select-none hover:text-[var(--text)] transition`} onClick={() => toggleSort(k)} title="클릭하여 정렬">
      <span className={`inline-flex items-center gap-1 ${cls.includes("text-right") ? "justify-end w-full" : cls.includes("text-center") ? "justify-center w-full" : ""}`}>
        {label}
        <span className={`text-[9px] ${sortKey === k ? "text-[var(--primary)]" : "text-[var(--text-dim)]/40"}`}>{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </span>
    </th>
  );
  const rows = useMemo(() => {
    const pctOf = (d: any) => { const pr = progressByDeal[d.id]; return pr && pr.total > 0 ? pr.done / pr.total : -1; };
    return topDeals.slice().sort((a, b) => {
      let c = 0;
      switch (sortKey) {
        case "name": c = (a.name || "").localeCompare(b.name || "", "ko"); break;
        case "partner": c = (partnerName[a.partner_id] || "").localeCompare(partnerName[b.partner_id] || "", "ko"); break;
        case "manager": c = (userName[a.internal_manager_id] || "").localeCompare(userName[b.internal_manager_id] || "", "ko"); break;
        case "stage": c = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage); break;
        case "direct_cost": c = Number(pnlByDeal[a.id]?.direct_cost || 0) - Number(pnlByDeal[b.id]?.direct_cost || 0); break;
        case "cost_ratio": c = Number(pnlByDeal[a.id]?.direct_cost_ratio || 0) - Number(pnlByDeal[b.id]?.direct_cost_ratio || 0); break;
        case "progress": c = pctOf(a) - pctOf(b); break;
        case "period": c = (a.start_date || "").localeCompare(b.start_date || ""); break;
        default: c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      }
      if (c === 0) c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      return sortDir === "asc" ? c : -c;
    });
  }, [topDeals, sortKey, sortDir, partnerName, userName, pnlByDeal, progressByDeal]);

  const summary = useMemo(() => {
    const total = rows.length;
    const inProgress = rows.filter((d) => d.stage === "in_progress").length;
    const totalContract = rows.reduce((s, d) => s + Number(d.contract_total || 0), 0);
    // VAT포함 합계 = Σ(공급가 + round(공급가×0.1)) — 행별 반올림 합산이라 목록 합계와 일치
    const totalContractWithVat = rows.reduce((s, d) => { const sup = Number(d.contract_total || 0); return s + sup + Math.round(sup * 0.1); }, 0);
    const ratios = rows.map((d) => pnlByDeal[d.id]?.direct_cost_ratio).filter((r) => r != null && Number(r) > 0).map(Number);
    const avgRatio = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;
    return { total, inProgress, totalContract, totalContractWithVat, avgRatio };
  }, [rows, pnlByDeal]);

  if (tabLoading) return null;
  if (!tabAllowed) return <AccessDenied detail="프로젝트 접근 권한이 없습니다. 관리자/대표에게 권한을 요청하세요." />;

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">견적 → 계약 → 진행 → 손익까지 프로젝트별 라이프사이클·수익성을 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">
            + 프로젝트 생성
          </button>
        </div>
      </div>

      {showCreate && companyId && (
        <ProjectFormModal
          companyId={companyId}
          partners={partners as any[]}
          users={users as any[]}
          onClose={() => setShowCreate(false)}
          onSaved={(id) => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["projecthub-deals"] }); if (id) router.push(`/projecthub/${id}`); }}
        />
      )}

      {editDeal && companyId && (
        <ProjectFormModal
          companyId={companyId}
          partners={partners as any[]}
          users={users as any[]}
          editDeal={editDeal}
          onClose={() => setEditDeal(null)}
          onSaved={() => {
            setEditDeal(null);
            qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
            qc.invalidateQueries({ queryKey: ["deals"] });
            qc.invalidateQueries({ queryKey: ["projects-deals"] });
          }}
        />
      )}

      {delDeal && (
        <DeleteProjectModal
          deal={delDeal}
          companyId={companyId}
          onClose={() => setDelDeal(null)}
          onDeleted={() => {
            setDelDeal(null);
            qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
            qc.invalidateQueries({ queryKey: ["deals"] });
            qc.invalidateQueries({ queryKey: ["projects-deals"] });
          }}
        />
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">전체 프로젝트</div>
          <div className="text-2xl font-bold mono-number mt-0.5 text-[var(--text)]">{summary.total}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">진행중</div>
          <div className="text-2xl font-bold mono-number mt-0.5 text-amber-500">{summary.inProgress}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">총 계약금액 <span className="text-[10px] text-[var(--text-dim)]">(VAT별도)</span></div>
          <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]">{won(summary.totalContract)}</div>
          <div className="text-[10px] text-[var(--text-dim)] mt-0.5">VAT포함 {won(summary.totalContractWithVat)}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">평균 직접원가율</div>
          <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]" title="전표에 프로젝트를 태그한 직접원가 기준 (판관비 제외)">
            {summary.avgRatio == null ? <span className="text-[var(--text-dim)]">—</span> : `${Math.round(summary.avgRatio * 100)}%`}
          </div>
        </div>
      </div>

      {/* 목록 그리드 */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-auto max-h-[640px]">
          <table className="w-full min-w-[1180px] text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                {sortableTh("name", "프로젝트명", "px-3 py-2 text-left font-semibold")}
                {sortableTh("partner", "거래처", "px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60")}
                {sortableTh("manager", "담당자", "px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[100px]")}
                {sortableTh("stage", "단계", "px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[70px]")}
                {sortableTh("contract", "계약금액(VAT별도)", "px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]")}
                <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[90px]">VAT(10%)</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]">합계(VAT포함)</th>
                {sortableTh("direct_cost", "직접원가", "px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[110px]")}
                {sortableTh("cost_ratio", "원가율", "px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[70px]")}
                {sortableTh("progress", "진행률", "px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[100px]")}
                {sortableTh("period", "기간", "px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[150px]")}
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[110px]">관리</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} className="p-10 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="p-10 text-center text-[var(--text-muted)]">프로젝트가 없습니다. 워크플로우 보드에서 새 프로젝트를 추가하세요.</td></tr>
              ) : rows.map((d) => {
                const stage = (STAGE_ORDER.includes(d.stage) ? d.stage : "estimate") as ProjectStage;
                const sc = STAGE_COLOR[stage];
                const prog = progressByDeal[d.id];
                const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : null;
                const p = pnlByDeal[d.id];
                const ratio = p?.direct_cost_ratio != null ? Number(p.direct_cost_ratio) : null;
                return (
                  <tr key={d.id} onClick={() => router.push(`/projecthub/${d.id}`)}
                    className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50 cursor-pointer">
                    <td className="px-3 py-2 text-[var(--text)] font-medium">
                      {d.name || "(이름 없음)"}
                      {childCount[d.id] > 0 && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold align-middle" title={`세부 프로젝트 ${childCount[d.id]}개`}>
                          캠페인 {childCount[d.id]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{partnerName[d.partner_id] || "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{userName[d.internal_manager_id] || "—"}</td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
                    </td>
                    {(() => {
                      const sup = Number(d.contract_total || 0);
                      const vat = Math.round(sup * 0.1);
                      const dash = <span className="text-[var(--text-dim)]">—</span>;
                      return (<>
                        <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/30">{sup > 0 ? won(sup) : dash}</td>
                        <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] border-l border-[var(--border)]/30">{sup > 0 ? won(vat) : dash}</td>
                        <td className="px-3 py-2 text-right mono-number font-bold text-[var(--text)] border-l border-[var(--border)]/30">{sup > 0 ? won(sup + vat) : dash}</td>
                      </>);
                    })()}
                    <td className="px-3 py-2 text-right mono-number border-l border-[var(--border)]/30 text-[var(--text-muted)]">{p && Number(p.direct_cost) > 0 ? won(p.direct_cost) : <span className="text-[var(--text-dim)]">—</span>}</td>
                    <td className="px-3 py-2 text-center mono-number border-l border-[var(--border)]/30">
                      {ratio == null || ratio === 0 ? <span className="text-[var(--text-dim)] text-[11px]">—</span> : (
                        <span className={ratio >= 1 ? "text-red-500 font-semibold" : ratio >= 0.8 ? "text-amber-500" : "text-[var(--text)]"}>{Math.round(ratio * 100)}%</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-l border-[var(--border)]/30">
                      {pct == null ? <span className="text-[var(--text-dim)] text-[11px]">—</span> : (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] mono-number text-[var(--text-muted)] w-8 text-right">{pct}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/30 text-[11px]">
                      {fmtDate(d.start_date) || "—"}{d.end_date ? ` ~ ${fmtDate(d.end_date)}` : ""}
                    </td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30 whitespace-nowrap">
                      <button onClick={(e) => { e.stopPropagation(); setEditDeal(d); }}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 transition">수정</button>
                      <button onClick={(e) => { e.stopPropagation(); setDelDeal(d); }}
                        className="ml-1 px-2 py-1 text-[11px] font-semibold rounded-md text-red-400 bg-red-500/10 hover:bg-red-500/20 transition">삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">※ 프로젝트 운영(보드)과 같은 프로젝트(deal) 데이터입니다 — 한쪽에서 생성·삭제하면 양쪽에 반영됩니다. 원가율·손익은 손익 탭에서 산출됩니다.</p>
    </div>
  );
}

// 프로젝트 생성 모달 — deals 직접 insert (워크플로우 보드와 동일 데이터)
function ProjectFormModal({ companyId, partners, users, editDeal, onClose, onSaved }: {
  companyId: string; partners: any[]; users: any[]; editDeal?: any; onClose: () => void; onSaved: (id?: string) => void;
}) {
  const { toast } = useToast();
  const db = supabase as any;
  const isEdit = !!editDeal;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => editDeal ? {
    name: editDeal.name || "", partner_id: editDeal.partner_id || "", manager_id: editDeal.internal_manager_id || "",
    start_date: (editDeal.start_date || "").slice(0, 10), end_date: (editDeal.end_date || "").slice(0, 10),
    classification: editDeal.classification || "B2B",
    contract_total: editDeal.contract_total ? Number(editDeal.contract_total).toLocaleString("ko-KR") : "",
    vatType: "exclude" as "exclude" | "include", // 저장값은 이미 공급가액 → VAT별도로 표시(그대로 저장 시 값 유지)
  } : {
    name: "", partner_id: "", manager_id: "", start_date: "", end_date: "",
    classification: "B2B", contract_total: "", vatType: "exclude" as "exclude" | "include",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const comma = (s: string) => { const n = Number(String(s).replace(/[^0-9]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };

  const submit = async () => {
    if (!form.name.trim()) { toast("프로젝트명을 입력하세요", "error"); return; }
    const raw = Number(String(form.contract_total).replace(/[^0-9]/g, ""));
    setSaving(true);
    try {
      const contractAmount = form.vatType === "include" ? Math.round(raw / 1.1) : raw;
      const payload = {
        name: form.name.trim(), classification: form.classification,
        contract_total: contractAmount || 0,
        start_date: form.start_date || null, end_date: form.end_date || null,
        partner_id: form.partner_id || null, internal_manager_id: form.manager_id || null,
      };
      if (isEdit) {
        // 단계(stage)·상태(status)는 건드리지 않음 — 기본 정보만 수정
        const { error } = await db.from("deals").update(payload).eq("id", editDeal.id);
        if (error) throw new Error(error.message);
        toast("프로젝트가 수정되었습니다", "success");
        onSaved();
      } else {
        const { data, error } = await db.from("deals").insert({
          company_id: companyId, status: "active", stage: "estimate", ...payload,
        }).select("id").single();
        if (error) throw new Error(error.message);
        toast("프로젝트가 생성되었습니다", "success");
        onSaved(data?.id);
      }
    } catch (e: any) { toast(e?.message || (isEdit ? "수정 실패" : "생성 실패"), "error"); } finally { setSaving(false); }
  };

  const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">{isEdit ? "프로젝트 수정" : "+ 프로젝트 생성"}</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={LB}>프로젝트명 *</label>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="프로젝트명" className={IN} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LB}>거래처</label>
              <select value={form.partner_id} onChange={(e) => set({ partner_id: e.target.value })} className={IN}>
                <option value="">미지정</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LB}>담당자</label>
              <select value={form.manager_id} onChange={(e) => set({ manager_id: e.target.value })} className={IN}>
                <option value="">미지정</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LB}>분류</label>
              <select value={form.classification} onChange={(e) => set({ classification: e.target.value })} className={IN}>
                <option value="B2B">B2B</option><option value="B2C">B2C</option><option value="B2G">B2G</option>
              </select>
            </div>
            <div>
              <label className={LB}>계약금액</label>
              <div className="flex gap-1">
                <input value={form.contract_total} onChange={(e) => set({ contract_total: comma(e.target.value) })} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
                <select value={form.vatType} onChange={(e) => set({ vatType: e.target.value as "exclude" | "include" })} className="px-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                  <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                </select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LB}>시작일</label>
              <DateField value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} className={`${IN} mono-number`} />
            </div>
            <div>
              <label className={LB}>종료일</label>
              <DateField value={form.end_date} min={form.start_date || undefined} onChange={(e) => set({ end_date: e.target.value })} className={`${IN} mono-number`} />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
          <button onClick={submit} disabled={saving || !form.name.trim()} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "저장 중..." : isEdit ? "저장" : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 프로젝트 삭제 모달 — 이름 입력 확인 게이트 + 소프트 삭제(archived_at). 보드 삭제와 동일 정책.
function DeleteProjectModal({ deal, companyId, onClose, onDeleted }: {
  deal: any; companyId: string | null; onClose: () => void; onDeleted: () => void;
}) {
  const { toast } = useToast();
  const db = supabase as any;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const target = (deal.name || "").trim();
  const canDelete = typed.trim() === target && target.length > 0;

  const del = async () => {
    if (!canDelete || busy) return;
    setBusy(true);
    try {
      // 소프트 삭제 — archived_at 만 갱신. getDeals() 는 archived_at IS NULL 만 조회하므로 즉시 사라짐.
      const { error } = await db.from("deals").update({ archived_at: new Date().toISOString() }).eq("id", deal.id);
      if (error) throw new Error(error.message);
      // 감사 로그 (실패해도 비차단) — 보드 삭제와 동일 컬럼 구조
      try {
        await db.from("audit_logs").insert({
          company_id: companyId, entity_type: "deal", entity_id: deal.id, action: "delete",
          before_json: { archived_at: null, name: deal.name },
          after_json: { archived_at: new Date().toISOString() },
          metadata: { soft_delete: true, deal_name: deal.name },
        });
      } catch { /* audit 실패 무시 */ }
      toast("프로젝트가 삭제되었습니다", "success");
      onDeleted();
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4" onClick={() => !busy && onClose()}>
      <div className="bg-[var(--bg-card)] border border-red-500/30 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-red-400">프로젝트 삭제</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            <span className="font-bold text-[var(--text)]">{deal.name || "(이름 없음)"}</span> 프로젝트를 삭제하면 목록·보드 어디에서도 보이지 않습니다. (회계·자식 데이터는 보존되며, 복구 가능)
          </p>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">확인을 위해 프로젝트명을 입력하세요</label>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={target}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" autoFocus />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
          <button onClick={del} disabled={!canDelete || busy} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:opacity-90 disabled:opacity-40">
            {busy ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

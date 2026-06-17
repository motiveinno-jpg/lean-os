"use client";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import { useMemo, useState } from "react";
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

const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "");

export default function ProjectHubPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const role = user?.role;
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

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

  // 진행률 — deal_milestones 완료율 (없으면 null → "—")
  const dealIds = useMemo(() => (deals as any[]).map((d) => d.id), [deals]);
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

  const rows = useMemo(() => {
    return (deals as any[]).slice().sort((a, b) => Number(b.contract_total || 0) - Number(a.contract_total || 0));
  }, [deals]);

  const summary = useMemo(() => {
    const total = rows.length;
    const inProgress = rows.filter((d) => d.stage === "in_progress").length;
    const totalContract = rows.reduce((s, d) => s + Number(d.contract_total || 0), 0);
    const ratios = rows.map((d) => pnlByDeal[d.id]?.direct_cost_ratio).filter((r) => r != null && Number(r) > 0).map(Number);
    const avgRatio = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;
    return { total, inProgress, totalContract, avgRatio };
  }, [rows, pnlByDeal]);

  if (role && role !== "owner" && role !== "admin") return <AccessDenied />;

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">견적 → 계약 → 진행 → 손익까지 프로젝트별 라이프사이클·수익성을 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/projects" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">
            프로젝트 운영 보드 →
          </Link>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">
            + 프로젝트 생성
          </button>
        </div>
      </div>

      {showCreate && companyId && (
        <CreateProjectModal
          companyId={companyId}
          partners={partners as any[]}
          users={users as any[]}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["projecthub-deals"] }); if (id) router.push(`/projecthub/${id}`); }}
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
          <div className="text-xs text-[var(--text-muted)]">총 계약금액</div>
          <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]">{won(summary.totalContract)}</div>
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
          <table className="w-full min-w-[1000px] text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-3 py-2 text-left font-semibold">프로젝트명</th>
                <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60">거래처</th>
                <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[100px]">담당자</th>
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[70px]">단계</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]">계약금액</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[110px]">직접원가</th>
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[70px]">원가율</th>
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[100px]">진행률</th>
                <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[150px]">기간</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="p-10 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-[var(--text-muted)]">프로젝트가 없습니다. 워크플로우 보드에서 새 프로젝트를 추가하세요.</td></tr>
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
                    <td className="px-3 py-2 text-[var(--text)] font-medium">{d.name || "(이름 없음)"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{partnerName[d.partner_id] || "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{userName[d.internal_manager_id] || "—"}</td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
                    </td>
                    <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/30">{won(d.contract_total)}</td>
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
function CreateProjectModal({ companyId, partners, users, onClose, onCreated }: {
  companyId: string; partners: any[]; users: any[]; onClose: () => void; onCreated: (id?: string) => void;
}) {
  const { toast } = useToast();
  const db = supabase as any;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
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
      const { data, error } = await db.from("deals").insert({
        company_id: companyId, name: form.name.trim(), classification: form.classification,
        contract_total: contractAmount || 0, status: "active", stage: "estimate",
        start_date: form.start_date || null, end_date: form.end_date || null,
        partner_id: form.partner_id || null, internal_manager_id: form.manager_id || null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      toast("프로젝트가 생성되었습니다", "success");
      onCreated(data?.id);
    } catch (e: any) { toast(e?.message || "생성 실패", "error"); } finally { setSaving(false); }
  };

  const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">+ 프로젝트 생성</div>
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
              <input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} className={`${IN} mono-number`} />
            </div>
            <div>
              <label className={LB}>종료일</label>
              <input type="date" value={form.end_date} min={form.start_date || undefined} onChange={(e) => set({ end_date: e.target.value })} className={`${IN} mono-number`} />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
          <button onClick={submit} disabled={saving || !form.name.trim()} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

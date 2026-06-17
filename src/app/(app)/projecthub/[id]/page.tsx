"use client";

// 프로젝트 상세 (라이프사이클 탭) — 기존 deal 데이터 재사용. 2026-06-17 핸드오프 v2.
//   탭: 개요 / 견적서 / 계약 / 진행현황 / 손익. 모두 기존 테이블 읽기(연결·표시), 원본 무수정.
//   손익(원가율) 은 journal_entries.deal_id + v_deal_pnl 추가 후 별도 단계에서 채움.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";

const db = supabase as any;
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

// 프로젝트 기간(start~end)의 'YYYY-MM' 목록 — 판관비 풀 산정용. end 없으면 오늘까지, start 없으면 빈 배열(전체 사용).
function monthRange(start: string | null | undefined, end: string | null | undefined): string[] {
  if (!start) return [];
  const s = new Date(start);
  if (isNaN(s.getTime())) return [];
  const e = end ? new Date(end) : new Date();
  const last = isNaN(e.getTime()) ? new Date() : e;
  const out: string[] = [];
  const cur = new Date(s.getFullYear(), s.getMonth(), 1);
  let guard = 0;
  while (cur <= last && guard < 120) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
    guard++;
  }
  return out;
}

type TabKey = "overview" | "quote" | "contract" | "progress" | "pnl";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "quote", label: "견적서" },
  { key: "contract", label: "계약" },
  { key: "progress", label: "진행현황" },
  { key: "pnl", label: "손익" },
];

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const role = user?.role;
  const params = useParams();
  const dealId = String(params?.id || "");
  const [tab, setTab] = useState<TabKey>("overview");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const renameMut = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await db.from("deals").update({ name: name.trim() }).eq("id", dealId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projecthub-deal", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      setEditingName(false);
      toast("프로젝트명이 수정되었습니다", "success");
    },
    onError: (e: any) => toast(e?.message || "수정 실패", "error"),
  });
  const commitRename = () => {
    const v = nameInput.trim();
    if (!v || v === (deal?.name || "")) { setEditingName(false); return; }
    renameMut.mutate(v);
  };

  const { data: deal, isLoading } = useQuery({
    queryKey: ["projecthub-deal", dealId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("*").eq("id", dealId).maybeSingle();
      return data as any;
    },
    enabled: !!companyId && !!dealId,
  });
  const { data: partner } = useQuery({
    queryKey: ["projecthub-deal-partner", deal?.partner_id],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name, business_number, representative, contact_name, contact_email").eq("id", deal.partner_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.partner_id,
  });
  const { data: manager } = useQuery({
    queryKey: ["projecthub-deal-manager", deal?.internal_manager_id],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name").eq("id", deal.internal_manager_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.internal_manager_id,
  });

  // 견적/계약 — documents(deal_id) + quote_tracking + quote_approvals + signature_requests
  const { data: documents = [] } = useQuery({
    queryKey: ["projecthub-docs", dealId],
    queryFn: async () => {
      const { data } = await db.from("documents").select("id, name, status, content_type, contract_amount, document_number, created_at").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId && (tab === "quote" || tab === "contract"),
  });
  const docIds = useMemo(() => documents.map((d) => d.id), [documents]);
  const { data: quoteTracking = [] } = useQuery({
    queryKey: ["projecthub-quotes", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("quote_tracking").select("*").in("document_id", docIds);
      return (data || []) as any[];
    },
    enabled: tab === "quote" && docIds.length > 0,
  });
  const { data: approvals = [] } = useQuery({
    queryKey: ["projecthub-approvals", dealId],
    queryFn: async () => {
      const { data } = await db.from("quote_approvals").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: (tab === "quote" || tab === "contract") && !!dealId,
  });
  const { data: sigRequests = [] } = useQuery({
    queryKey: ["projecthub-sigs", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("signature_requests").select("id, title, status, signer_name, signer_email, signed_at, our_signed_at, signed_contract_url, document_id").in("document_id", docIds).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: tab === "contract" && docIds.length > 0,
  });

  // 진행현황 — deal_milestones + deal_nodes
  const { data: milestones = [] } = useQuery({
    queryKey: ["projecthub-ms", dealId],
    queryFn: async () => {
      const { data } = await db.from("deal_milestones").select("*").eq("deal_id", dealId).order("due_date", { ascending: true });
      return (data || []) as any[];
    },
    enabled: tab === "progress" && !!dealId,
  });
  const { data: nodes = [] } = useQuery({
    queryKey: ["projecthub-nodes", dealId],
    queryFn: async () => {
      const { data } = await db.from("deal_nodes").select("*").eq("deal_id", dealId).order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: tab === "progress" && !!dealId,
  });

  // 손익 — v_deal_pnl (직접원가·직접원가율) + financial_items(deal_id) 보조
  const { data: pnl } = useQuery({
    queryKey: ["projecthub-deal-pnl", dealId],
    queryFn: async () => {
      const { data } = await db.from("v_deal_pnl").select("*").eq("deal_id", dealId).maybeSingle();
      return data as any;
    },
    enabled: !!dealId && (tab === "overview" || tab === "pnl"),
  });
  const { data: finItems = [] } = useQuery({
    queryKey: ["projecthub-finitems", dealId],
    queryFn: async () => {
      const { data } = await db.from("financial_items").select("*").eq("deal_id", dealId).order("month", { ascending: false });
      return (data || []) as any[];
    },
    enabled: tab === "pnl" && !!dealId,
  });
  // 판관비 매출비례 배분(추정) — monthly_financials.fixed_cost 풀 × 매출 비중
  const { data: monthlyFin = [] } = useQuery({
    queryKey: ["projecthub-monthlyfin", companyId],
    queryFn: async () => {
      const { data } = await db.from("monthly_financials").select("month, fixed_cost").eq("company_id", companyId);
      return (data || []) as any[];
    },
    enabled: !!companyId && (tab === "overview" || tab === "pnl"),
  });
  const { data: allDeals = [] } = useQuery({
    queryKey: ["projecthub-allcontract", companyId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("contract_total").eq("company_id", companyId).is("archived_at", null);
      return (data || []) as any[];
    },
    enabled: !!companyId && (tab === "overview" || tab === "pnl"),
  });

  if (role && role !== "owner" && role !== "admin") return <AccessDenied />;
  if (isLoading) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>;
  if (!deal) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">프로젝트를 찾을 수 없습니다. <Link href="/projecthub" className="text-[var(--primary)] hover:underline">목록으로</Link></div>;

  const stage = (STAGE_ORDER.includes(deal.stage) ? deal.stage : "estimate") as ProjectStage;
  const sc = STAGE_COLOR[stage];
  const contract = Number(deal.contract_total || 0);
  const directCost = pnl ? Number(pnl.direct_cost || 0) : null;
  const margin = pnl ? Number(pnl.margin || 0) : null;
  const ratio = pnl?.direct_cost_ratio != null ? Number(pnl.direct_cost_ratio) : null;
  const ratioPct = ratio == null ? "—" : `${Math.round(ratio * 100)}%`;
  // 판관비 매출비례 배분(추정): 기간 풀 × (이 프로젝트 매출 / 전체 활성 프로젝트 매출)
  const totalContractAll = (allDeals as any[]).reduce((s, d) => s + Number(d.contract_total || 0), 0);
  const panbanMonths = monthRange(deal.start_date, deal.end_date);
  const panbanPool = (panbanMonths.length ? (monthlyFin as any[]).filter((f) => panbanMonths.includes(String(f.month).slice(0, 7))) : (monthlyFin as any[]))
    .reduce((s, f) => s + Number(f.fixed_cost || 0), 0);
  const allocPanban = totalContractAll > 0 && contract > 0 ? panbanPool * (contract / totalContractAll) : null;
  const totalCost = allocPanban != null && directCost != null ? directCost + allocPanban : null;
  const totalRatio = totalCost != null && contract > 0 ? totalCost / contract : null;
  const totalRatioPct = totalRatio == null ? "—" : `${Math.round(totalRatio * 100)}%`;

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/projecthub" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← 프로젝트</Link>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
          </div>
          {editingName ? (
            <input
              value={nameInput} autoFocus
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingName(false); }}
              className="text-2xl font-extrabold bg-transparent border-b-2 border-[var(--primary)] text-[var(--text)] focus:outline-none mt-1 w-full max-w-md"
            />
          ) : (
            <h1 onClick={() => { setNameInput(deal.name || ""); setEditingName(true); }}
              className="text-2xl font-extrabold text-[var(--text)] mt-1 truncate cursor-text hover:opacity-80 inline-flex items-center gap-1.5"
              title="클릭하여 프로젝트명 수정">
              {deal.name || "(이름 없음)"}
              <svg className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </h1>
          )}
          <p className="text-xs text-[var(--text-dim)] mt-1">{partner?.name || "거래처 미지정"}{manager?.name ? ` · 담당 ${manager.name}` : ""}</p>
        </div>
        <Link href={`/projects/${dealId}`} className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0">
          워크플로우에서 열기 →
        </Link>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition whitespace-nowrap ${tab === t.key ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 개요 */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric label="계약금액(매출)" value={won(contract)} />
            <Metric label="직접원가" value={directCost == null ? "—" : won(directCost)} hint="태그된 전표 비용 + 보정" />
            <Metric label="배분 판관비(추정)" value={allocPanban == null ? "—" : won(allocPanban)} hint="매출비례 배분 추정치" />
            <Metric label="총원가(추정)" value={totalCost == null ? "—" : won(totalCost)} hint="직접원가 + 배분 판관비" />
            <Metric label="직접원가율" value={ratioPct} />
            <Metric label="총원가율(추정)" value={totalRatioPct} hint="판관비 포함 추정" />
          </div>
          <div className="glass-card p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Info label="거래처" value={partner?.name || "—"} />
            <Info label="담당자" value={manager?.name || "—"} />
            <Info label="분류" value={deal.classification || "—"} />
            <Info label="단계" value={STAGE_LABEL[stage]} />
            <Info label="시작일" value={fmtDate(deal.start_date)} />
            <Info label="종료일" value={fmtDate(deal.end_date)} />
            <Info label="상태" value={deal.status || "—"} />
            <Info label="다음 액션" value={deal.next_action_text || "—"} />
          </div>
        </div>
      )}

      {/* 견적서 */}
      {tab === "quote" && (
        <div className="space-y-3">
          {documents.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 문서(견적서)가 없습니다." />
          ) : (
            <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
              {documents.map((doc) => {
                const qt = quoteTracking.find((q) => q.document_id === doc.id);
                return (
                  <div key={doc.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--text)] truncate">{doc.name || qt?.quote_title || "문서"}</div>
                      <div className="text-[11px] text-[var(--text-dim)]">{doc.content_type || "문서"} · {fmtDate(doc.created_at)}{doc.document_number ? ` · ${doc.document_number}` : ""}</div>
                    </div>
                    {qt && (
                      <div className="text-[11px] text-[var(--text-muted)] shrink-0">
                        열람 {qt.view_count ?? 0}회{qt.viewed_at ? ` · 최근 ${fmtDate(qt.viewed_at)}` : ""}
                      </div>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{qt?.status || doc.status || "—"}</span>
                    {doc.contract_amount != null && <span className="text-xs mono-number text-[var(--text)] shrink-0">{won(doc.contract_amount)}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").length > 0 && (
            <div className="glass-card p-4">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">견적 승인 흐름</div>
              {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").map((a) => (
                <ApprovalRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 계약 */}
      {tab === "contract" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">전자계약(전자서명) 상태입니다. 발송·관리는 전자계약 메뉴에서 합니다.</p>
            <Link href="/signatures" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">전자계약 메뉴 →</Link>
          </div>
          {sigRequests.length === 0 && approvals.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 전자계약·승인 내역이 없습니다." />
          ) : (
            <>
              {sigRequests.length > 0 && (
                <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
                  {sigRequests.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--text)] truncate">{s.title || "계약서"}</div>
                        <div className="text-[11px] text-[var(--text-dim)]">{s.signer_name || "—"}{s.signer_email ? ` · ${s.signer_email}` : ""}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{s.status}</span>
                      {s.signed_at && <span className="text-[11px] text-green-500 shrink-0">서명완료 {fmtDate(s.signed_at)}</span>}
                      {s.signed_contract_url && <a href={s.signed_contract_url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--primary)] hover:underline shrink-0">계약서</a>}
                    </div>
                  ))}
                </div>
              )}
              {approvals.length > 0 && (
                <div className="glass-card p-4">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2">단계별 승인</div>
                  {approvals.map((a) => <ApprovalRow key={a.id} a={a} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 진행현황 */}
      {tab === "progress" && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">마일스톤</div>
            {milestones.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)]">등록된 마일스톤이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {milestones.map((m) => {
                  const done = m.status === "completed" || !!m.completed_at;
                  return (
                    <div key={m.id} className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${done ? "bg-green-500" : "bg-[var(--border)]"}`} />
                      <span className={`text-sm flex-1 ${done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"}`}>{m.name || "마일스톤"}</span>
                      <span className="text-[11px] text-[var(--text-muted)] mono-number">{fmtDate(m.due_date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="glass-card p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">작업 항목 (매출·원가)</div>
            {nodes.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)]">등록된 작업 항목이 없습니다.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="px-2 py-1.5 text-left font-semibold">항목</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-[70px]">상태</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-[110px]">매출</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-[110px]">예정원가</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-[110px]">실제원가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <tr key={n.id} className="border-b border-[var(--border)]/30">
                        <td className="px-2 py-1.5 text-[var(--text)]">{n.name || n.title || "항목"}</td>
                        <td className="px-2 py-1.5 text-center text-[var(--text-muted)]">{n.status || "—"}</td>
                        <td className="px-2 py-1.5 text-right mono-number text-[var(--text)]">{n.revenue_amount != null ? won(n.revenue_amount) : "—"}</td>
                        <td className="px-2 py-1.5 text-right mono-number text-[var(--text-muted)]">{n.expected_cost != null ? won(n.expected_cost) : "—"}</td>
                        <td className="px-2 py-1.5 text-right mono-number text-[var(--text-muted)]">{n.actual_cost != null ? won(n.actual_cost) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 손익 */}
      {tab === "pnl" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric label="매출(계약금액)" value={won(contract)} />
            <Metric label="직접원가" value={directCost == null ? "—" : won(directCost)} />
            <Metric label="배분 판관비(추정)" value={allocPanban == null ? "—" : won(allocPanban)} />
            <Metric label="총원가(추정)" value={totalCost == null ? "—" : won(totalCost)} />
            <Metric label="직접원가율" value={ratioPct} />
            <Metric label="총원가율(추정)" value={totalRatioPct} />
          </div>
          <div className="glass-card p-4 text-[11px] text-[var(--text-muted)] space-y-1 leading-relaxed">
            <p>· <b className="text-[var(--text)]">직접원가</b> = 이 프로젝트로 태그된 전표(비용계정)의 차변 합계 + 수동 보정. 전표 입력 시 프로젝트를 선택하면 자동 집계됩니다(신규 입력분부터 · 기존 전표 백필 안 함).</p>
            <p>· <b className="text-[var(--text)]">배분 판관비</b> = 회사 고정비(monthly_financials) 중 프로젝트 기간({panbanMonths.length ? `${panbanMonths[0]}~${panbanMonths[panbanMonths.length - 1]}` : "전체"})분을 <b className="text-[var(--text)]">매출 비례로 배분한 추정치</b>입니다. 정밀 원가는 직접원가율을 우선 참고하세요.</p>
          </div>
          {finItems.length > 0 && (
            <div className="glass-card p-4">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">참고 — 비용 상세 (financial_items, 추정 보조)</div>
              <div className="divide-y divide-[var(--border)]/40">
                {finItems.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="text-[var(--text-dim)] mono-number w-16 shrink-0">{String(f.month || "").slice(0, 7)}</span>
                    <span className="text-[var(--text)] flex-1 truncate">{f.account_type || f.category || "비용"}</span>
                    <span className="mono-number text-[var(--text-muted)] shrink-0">{won(f.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-base font-bold mono-number mt-0.5 ${value === "—" ? "text-[var(--text-dim)]" : "text-[var(--text)]"}`} title={hint}>{value}</div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[var(--text-muted)] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[var(--text)] min-w-0 break-words">{value}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">{text}</div>;
}
function ApprovalRow({ a }: { a: any }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[var(--border)]/30 last:border-0">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{a.stage || "—"}</span>
      <span className="text-[var(--text)] flex-1 truncate">{a.recipient || a.recipient_name || "—"}</span>
      <span className="text-[var(--text-muted)] shrink-0">{a.status || "—"}</span>
      {(a.fully_signed_contract_url || a.signed_contract_url) && (
        <a href={a.fully_signed_contract_url || a.signed_contract_url} target="_blank" rel="noreferrer" className="text-[var(--primary)] hover:underline shrink-0">계약서</a>
      )}
    </div>
  );
}

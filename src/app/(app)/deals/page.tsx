"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getDeals, getDealClassifications, getDealMatchingStatuses, getDealWithNodes, buildTree, type TreeNode, getMilestones, getSubDeals, getAssignments, upsertMilestone, completeMilestone, getChannelByDeal, getMessages, getDormantDeals, reactivateDeal } from "@/lib/queries";
import { sendMessage, createChannel } from "@/lib/chat";
import { ClassificationBadge } from "@/components/classification-badge";
import { QueryErrorBanner } from "@/components/query-status";
import { getDealPipelineStatus, createDocumentFromDeal, onRevenueReceived, forceApproveDocument, type PipelineStage } from "@/lib/deal-pipeline";
import { autoCreatePartnerFromDeal } from "@/lib/partners";
import { applyCompanySeal } from "@/lib/signatures";
import { createDocumentShare, sendShareEmail } from "@/lib/document-sharing";
import { uploadFile } from "@/lib/file-storage";
import { generateQuotePDF, generateContractPDF } from "@/lib/document-generator";
import type { DealMilestone } from "@/types/models";
import Link from "next/link";
import { useToast } from "@/components/toast";

const DEFAULT_COLORS: Record<string, string> = { B2B: '#3b82f6', B2C: '#22c55e', B2G: '#f59e0b' };

const DEAL_STATUS_LABEL: Record<string, string> = {
  active: '진행중', pending: '대기', completed: '완료', archived: '아카이브',
  negotiation: '협상중', proposal: '제안', contract_signed: '계약완료',
  in_progress: '진행중', closed_won: '수주', closed_lost: '실주', dormant: '휴면',
};

// ── Priority & Risk Config (E-6) ──

type DealPriority = 'high' | 'medium' | 'low';
type DealRisk = 'safe' | 'caution' | 'danger';

const PRIORITY_CONFIG: Record<DealPriority, { label: string; color: string; bg: string }> = {
  high:   { label: '높음', color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  medium: { label: '보통', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  low:    { label: '낮음', color: '#6B7280', bg: 'rgba(107,114,128,0.1)' },
};

const RISK_CONFIG: Record<DealRisk, { label: string; color: string; bg: string }> = {
  safe:    { label: '안전', color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  caution: { label: '주의', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  danger:  { label: '위험', color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
};

function PriorityBadge({ priority }: { priority?: string | null }) {
  if (!priority || !(priority in PRIORITY_CONFIG)) return null;
  const cfg = PRIORITY_CONFIG[priority as DealPriority];
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
      style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.color}30` }}
    >
      {cfg.label}
    </span>
  );
}

function RiskBadge({ risk }: { risk?: string | null }) {
  if (!risk || !(risk in RISK_CONFIG)) return null;
  const cfg = RISK_CONFIG[risk as DealRisk];
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
      style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.color}30` }}
    >
      {cfg.label}
    </span>
  );
}

// ── Deal Detail ──

function NodeRow({ node, depth, dealId, onRefresh }: { node: TreeNode; depth: number; dealId: string; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const revAmt = Number(node.revenue_amount) || 0;
  const actCost = Number(node.actual_cost) || 0;
  const margin = revAmt > 0 ? ((revAmt - actCost) / revAmt * 100) : 0;
  const marginColor = margin < 20 ? "text-red-400" : margin < 35 ? "text-yellow-400" : "text-green-400";

  async function addChild() {
    if (!newName.trim()) return;
    await supabase.from("deal_nodes").insert({ deal_id: dealId, parent_id: node.id, name: newName.trim(), status: "pending" });
    setNewName(""); setShowAdd(false); onRefresh();
  }

  return (
    <div>
      <div className="flex items-center gap-2 py-2 px-3 hover:bg-[var(--bg-surface)] rounded-lg transition group" style={{ paddingLeft: `${depth * 24 + 12}px` }}>
        <button onClick={() => setExpanded(!expanded)} className="w-5 h-5 flex items-center justify-center text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
          {node.children.length > 0 ? (expanded ? "▼" : "▶") : "·"}
        </button>
        <span className="text-sm font-medium flex-1">{node.name}</span>
        <span className="text-xs text-green-400 w-24 text-right">{revAmt > 0 ? `₩${revAmt.toLocaleString()}` : "—"}</span>
        <span className="text-xs text-[var(--text-muted)] w-24 text-right">{Number(node.expected_cost) > 0 ? `₩${Number(node.expected_cost).toLocaleString()}` : "—"}</span>
        <span className="text-xs text-red-400 w-24 text-right">{actCost > 0 ? `₩${actCost.toLocaleString()}` : "—"}</span>
        <span className={`text-xs font-bold w-16 text-right ${marginColor}`}>{revAmt > 0 ? `${margin.toFixed(1)}%` : "—"}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full w-14 text-center ${node.status === "done" ? "bg-green-500/10 text-green-400" : node.status === "active" ? "bg-blue-500/10 text-blue-400" : "bg-gray-500/10 text-gray-400"}`}>
          {node.status === "done" ? "완료" : node.status === "active" ? "진행" : "대기"}
        </span>
        <button onClick={() => setShowAdd(!showAdd)} className="opacity-0 group-hover:opacity-100 text-xs text-[var(--primary)] hover:text-[var(--text)] transition px-1">+</button>
      </div>
      {showAdd && (
        <div className="flex items-center gap-2 py-2" style={{ paddingLeft: `${(depth + 1) * 24 + 32}px` }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addChild()} placeholder="하위 항목명" className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] w-48" autoFocus />
          <button onClick={addChild} className="text-xs text-[var(--primary)] font-semibold">추가</button>
          <button onClick={() => setShowAdd(false)} className="text-xs text-[var(--text-dim)]">취소</button>
        </div>
      )}
      {expanded && node.children.map((child: TreeNode) => (<NodeRow key={child.id} node={child} depth={depth + 1} dealId={dealId} onRefresh={onRefresh} />))}
    </div>
  );
}

function DealDetailView({ dealId, onBack }: { dealId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showAddRoot, setShowAddRoot] = useState(false);
  const [rootName, setRootName] = useState("");
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [msForm, setMsForm] = useState({ name: "", due_date: "" });
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [chatMsg, setChatMsg] = useState("");
  const [quoteItems, setQuoteItems] = useState<any[]>([]);
  const [paymentRatio, setPaymentRatio] = useState<{ advance: number; balance: number }>({ advance: 30, balance: 70 });

  useEffect(() => { getCurrentUser().then((u) => { if (u) { setUserId(u.id); setCompanyId(u.company_id); } }); }, []);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["deal-detail", dealId], queryFn: () => getDealWithNodes(dealId), enabled: !!dealId });
  const { data: milestones = [], refetch: refetchMs } = useQuery({ queryKey: ["milestones", dealId], queryFn: () => getMilestones(dealId), enabled: !!dealId });
  const { data: subDeals = [] } = useQuery({ queryKey: ["sub-deals", dealId], queryFn: () => getSubDeals(dealId), enabled: !!dealId });
  const { data: assignments = [] } = useQuery({ queryKey: ["assignments", dealId], queryFn: () => getAssignments(dealId), enabled: !!dealId });

  const addMilestoneMut = useMutation({ mutationFn: () => upsertMilestone({ deal_id: dealId, name: msForm.name, due_date: msForm.due_date }), onSuccess: () => { refetchMs(); setShowMilestoneForm(false); setMsForm({ name: "", due_date: "" }); } });
  const completeMsMut = useMutation({ mutationFn: (id: string) => completeMilestone(id, userId || undefined), onSuccess: () => refetchMs() });

  const { data: dealChannel } = useQuery({ queryKey: ["deal-channel", dealId], queryFn: () => getChannelByDeal(dealId, companyId!), enabled: !!dealId && !!companyId });
  const { data: recentMessages = [] } = useQuery({ queryKey: ["deal-chat-messages", dealChannel?.id], queryFn: () => getMessages(dealChannel!.id, 5), enabled: !!dealChannel?.id, refetchInterval: 5000 });
  const createChannelMut = useMutation({ mutationFn: () => { if (!userId || !companyId) throw new Error("Not authenticated"); return createChannel({ companyId, dealId, type: 'deal', name: `${deal?.name || '딜'} 채팅`, creatorUserId: userId }); }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deal-channel", dealId] }) });
  const sendChatMut = useMutation({ mutationFn: () => { if (!userId) throw new Error("Not authenticated"); return sendMessage({ channelId: dealChannel!.id, senderId: userId, content: chatMsg }); }, onSuccess: () => { setChatMsg(""); queryClient.invalidateQueries({ queryKey: ["deal-chat-messages", dealChannel?.id] }); } });

  const tree = data?.nodes ? buildTree(data.nodes) : [];
  const deal = data?.deal;
  const totalRevenue = (data?.revenue || []).reduce((s, r) => s + Number(r.amount), 0);
  const totalCost = (data?.costs || []).reduce((s, c) => s + Number(c.amount), 0);
  const dealMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;

  async function addRootNode() {
    if (!rootName.trim()) return;
    await supabase.from("deal_nodes").insert({ deal_id: dealId, parent_id: null, name: rootName.trim(), status: "pending" });
    setRootName(""); setShowAddRoot(false); refetch();
  }

  if (isLoading) return <div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>;
  if (!deal) return <div className="text-center py-20 text-[var(--text-muted)]">딜을 찾을 수 없습니다.</div>;

  return (
    <div className="max-w-[1100px]">
      <div className="text-xs text-[var(--text-dim)] mb-4"><button onClick={onBack} className="hover:text-[var(--primary)]">딜 관리</button><span className="mx-2">›</span><span className="text-[var(--text-muted)]">{deal.name}</span></div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            {deal.deal_number && <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] font-mono">{deal.deal_number}</span>}
            <h1 className="text-2xl font-extrabold">{deal.name}</h1>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-[var(--text-muted)]"><span>계약금: ₩{Number(deal.contract_total || 0).toLocaleString()}</span>{deal.start_date && <span>{deal.start_date} ~ {deal.end_date || "진행중"}</span>}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={dealChannel ? `/chat?channel=${dealChannel.id}` : `/chat`} className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition">💬 채팅</Link>
          {deal.status !== 'archived' && (<button onClick={async () => { if (!confirm('이 딜을 아카이브하시겠습니까?\n대시보드/목록에서 숨겨집니다.')) return; const { archiveDeal } = await import('@/lib/archiving'); await archiveDeal(dealId); queryClient.invalidateQueries({ queryKey: ['deal'] }); }} className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition">아카이브</button>)}
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${deal.status === 'active' ? 'bg-green-500/10 text-green-400' : deal.status === 'archived' ? 'bg-orange-500/10 text-orange-400' : 'bg-gray-500/10 text-gray-400'}`}>{DEAL_STATUS_LABEL[deal.status || ''] || deal.status || '대기'}</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4"><div className="text-xs text-[var(--text-dim)]">총 매출</div><div className="text-lg font-bold text-green-400 mt-1">₩{totalRevenue.toLocaleString()}</div></div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4"><div className="text-xs text-[var(--text-dim)]">총 비용</div><div className="text-lg font-bold text-red-400 mt-1">₩{totalCost.toLocaleString()}</div></div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4"><div className="text-xs text-[var(--text-dim)]">마진</div><div className={`text-lg font-bold mt-1 ${dealMargin < 20 ? 'text-red-400' : dealMargin < 35 ? 'text-yellow-400' : 'text-green-400'}`}>{dealMargin.toFixed(1)}%</div></div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4"><div className="text-xs text-[var(--text-dim)]">작업 단계</div><div className="text-lg font-bold mt-1">{data?.nodes.length || 0}</div></div>
      </div>
      <DealPipelineWidget dealId={dealId} companyId={companyId} userId={userId} onRefresh={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["deal-detail"] }); }} quoteItems={quoteItems} paymentRatio={paymentRatio} />
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between"><h2 className="text-sm font-bold">견적 품목 / 결제 비율</h2><button onClick={() => setQuoteItems(prev => prev.length === 0 ? [{ name: deal?.name || '', quantity: 1, unitPrice: Number(deal?.contract_total || 0), supplyAmount: Number(deal?.contract_total || 0), taxAmount: Math.round(Number(deal?.contract_total || 0) * 0.1), totalAmount: Math.round(Number(deal?.contract_total || 0) * 1.1), note: '' }] : prev)} className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">{quoteItems.length === 0 ? '+ 품목 추가' : `${quoteItems.length}건`}</button></div>
        <div className="px-5 py-3 border-b border-[var(--border)]/50 flex items-center gap-4">
          <span className="text-xs text-[var(--text-dim)] font-medium w-20 flex-shrink-0">결제 비율</span>
          <div className="flex items-center gap-2"><label className="text-xs text-[var(--text-muted)]">선금</label><input type="number" min={0} max={100} value={paymentRatio.advance} onChange={(e) => { const adv = Math.max(0, Math.min(100, Number(e.target.value) || 0)); setPaymentRatio({ advance: adv, balance: 100 - adv }); }} className="w-16 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-right focus:outline-none focus:border-[var(--primary)]" /><span className="text-xs text-[var(--text-dim)]">%</span></div>
          <div className="flex items-center gap-2"><label className="text-xs text-[var(--text-muted)]">잔금</label><input type="number" min={0} max={100} value={paymentRatio.balance} onChange={(e) => { const bal = Math.max(0, Math.min(100, Number(e.target.value) || 0)); setPaymentRatio({ advance: 100 - bal, balance: bal }); }} className="w-16 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-right focus:outline-none focus:border-[var(--primary)]" /><span className="text-xs text-[var(--text-dim)]">%</span></div>
          <span className="text-[10px] text-[var(--text-dim)] ml-auto">합계 {paymentRatio.advance + paymentRatio.balance}%{paymentRatio.advance + paymentRatio.balance !== 100 && (<span className="text-red-400 ml-1">(100%가 아님)</span>)}</span>
        </div>
        {quoteItems.length > 0 && (<div className="overflow-x-auto"><table className="w-full min-w-[700px] text-xs"><thead><tr className="text-[var(--text-dim)] border-b border-[var(--border)]"><th className="text-left px-3 py-2 font-medium">품명</th><th className="text-right px-3 py-2 font-medium w-20">수량</th><th className="text-right px-3 py-2 font-medium w-24">단가</th><th className="text-right px-3 py-2 font-medium w-24">공급가액</th><th className="text-right px-3 py-2 font-medium w-24">세액(10%)</th><th className="text-right px-3 py-2 font-medium w-28">합계</th><th className="w-10" /></tr></thead><tbody>{quoteItems.map((item: any, idx: number) => (<tr key={idx} className="border-b border-[var(--border)]/50"><td className="px-3 py-2"><input value={item.name || ''} onChange={(e) => { const arr = [...quoteItems]; arr[idx] = { ...arr[idx], name: e.target.value }; setQuoteItems(arr); }} placeholder="품목명" className="w-full bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" /></td><td className="px-3 py-2 text-right"><input type="number" value={item.quantity || 0} onChange={(e) => { const arr = [...quoteItems]; const q = Number(e.target.value) || 0; const u = arr[idx].unitPrice || 0; const supply = q * u; arr[idx] = { ...arr[idx], quantity: q, supplyAmount: supply, taxAmount: Math.round(supply * 0.1), totalAmount: Math.round(supply * 1.1) }; setQuoteItems(arr); }} className="w-full text-right bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" /></td><td className="px-3 py-2 text-right"><input type="number" value={item.unitPrice || 0} onChange={(e) => { const arr = [...quoteItems]; const u = Number(e.target.value) || 0; const q = arr[idx].quantity || 0; const supply = q * u; arr[idx] = { ...arr[idx], unitPrice: u, supplyAmount: supply, taxAmount: Math.round(supply * 0.1), totalAmount: Math.round(supply * 1.1) }; setQuoteItems(arr); }} className="w-full text-right bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" /></td><td className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">{Number(item.supplyAmount || 0).toLocaleString()}</td><td className="px-3 py-2 text-right text-[var(--text-muted)]">{Number(item.taxAmount || 0).toLocaleString()}</td><td className="px-3 py-2 text-right font-bold">{Number(item.totalAmount || 0).toLocaleString()}</td><td className="px-2 py-2 text-center">{quoteItems.length > 1 && (<button onClick={() => setQuoteItems(quoteItems.filter((_: any, i: number) => i !== idx))} className="text-red-400 hover:text-red-300 text-xs">X</button>)}</td></tr>))}</tbody><tfoot><tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]"><td colSpan={3} className="px-3 py-2 text-xs font-bold text-[var(--text-muted)]">합계</td><td className="px-3 py-2 text-right text-xs font-bold">{quoteItems.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0).toLocaleString()}</td><td className="px-3 py-2 text-right text-xs font-bold">{quoteItems.reduce((s: number, i: any) => s + Number(i.taxAmount || 0), 0).toLocaleString()}</td><td className="px-3 py-2 text-right text-xs font-black">{quoteItems.reduce((s: number, i: any) => s + Number(i.totalAmount || 0), 0).toLocaleString()}</td><td /></tr><tr className="bg-[var(--bg-surface)]"><td colSpan={7} className="px-3 py-1.5 text-[10px] text-[var(--text-dim)]">공급가액 합계: ₩{quoteItems.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0).toLocaleString()} &nbsp;|&nbsp; 세액 합계: ₩{quoteItems.reduce((s: number, i: any) => s + Number(i.taxAmount || 0), 0).toLocaleString()} &nbsp;|&nbsp; 총액(VAT포함): ₩{quoteItems.reduce((s: number, i: any) => s + Number(i.totalAmount || 0), 0).toLocaleString()}</td></tr></tfoot></table><div className="px-5 py-2 border-t border-[var(--border)]/50"><button onClick={() => setQuoteItems([...quoteItems, { name: '', quantity: 1, unitPrice: 0, supplyAmount: 0, taxAmount: 0, totalAmount: 0, note: '' }])} className="text-xs text-[var(--primary)] hover:underline">+ 품목 추가</button></div></div>)}
        {quoteItems.length === 0 && (<div className="px-5 py-4 text-center text-xs text-[var(--text-dim)]">품목을 추가하면 견적서 생성 시 자동으로 반영됩니다</div>)}
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between"><h2 className="text-sm font-bold">작업 트리 (무한 구조)</h2><button onClick={() => setShowAddRoot(!showAddRoot)} className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">+ 작업 추가</button></div>
        <div className="flex items-center gap-2 py-2 px-5 text-[10px] text-[var(--text-dim)] font-medium border-b border-[var(--border)]/50"><span className="flex-1" style={{ paddingLeft: "32px" }}>항목명</span><span className="w-24 text-right">매출</span><span className="w-24 text-right">예상비용</span><span className="w-24 text-right">실비용</span><span className="w-16 text-right">마진</span><span className="w-14 text-center">상태</span><span className="w-5" /></div>
        {showAddRoot && (<div className="flex items-center gap-2 py-2 px-5"><input value={rootName} onChange={(e) => setRootName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRootNode()} placeholder="작업 단계명 (예: 1차 수행)" className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] w-64" autoFocus /><button onClick={addRootNode} className="text-xs text-[var(--primary)] font-semibold">추가</button><button onClick={() => setShowAddRoot(false)} className="text-xs text-[var(--text-dim)]">취소</button></div>)}
        {tree.length === 0 ? (<div className="p-10 text-center text-sm text-[var(--text-muted)]">작업 단계가 없습니다. 새 작업을 추가해주세요.</div>) : (<div className="py-1">{tree.map((node) => (<NodeRow key={node.id} node={node} depth={0} dealId={dealId} onRefresh={refetch} />))}</div>)}
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-[var(--border)]"><h2 className="text-sm font-bold">매출 스케줄</h2></div>
        {(data?.revenue || []).length === 0 ? (<div className="p-6 text-center text-sm text-[var(--text-muted)]">등록된 매출 스케줄이 없습니다.</div>) : (<table className="w-full"><thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]"><th className="text-left px-5 py-2 font-medium">예정일</th><th className="text-right px-5 py-2 font-medium">금액</th><th className="text-left px-5 py-2 font-medium">유형</th><th className="text-left px-5 py-2 font-medium">발신처</th><th className="text-center px-5 py-2 font-medium">상태</th></tr></thead><tbody>{(data?.revenue || []).map((r) => (<tr key={r.id} className="border-b border-[var(--border)]/50"><td className="px-5 py-2.5 text-sm">{r.due_date || "—"}</td><td className="px-5 py-2.5 text-sm text-right font-medium text-green-400">₩{Number(r.amount).toLocaleString()}</td><td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{r.type || "—"}</td><td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{r.expected_sender || "—"}</td><td className="px-5 py-2.5 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'received' ? 'bg-green-500/10 text-green-400' : r.status === 'overdue' ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10 text-gray-400'}`}>{r.status === 'received' ? '수금' : r.status === 'overdue' ? '연체' : '예정'}</span></td></tr>))}</tbody></table>)}
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between"><h2 className="text-sm font-bold">마일스톤 / D-day</h2><button onClick={() => setShowMilestoneForm(!showMilestoneForm)} className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">+ 마일스톤</button></div>
        {showMilestoneForm && (<div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]/50"><input value={msForm.name} onChange={(e) => setMsForm({ ...msForm, name: e.target.value })} placeholder="마일스톤명" className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] w-48" /><input type="date" value={msForm.due_date} onChange={(e) => setMsForm({ ...msForm, due_date: e.target.value })} className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /><button onClick={() => msForm.name && msForm.due_date && addMilestoneMut.mutate()} disabled={!msForm.name || !msForm.due_date} className="text-xs text-[var(--primary)] font-semibold disabled:opacity-50">추가</button><button onClick={() => setShowMilestoneForm(false)} className="text-xs text-[var(--text-dim)]">취소</button></div>)}
        {milestones.length === 0 ? (<div className="p-6 text-center text-sm text-[var(--text-muted)]">마일스톤이 없습니다.</div>) : (<div className="divide-y divide-[var(--border)]/50">{milestones.map((ms: DealMilestone) => { const daysLeft = Math.ceil((new Date(ms.due_date).getTime() - Date.now()) / 86400000); const isOverdue = daysLeft < 0 && ms.status !== 'completed'; return (<div key={ms.id} className="flex items-center gap-3 px-5 py-3"><button onClick={() => ms.status !== 'completed' && completeMsMut.mutate(ms.id)} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${ms.status === 'completed' ? 'border-green-400 bg-green-400/20 text-green-400 text-[10px]' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}>{ms.status === 'completed' && '✓'}</button><div className="flex-1 min-w-0"><span className={`text-sm ${ms.status === 'completed' ? 'line-through text-[var(--text-dim)]' : ''}`}>{ms.name}</span></div><span className="text-xs text-[var(--text-dim)]">{ms.due_date}</span>{ms.status !== 'completed' && (<span className={`text-xs font-bold ${isOverdue ? 'text-red-400' : daysLeft <= 3 ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>{isOverdue ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}</span>)}</div>); })}</div>)}
      </div>
      {subDeals.length > 0 && (<div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6"><div className="px-5 py-4 border-b border-[var(--border)]"><h2 className="text-sm font-bold">서브딜 (외주/파트너)</h2></div><div className="divide-y divide-[var(--border)]/50">{subDeals.map((sd: any) => (<div key={sd.id} className="flex items-center justify-between px-5 py-3"><div><span className="text-sm font-medium">{sd.name}</span><span className="text-xs text-[var(--text-dim)] ml-2">{sd.vendors?.name || sd.type}</span></div><div className="text-right"><span className="text-sm font-bold">₩{Number(sd.contract_amount || 0).toLocaleString()}</span><span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${sd.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{sd.status === 'active' ? '진행중' : sd.status}</span></div></div>))}</div></div>)}
      {assignments.length > 0 && (<div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6"><div className="px-5 py-4 border-b border-[var(--border)]"><h2 className="text-sm font-bold">담당자</h2></div><div className="divide-y divide-[var(--border)]/50">{assignments.map((a: any) => (<div key={a.id} className="flex items-center justify-between px-5 py-3"><div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-xs font-bold">{(a.users?.name || a.users?.email || '?')[0]}</div><span className="text-sm">{a.users?.name || a.users?.email}</span></div><span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">{a.role === 'manager' ? '담당자' : a.role === 'reviewer' ? '검토자' : '참여자'}</span></div>))}</div></div>)}
      <ProjectFilesSection dealId={dealId} companyId={companyId} userId={userId} />
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between"><h2 className="text-sm font-bold">💬 딜 채팅</h2>{dealChannel && (<Link href={`/chat?channel=${dealChannel.id}`} className="text-[10px] text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">전체 채팅 보기 &rarr;</Link>)}</div>
        {!dealChannel ? (<div className="p-6 text-center"><div className="text-sm text-[var(--text-muted)] mb-3">이 딜에 연결된 채팅이 없습니다</div><button onClick={() => userId && companyId && createChannelMut.mutate()} disabled={createChannelMut.isPending || !userId} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">{createChannelMut.isPending ? '생성 중...' : '딜 채팅 생성'}</button></div>) : (<div><div className="px-5 py-3 max-h-48 overflow-y-auto">{recentMessages.length === 0 ? (<div className="text-center text-xs text-[var(--text-dim)] py-4">메시지가 없습니다</div>) : (recentMessages.map((msg: any) => (<div key={msg.id} className="flex items-start gap-2 py-1.5"><div className="w-5 h-5 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[9px] font-bold text-[var(--primary)] flex-shrink-0 mt-0.5">{(msg.users?.name || msg.users?.email || '?')[0].toUpperCase()}</div><div className="min-w-0"><span className="text-[10px] font-semibold text-[var(--text-muted)]">{msg.users?.name || msg.users?.email}</span><div className="text-xs text-[var(--text)]">{msg.content}</div></div></div>)))}</div><div className="px-5 py-3 border-t border-[var(--border)]/50 flex gap-2"><input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && chatMsg.trim() && sendChatMut.mutate()} placeholder="빠른 메시지..." className="flex-1 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /><button onClick={() => chatMsg.trim() && sendChatMut.mutate()} disabled={!chatMsg.trim() || sendChatMut.isPending} className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-30">전송</button></div></div>)}
      </div>
    </div>
  );
}

// ── Project Files Section ──

function ProjectFilesSection({ dealId, companyId, userId }: { dealId: string; companyId: string | null; userId: string | null }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const db2 = supabase as any;

  const { data: files = [], refetch: refetchFiles } = useQuery({
    queryKey: ['deal-files', dealId],
    queryFn: async () => {
      const { data } = await db2.from('deal_files').select('id, file_name, file_url, file_size, created_at, uploaded_by').eq('deal_id', dealId).order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!dealId,
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !companyId || !userId) return;
    setUploading(true);
    try {
      const result = await uploadFile({ file, companyId, bucket: 'document-files', context: { dealId }, userId });
      await db2.from('deal_files').insert({ deal_id: dealId, company_id: companyId, file_name: file.name, file_url: result.fileUrl, file_size: file.size, uploaded_by: userId });
      refetchFiles();
    } catch (err) {
      console.error('File upload failed:', err);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-sm font-bold">프로젝트 파일</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-dim)]">{files.length}개 파일</span>
          <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading || !companyId || !userId} className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-[var(--primary-hover)] transition">
            {uploading ? '업로드 중...' : '+ 파일 업로드'}
          </button>
        </div>
      </div>
      {files.length === 0 ? (
        <div className="p-6 text-center text-sm text-[var(--text-muted)]">첨부된 파일이 없습니다</div>
      ) : (
        <div className="divide-y divide-[var(--border)]/50">
          {files.map((f: any) => (
            <div key={f.id} className="flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-surface)] transition">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg flex-shrink-0">📎</span>
                <div className="min-w-0">
                  <a href={f.file_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--primary)] hover:underline truncate block">{f.file_name}</a>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{f.file_size ? formatFileSize(f.file_size) : ''} {f.created_at ? `· ${new Date(f.created_at).toLocaleDateString('ko')}` : ''}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Deal Pipeline Widget ──

const PIPELINE_STAGES: { key: PipelineStage['stage']; label: string; icon: string }[] = [
  { key: 'quote', label: '견적서', icon: '📄' }, { key: 'contract', label: '계약서', icon: '📝' }, { key: 'tax_invoice', label: '세금계산서', icon: '🧾' }, { key: 'payment_schedule', label: '입금 스케줄', icon: '📅' }, { key: 'payment_received', label: '입금 완료', icon: '💰' },
];

const CONTRACT_TEMPLATES = [
  { key: 'marketing', label: '마케팅대행 계약서' },
  { key: 'design', label: '디자인용역 계약서' },
  { key: 'general', label: '기본 용역계약서' },
];

function DealPipelineWidget({ dealId, companyId, userId, onRefresh, quoteItems, paymentRatio }: { dealId: string; companyId: string | null; userId: string | null; onRefresh: () => void; quoteItems?: any[]; paymentRatio?: { advance: number; balance: number } }) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false); const [confirming, setConfirming] = useState(false); const [forceApproving, setForceApproving] = useState(false);
  const [contractTemplate, setContractTemplate] = useState('general');
  const [sealApplying, setSealApplying] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [emailModal, setEmailModal] = useState<{ documentId: string } | null>(null);
  const [emailTab, setEmailTab] = useState<'existing' | 'new'>('existing');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerResults, setPartnerResults] = useState<any[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [newPartner, setNewPartner] = useState({ name: '', email: '', business_number: '', contact_phone: '' });
  const [partnerSaving, setPartnerSaving] = useState(false);
  const queryClient = useQueryClient(); const db2 = supabase as any;
  const { data: stages = [] } = useQuery({ queryKey: ['deal-pipeline', dealId], queryFn: () => getDealPipelineStatus(dealId), enabled: !!dealId });
  const completedCount = stages.filter(s => s.status === 'completed').length;
  const progress = stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0;
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  async function handleCreateQuote() { if (!companyId || !userId || creating) return; setCreating(true); setPipelineError(null); try { await createDocumentFromDeal({ companyId, dealId, docType: 'invoice', createdBy: userId, items: quoteItems && quoteItems.length > 0 ? quoteItems : undefined, paymentRatio }); queryClient.invalidateQueries({ queryKey: ['deal-pipeline', dealId] }); onRefresh(); } catch (err: any) { setPipelineError(`견적서 생성 실패: ${err?.message || '알 수 없는 오류'}`); } setCreating(false); }

  const hasQuote = stages.some(s => s.stage === 'quote' && s.status !== 'pending');
  const paymentStage = stages.find(s => s.stage === 'payment_received');
  const scheduleStage = stages.find(s => s.stage === 'payment_schedule');
  const canConfirmRevenue = scheduleStage?.status === 'completed' && paymentStage?.status === 'active';
  const activeQuote = stages.find(s => s.stage === 'quote' && s.status === 'active');
  const activeContract = stages.find(s => s.stage === 'contract' && s.status === 'active');
  const forceApproveTarget = activeQuote || activeContract;

  async function handleForceApprove() { if (!companyId || !userId || !forceApproveTarget?.documentId || forceApproving) return; setForceApproving(true); try { await forceApproveDocument({ documentId: forceApproveTarget.documentId, companyId, approverId: userId, reason: '업체 미응답으로 임의 승인' }); queryClient.invalidateQueries({ queryKey: ['deal-pipeline', dealId] }); onRefresh(); } catch (err: any) { setPipelineError(`임의 승인 실패: ${err?.message || '알 수 없는 오류'}`); } setForceApproving(false); }
  async function handleConfirmRevenue() { if (!companyId || !userId || confirming) return; setConfirming(true); setPipelineError(null); try { const { data: schedules } = await db2.from('deal_revenue_schedule').select('id, amount, status').eq('deal_id', dealId).eq('status', 'expected').order('due_date', { ascending: true }).limit(1); if (schedules && schedules.length > 0) { const entry = schedules[0]; await onRevenueReceived({ dealId, companyId, amount: Number(entry.amount), userId, revenueScheduleId: entry.id }); } queryClient.invalidateQueries({ queryKey: ['deal-pipeline', dealId] }); onRefresh(); } catch (err: any) { setPipelineError(`입금 확인 실패: ${err?.message || '알 수 없는 오류'}`); } setConfirming(false); }
  async function handleApplySeal(documentId: string) { if (!companyId || sealApplying) return; setSealApplying(true); setPipelineError(null); try { await applyCompanySeal({ documentId, companyId, appliedBy: userId || '' }); queryClient.invalidateQueries({ queryKey: ['deal-pipeline', dealId] }); onRefresh(); } catch (err: any) { setPipelineError(`직인 적용 실패: ${err?.message || '알 수 없는 오류'}`); } setSealApplying(false); }

  // 견적서/계약서 미리보기
  async function handlePreview(documentId: string) {
    if (previewLoading) return;
    setPreviewLoading(true); setPipelineError(null);
    try {
      const { data: docData } = await db2.from('documents').select('name, content_json, deal_id').eq('id', documentId).single();
      if (!docData) throw new Error('문서를 찾을 수 없습니다');
      const cj = docData.content_json as any;
      const { data: comp } = await db2.from('companies').select('name, business_number, representative, address, seal_url').eq('id', companyId).single();
      const companyInfo = { name: comp?.name || '', businessNumber: comp?.business_number || '', representative: comp?.representative || '', address: comp?.address || '' };
      let url: string;
      if (cj?.type === 'contract') {
        const html = generateContractPDF({ documentNumber: docData.name, date: new Date().toISOString().split('T')[0], partyA: { name: companyInfo.name, representative: companyInfo.representative, businessNumber: companyInfo.businessNumber, address: companyInfo.address }, partyB: { name: cj.partnerName || '' }, contractAmount: cj.supplyAmount || 0, taxAmount: cj.taxAmount || 0, totalAmount: cj.totalWithTax || 0, items: (cj.items || []).map((it: any) => ({ name: it.name || '', spec: it.spec || '', qty: it.quantity || 1, unitPrice: it.unitPrice || 0, amount: it.supplyAmount || 0 })), contractSubject: cj.dealName || docData.name, contractStartDate: cj.contractStartDate || '', contractEndDate: cj.contractEndDate || '', paymentTerms: cj.paymentTerms || '', deliveryDeadline: cj.deliveryDeadline || '', inspectionPeriod: cj.inspectionPeriod || '7일', warrantyPeriod: cj.warrantyPeriod || '1년', latePenaltyRate: cj.latePenaltyRate || '0.1%', sealUrlA: comp?.seal_url || undefined });
        const blob = new Blob([html], { type: 'text/html' });
        url = URL.createObjectURL(blob);
      } else {
        const blob = await generateQuotePDF({ documentNumber: docData.name, companyInfo, counterparty: cj.partnerName || '', items: cj.items || [{ name: cj.dealName || '', quantity: 1, unitPrice: cj.contractTotal || 0, supplyAmount: cj.supplyAmount || 0, taxAmount: cj.taxAmount || 0, totalAmount: cj.totalWithTax || 0, note: '' }], supplyAmount: cj.supplyAmount || 0, taxAmount: cj.taxAmount || 0, totalAmount: cj.totalWithTax || 0, validUntil: cj.validUntil, sealUrl: comp?.seal_url || undefined });
        url = URL.createObjectURL(blob);
      }
      setPreviewUrl(url);
    } catch (err: any) { setPipelineError(`미리보기 실패: ${err?.message || '알 수 없는 오류'}`); }
    setPreviewLoading(false);
  }

  // 이메일 발송 모달 열기 (거래처 검색/등록 포함)
  function openEmailModal(documentId: string) {
    setEmailModal({ documentId });
    setEmailTab('existing');
    setPartnerSearch('');
    setPartnerResults([]);
    setSelectedPartner(null);
    setNewPartner({ name: '', email: '', business_number: '', contact_phone: '' });
    // 기존 거래처 자동 로드
    loadDealPartner(documentId);
  }

  async function loadDealPartner(documentId: string) {
    const { data: dealData } = await db2.from('deals').select('*, partners!deals_partner_id_fkey(id, name, contact_email, business_number, contact_phone)').eq('id', dealId).single();
    if (dealData?.partners?.contact_email) {
      setSelectedPartner(dealData.partners);
      setEmailTab('existing');
    } else {
      setEmailTab('new');
    }
  }

  async function searchPartners(q: string) {
    setPartnerSearch(q);
    if (q.length < 1) { setPartnerResults([]); return; }
    const { data } = await db2.from('partners').select('id, name, contact_email, business_number, contact_phone').eq('company_id', companyId).ilike('name', `%${q}%`).limit(8);
    setPartnerResults(data || []);
  }

  async function registerNewPartner() {
    if (!companyId || !newPartner.name || !newPartner.email) return;
    setPartnerSaving(true);
    try {
      const { data: p, error } = await db2.from('partners').insert({ company_id: companyId, name: newPartner.name, contact_email: newPartner.email, business_number: newPartner.business_number || null, contact_phone: newPartner.contact_phone || null, type: 'client' }).select().single();
      if (error) throw error;
      // 딜에 거래처 연결
      await db2.from('deals').update({ partner_id: p.id, counterparty: p.name }).eq('id', dealId);
      setSelectedPartner(p);
      setEmailTab('existing');
      toast('거래처가 등록되었습니다', 'success');
      queryClient.invalidateQueries({ queryKey: ['partners'] });
    } catch (err: any) { setPipelineError(`거래처 등록 실패: ${err?.message}`); }
    setPartnerSaving(false);
  }

  async function selectExistingPartner(partner: any) {
    setSelectedPartner(partner);
    // 딜에 거래처 연결
    await db2.from('deals').update({ partner_id: partner.id, counterparty: partner.name }).eq('id', dealId);
    setPartnerSearch('');
    setPartnerResults([]);
    queryClient.invalidateQueries({ queryKey: ['deal-detail', dealId] });
  }

  async function handleSendEmailConfirm() {
    if (!companyId || !emailModal || emailSending || !selectedPartner?.contact_email) return;
    setEmailSending(true); setPipelineError(null);
    try {
      const { data: docData } = await db2.from('documents').select('name, content_json').eq('id', emailModal.documentId).single();
      const { data: comp } = await db2.from('companies').select('name').eq('id', companyId).single();
      const share = await createDocumentShare({ documentId: emailModal.documentId, companyId, createdBy: userId || '', expiresInDays: 30 });
      const shareUrl = share.shareUrl || `${window.location.origin}/share/${share.shareToken}`;
      const result = await sendShareEmail({ email: selectedPartner.contact_email, recipientName: selectedPartner.name, documentName: docData?.name || '문서', shareUrl, companyName: comp?.name || '' });
      if (result.fallbackMailto) { window.open(result.fallbackMailto, '_blank'); }
      else if (result.success) { toast('이메일 발송 완료', 'success'); }
      setEmailModal(null);
    } catch (err: any) { setPipelineError(`이메일 발송 실패: ${err?.message || '알 수 없는 오류'}`); }
    setEmailSending(false);
  }

  // Legacy direct send (fallback)
  async function handleSendEmail(documentId: string) {
    openEmailModal(documentId);
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-3"><h2 className="text-sm font-bold">프로세스 파이프라인</h2><span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">{progress}%</span></div>
        <div className="flex gap-2 items-center">
          <select value={contractTemplate} onChange={(e) => setContractTemplate(e.target.value)} className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]">
            {CONTRACT_TEMPLATES.map(t => (<option key={t.key} value={t.key}>{t.label}</option>))}
          </select>
          {!hasQuote && companyId && userId && (<button onClick={handleCreateQuote} disabled={creating} className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-[var(--primary-hover)] transition">{creating ? '생성 중...' : '+ 견적서 생성'}</button>)}
          {forceApproveTarget && companyId && userId && (<button onClick={handleForceApprove} disabled={forceApproving} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-amber-700 transition">{forceApproving ? '처리 중...' : `임의 승인 (${activeQuote ? '견적서' : '계약서'})`}</button>)}
          {(activeQuote?.documentId || activeContract?.documentId) && companyId && (<button onClick={() => handlePreview((activeQuote?.documentId || activeContract?.documentId)!)} disabled={previewLoading} className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-cyan-700 transition">{previewLoading ? '로딩...' : '미리보기'}</button>)}
          {(activeQuote?.documentId || activeContract?.documentId) && companyId && (<button onClick={() => handleApplySeal((activeQuote?.documentId || activeContract?.documentId)!)} disabled={sealApplying} className="px-3 py-1.5 bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-red-800 transition">{sealApplying ? '적용 중...' : '직인 적용'}</button>)}
          {(activeQuote?.documentId || activeContract?.documentId) && companyId && (<button onClick={() => handleSendEmail((activeQuote?.documentId || activeContract?.documentId)!)} disabled={emailSending} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-indigo-700 transition">{emailSending ? '발송 중...' : '📧 이메일 발송'}</button>)}
          {canConfirmRevenue && companyId && userId && (<button onClick={handleConfirmRevenue} disabled={confirming} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-green-700 transition">{confirming ? '처리 중...' : '입금 확인'}</button>)}
        </div>
      </div>
      {pipelineError && (<div className="mx-5 mt-3 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between"><span className="text-xs text-red-500">{pipelineError}</span><button onClick={() => setPipelineError(null)} className="text-red-400 hover:text-red-300 text-xs ml-2">닫기</button></div>)}
      <div className="px-5 pt-4"><div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden"><div className="h-full rounded-full bg-[var(--primary)] transition-all duration-500" style={{ width: `${progress}%` }} /></div></div>
      <div className="px-5 py-4 flex items-center gap-1">
        {PIPELINE_STAGES.map((ps, idx) => { const stage = stages.find(s => s.stage === ps.key); const status = stage?.status || 'pending'; const isCompleted = status === 'completed'; const isActive = status === 'active'; const docNum = (stage as any)?.document_number; return (<div key={ps.key} className="flex items-center flex-1"><div className={`flex-1 rounded-xl p-3 text-center transition ${isCompleted ? 'bg-green-500/8 border border-green-500/20' : isActive ? 'bg-blue-500/8 border border-blue-500/20' : 'bg-[var(--bg-surface)] border border-[var(--border)]'}`}><div className="text-lg mb-1">{ps.icon}</div><div className={`text-[10px] font-semibold ${isCompleted ? 'text-green-500' : isActive ? 'text-blue-500' : 'text-[var(--text-dim)]'}`}>{ps.label}</div>{docNum && (<div className="text-[8px] font-mono text-[var(--text-dim)] mt-0.5 truncate px-1" title={docNum}>{docNum}</div>)}<div className={`text-[9px] mt-0.5 ${isCompleted ? 'text-green-400' : isActive ? 'text-blue-400' : 'text-[var(--text-dim)]'}`}>{isCompleted ? '완료' : isActive ? '진행중' : '대기'}</div></div>{idx < PIPELINE_STAGES.length - 1 && (<div className={`w-4 h-0.5 mx-0.5 flex-shrink-0 rounded ${isCompleted ? 'bg-green-500/40' : 'bg-[var(--border)]'}`} />)}</div>); })}
      </div>
      <div className="px-5 pb-4"><div className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] rounded-lg p-2.5">자동 흐름: 견적서 승인 → 계약서 자동생성 → 계약서 승인 → 세금계산서 자동발행 + 입금 스케줄(선금{paymentRatio?.advance ?? 30}%/잔금{paymentRatio?.balance ?? 70}%) 자동생성</div></div>

      {/* 견적서/계약서 미리보기 모달 */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-3xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold">문서 미리보기</h3>
              <div className="flex items-center gap-2">
                <a href={previewUrl} download="document.pdf" className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:bg-[var(--primary-hover)] transition">다운로드</a>
                <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} className="px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text)] text-xs">닫기</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe src={previewUrl} className="w-full h-full border-0" title="문서 미리보기" />
            </div>
          </div>
        </div>
      )}

      {/* 이메일 발송 모달 — 거래처 검색/신규등록 포함 */}
      {emailModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEmailModal(null)}>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold">문서 이메일 발송</h3>
              <p className="text-[11px] text-[var(--text-dim)] mt-1">거래처를 선택하거나 새로 등록한 후 발송합니다</p>
            </div>
            <div className="p-5 space-y-4">
              {/* 탭 */}
              <div className="flex gap-2">
                <button onClick={() => setEmailTab('existing')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${emailTab === 'existing' ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]'}`}>기존 거래처 검색</button>
                <button onClick={() => setEmailTab('new')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${emailTab === 'new' ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]'}`}>신규 거래처 등록</button>
              </div>

              {emailTab === 'existing' && (
                <div className="space-y-3">
                  <div className="relative">
                    <input value={partnerSearch} onChange={(e) => searchPartners(e.target.value)} placeholder="거래처명으로 검색..." className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
                    {partnerResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                        {partnerResults.map((p: any) => (
                          <button key={p.id} onClick={() => selectExistingPartner(p)} className="w-full px-3 py-2.5 text-left hover:bg-[var(--bg-surface)] transition border-b border-[var(--border)]/50 last:border-0">
                            <div className="text-xs font-semibold">{p.name}</div>
                            <div className="text-[10px] text-[var(--text-dim)]">{p.contact_email || '이메일 미등록'} {p.business_number ? `| ${p.business_number}` : ''}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {emailTab === 'new' && (
                <div className="space-y-3">
                  <div><label className="block text-[10px] text-[var(--text-dim)] font-semibold mb-1">거래처명 *</label><input value={newPartner.name} onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} placeholder="(주)ABC컴퍼니" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /></div>
                  <div><label className="block text-[10px] text-[var(--text-dim)] font-semibold mb-1">이메일 *</label><input type="email" value={newPartner.email} onChange={(e) => setNewPartner({ ...newPartner, email: e.target.value })} placeholder="partner@company.com" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] text-[var(--text-dim)] font-semibold mb-1">사업자번호</label><input value={newPartner.business_number} onChange={(e) => setNewPartner({ ...newPartner, business_number: e.target.value })} placeholder="000-00-00000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /></div>
                    <div><label className="block text-[10px] text-[var(--text-dim)] font-semibold mb-1">연락처</label><input value={newPartner.contact_phone} onChange={(e) => setNewPartner({ ...newPartner, contact_phone: e.target.value })} placeholder="010-0000-0000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /></div>
                  </div>
                  <button onClick={registerNewPartner} disabled={!newPartner.name || !newPartner.email || partnerSaving} className="w-full py-2.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-50">{partnerSaving ? '등록 중...' : '거래처 등록 + CRM 저장'}</button>
                </div>
              )}

              {/* 선택된 거래처 표시 */}
              {selectedPartner && (
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-blue-400">{selectedPartner.name}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">{selectedPartner.contact_email}{selectedPartner.business_number ? ` | ${selectedPartner.business_number}` : ''}</div>
                    </div>
                    <span className="text-[10px] text-green-400 font-semibold">발송 준비 완료</span>
                  </div>
                </div>
              )}

              {pipelineError && (<div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">{pipelineError}</div>)}
            </div>
            <div className="px-5 py-4 border-t border-[var(--border)] flex gap-2">
              <button onClick={handleSendEmailConfirm} disabled={!selectedPartner?.contact_email || emailSending} className="flex-1 py-2.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-50">{emailSending ? '발송 중...' : '이메일 발송'}</button>
              <button onClick={() => setEmailModal(null)} className="px-4 py-2.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Kanban Status Config ──

type KanbanStatus = 'active' | 'pending' | 'closed_won' | 'closed_lost' | 'dormant';
interface KanbanColumn { key: KanbanStatus; label: string; color: string; bgLight: string; borderColor: string; headerBg: string; }

const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'active', label: '진행중', color: '#2563EB', bgLight: 'rgba(37,99,235,0.06)', borderColor: 'rgba(37,99,235,0.2)', headerBg: 'rgba(37,99,235,0.08)' },
  { key: 'pending', label: '검토중', color: '#EAB308', bgLight: 'rgba(234,179,8,0.06)', borderColor: 'rgba(234,179,8,0.2)', headerBg: 'rgba(234,179,8,0.08)' },
  { key: 'closed_won', label: '완료', color: '#22C55E', bgLight: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.2)', headerBg: 'rgba(34,197,94,0.08)' },
  { key: 'closed_lost', label: '실패', color: '#EF4444', bgLight: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)', headerBg: 'rgba(239,68,68,0.08)' },
  { key: 'dormant', label: '휴면', color: '#6B7280', bgLight: 'rgba(107,114,128,0.06)', borderColor: 'rgba(107,114,128,0.2)', headerBg: 'rgba(107,114,128,0.08)' },
];

function mapDealToKanbanStatus(deal: any): KanbanStatus { if (deal.is_dormant) return 'dormant'; switch (deal.status) { case 'active': return 'active'; case 'pending': return 'pending'; case 'completed': return 'closed_won'; case 'archived': return 'closed_lost'; default: return 'pending'; } }

// ── Kanban Card (E-1 drag + E-2 assignees/amount + E-6 badges) ──

function KanbanCard({ deal, clsColorMap, onClick, assignees, onDragStart }: { deal: any; clsColorMap: Record<string, string>; onClick: () => void; assignees?: { name: string; email: string }[]; onDragStart: (e: React.DragEvent, dealId: string, currentStatus: KanbanStatus) => void }) {
  const total = Number(deal.contract_total || 0);
  const dateStr = deal.start_date ? `${deal.start_date}${deal.end_date ? ` ~ ${deal.end_date}` : ''}` : deal.created_at ? new Date(deal.created_at).toLocaleDateString('ko') : '';
  const kanbanStatus = mapDealToKanbanStatus(deal);
  return (
    <button onClick={onClick} draggable onDragStart={(e) => onDragStart(e, deal.id, kanbanStatus)} className="w-full text-left bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)]/40 hover:shadow-md transition-all group cursor-grab active:cursor-grabbing" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <ClassificationBadge classification={deal.classification || 'B2B'} color={clsColorMap[deal.classification || 'B2B']} />
        {deal.deal_number && (<span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] font-mono">{deal.deal_number}</span>)}
        <PriorityBadge priority={deal.priority} />
        <RiskBadge risk={deal.risk_level} />
      </div>
      <div className="text-sm font-bold leading-tight group-hover:text-[var(--primary)] transition mb-2 line-clamp-2">{deal.name}</div>
      <div className="flex items-center justify-between">
        {total > 0 ? (<span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">₩{total.toLocaleString()}</span>) : (<span className="text-xs text-[var(--text-dim)]">—</span>)}
        {assignees && assignees.length > 0 && (<div className="flex -space-x-1.5">{assignees.slice(0, 3).map((a, i) => (<div key={i} title={a.name || a.email} className="w-6 h-6 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[9px] font-bold border-2 border-[var(--bg-card)]">{(a.name || a.email || '?')[0].toUpperCase()}</div>))}{assignees.length > 3 && (<div className="w-6 h-6 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)] flex items-center justify-center text-[8px] font-bold border-2 border-[var(--bg-card)]">+{assignees.length - 3}</div>)}</div>)}
      </div>
      {dateStr && (<div className="text-[10px] text-[var(--text-dim)] mt-1.5">{dateStr}</div>)}
    </button>
  );
}

// ── Kanban Board (E-1 drag-and-drop) ──

function kanbanStatusToDbStatus(ks: KanbanStatus): { status: string; is_dormant?: boolean } { switch (ks) { case 'active': return { status: 'active', is_dormant: false }; case 'pending': return { status: 'pending', is_dormant: false }; case 'closed_won': return { status: 'completed', is_dormant: false }; case 'closed_lost': return { status: 'archived', is_dormant: false }; case 'dormant': return { status: 'active', is_dormant: true }; default: return { status: 'active' }; } }

function KanbanBoard({ deals, clsColorMap, onSelectDeal, assignmentMap }: { deals: any[]; clsColorMap: Record<string, string>; onSelectDeal: (id: string) => void; assignmentMap: Record<string, { name: string; email: string }[]> }) {
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const nonArchivedDeals = deals.filter((d: any) => d.status !== "archived");
  const grouped = KANBAN_COLUMNS.map((col) => ({ ...col, deals: nonArchivedDeals.filter((d) => mapDealToKanbanStatus(d) === col.key) }));

  function handleDragStart(e: React.DragEvent, dealId: string, currentStatus: KanbanStatus) { e.dataTransfer.setData('text/plain', JSON.stringify({ dealId, fromStatus: currentStatus })); e.dataTransfer.effectAllowed = 'move'; setDraggingId(dealId); }
  function handleDragOver(e: React.DragEvent, colKey: KanbanStatus) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(colKey); }
  function handleDragLeave() { setDragOverCol(null); }
  async function handleDrop(e: React.DragEvent, targetStatus: KanbanStatus) { e.preventDefault(); setDragOverCol(null); setDraggingId(null); try { const raw = e.dataTransfer.getData('text/plain'); const { dealId, fromStatus } = JSON.parse(raw) as { dealId: string; fromStatus: KanbanStatus }; if (fromStatus === targetStatus) return; const dbUpdate = kanbanStatusToDbStatus(targetStatus); const db2 = supabase as any; const { error } = await db2.from('deals').update(dbUpdate).eq('id', dealId); if (error) { console.error('칸반 상태 변경 실패:', error.message); return; } queryClient.invalidateQueries({ queryKey: ['deals'] }); } catch (err) { console.error('칸반 드래그 오류:', err); } }
  function handleDragEnd() { setDraggingId(null); setDragOverCol(null); }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
      {grouped.map((col) => { const isDropTarget = dragOverCol === col.key; return (
        <div key={col.key} className="flex-shrink-0 rounded-2xl border overflow-hidden flex flex-col transition-all" style={{ width: '280px', backgroundColor: col.bgLight, borderColor: isDropTarget ? col.color : col.borderColor, borderWidth: isDropTarget ? '2px' : '1px', boxShadow: isDropTarget ? `0 0 12px ${col.color}30` : undefined }} onDragOver={(e) => handleDragOver(e, col.key)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, col.key)}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: col.headerBg }}>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} /><span className="text-sm font-bold" style={{ color: col.color }}>{col.label}</span></div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${col.color}15`, color: col.color }}>{col.deals.length}</span>
          </div>
          <div className="flex-1 p-3 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            {col.deals.length === 0 ? (<div className={`text-center py-8 text-xs ${isDropTarget ? 'text-[var(--text-muted)]' : 'text-[var(--text-dim)]'}`}>{isDropTarget ? '여기에 드롭하세요' : '딜 없음'}</div>) : (col.deals.map((deal) => (<div key={deal.id} onDragEnd={handleDragEnd} style={{ opacity: draggingId === deal.id ? 0.5 : 1, transition: 'opacity 150ms' }}><KanbanCard deal={deal} clsColorMap={clsColorMap} onClick={() => onSelectDeal(deal.id)} assignees={assignmentMap[deal.id]} onDragStart={handleDragStart} /></div>)))}
          </div>
        </div>); })}
    </div>
  );
}

// ── Gantt Chart View ──
function GanttView({ deals, clsColorMap }: { deals: any[]; clsColorMap: Record<string, string> }) {
  const today = new Date();
  const allDates = deals.flatMap((d: any) => [d.start_date, d.end_date].filter(Boolean).map((s: string) => new Date(s).getTime()));
  if (allDates.length === 0) return <div className="text-center py-16 text-[var(--text-muted)]">날짜가 있는 딜이 없습니다</div>;
  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates, today.getTime() + 30 * 86400000));
  minDate.setDate(1);
  maxDate.setMonth(maxDate.getMonth() + 1, 0);
  const totalDays = Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000));
  const months: { label: string; startPct: number; widthPct: number }[] = [];
  const cursor = new Date(minDate);
  while (cursor <= maxDate) {
    const mStart = new Date(cursor);
    const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const startPct = ((mStart.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100;
    const widthPct = ((Math.min(mEnd.getTime(), maxDate.getTime()) - mStart.getTime()) / 86400000 / totalDays) * 100;
    months.push({ label: `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, '0')}`, startPct, widthPct });
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  const todayPct = ((today.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100;

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          {/* Month Header */}
          <div className="relative h-8 border-b border-[var(--border)] bg-[var(--bg-surface)]">
            {months.map((m, i) => (
              <div key={i} className="absolute top-0 h-full flex items-center justify-center text-[10px] font-semibold text-[var(--text-muted)] border-r border-[var(--border)]/30" style={{ left: `${200 + (m.startPct / 100) * 700}px`, width: `${(m.widthPct / 100) * 700}px` }}>
                {m.label}
              </div>
            ))}
            <div className="absolute top-0 left-0 h-full w-[200px] flex items-center px-4 text-[10px] font-bold text-[var(--text-muted)] border-r border-[var(--border)]">프로젝트</div>
          </div>

          {/* Rows */}
          {deals.filter((d: any) => d.start_date).map((d: any, idx: number) => {
            const start = new Date(d.start_date);
            const end = d.end_date ? new Date(d.end_date) : new Date(start.getTime() + 90 * 86400000);
            const leftPct = ((start.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100;
            const widthPct = Math.max(1, ((end.getTime() - start.getTime()) / 86400000 / totalDays) * 100);
            const barColor = clsColorMap[d.classification || 'B2B'] || '#3b82f6';
            const isCompleted = d.status === 'completed' || d.status === 'closed_won';

            return (
              <div key={d.id} className={`relative h-10 flex items-center ${idx % 2 === 0 ? 'bg-[var(--bg)]' : 'bg-[var(--bg-card)]'} border-b border-[var(--border)]/20 hover:bg-[var(--primary)]/5 transition`}>
                {/* Deal Name */}
                <div className="w-[200px] shrink-0 px-4 flex items-center gap-2 border-r border-[var(--border)]/30">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: barColor }} />
                  <span className="text-xs font-semibold text-[var(--text)] truncate">{d.name}</span>
                </div>
                {/* Bar Area */}
                <div className="flex-1 relative h-full" style={{ width: '700px' }}>
                  <div
                    className="absolute top-2 h-6 rounded-md flex items-center px-2 text-[9px] font-bold text-white transition-all hover:brightness-110"
                    style={{
                      left: `${(leftPct / 100) * 700}px`,
                      width: `${Math.max(30, (widthPct / 100) * 700)}px`,
                      backgroundColor: barColor,
                      opacity: isCompleted ? 0.5 : 0.85,
                    }}
                  >
                    <span className="truncate">{d.contract_total ? `₩${(Number(d.contract_total) / 10000).toFixed(0)}만` : ''}</span>
                  </div>
                  {/* Today Marker */}
                  {todayPct >= 0 && todayPct <= 100 && (
                    <div className="absolute top-0 h-full w-px bg-red-500/60" style={{ left: `${(todayPct / 100) * 700}px` }} />
                  )}
                </div>
              </div>
            );
          })}

          {/* Today Label */}
          {todayPct >= 0 && todayPct <= 100 && (
            <div className="relative h-5 bg-[var(--bg-surface)]">
              <div className="absolute text-[9px] font-bold text-red-400" style={{ left: `${200 + (todayPct / 100) * 700 - 10}px` }}>오늘</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── View Toggle (E-3: calendar + gantt added) ──
type ViewMode = 'table' | 'kanban' | 'calendar' | 'gantt';
function ViewToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
      <button onClick={() => onChange('table')} className={`px-4 py-2 text-xs font-semibold transition-all ${viewMode === 'table' ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'}`}><span className="flex items-center gap-1.5"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>테이블</span></button>
      <button onClick={() => onChange('kanban')} className={`px-4 py-2 text-xs font-semibold transition-all ${viewMode === 'kanban' ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'}`}><span className="flex items-center gap-1.5"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="3" width="6" height="12" rx="1"/><rect x="16" y="3" width="6" height="15" rx="1"/></svg>칸반</span></button>
      <button onClick={() => onChange('calendar')} className={`px-4 py-2 text-xs font-semibold transition-all ${viewMode === 'calendar' ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'}`}><span className="flex items-center gap-1.5"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>캘린더</span></button>
      <button onClick={() => onChange('gantt')} className={`px-4 py-2 text-xs font-semibold transition-all ${viewMode === 'gantt' ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'}`}><span className="flex items-center gap-1.5"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="14" y2="16"/></svg>간트</span></button>
    </div>
  );
}

// ── Calendar View (E-3) ──
function CalendarView({ deals, clsColorMap, onSelectDeal }: {
  deals: any[];
  clsColorMap: Record<string, string>;
  onSelectDeal: (id: string) => void;
}) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  // Monday-first: JS getDay() returns 0=Sun, convert to 0=Mon
  const toMonStart = (d: number) => (d + 6) % 7;
  const firstDayOffset = toMonStart(new Date(year, month, 1).getDay());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isToday = (d: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  // Map deals to day numbers
  const dayMap: Record<number, any[]> = {};
  deals.forEach((deal: any) => {
    const dateStr = deal.start_date || deal.created_at;
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(deal);
    }
  });

  // Build grid cells (6 rows x 7 cols)
  const MAX_CELLS = 42;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < MAX_CELLS) cells.push(null);

  const DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
  const MAX_VISIBLE_DEALS = 3;

  const formatAmount = (amt: number | string | null | undefined): string => {
    const n = Number(amt);
    if (!n) return '';
    return n >= 10000
      ? `${(n / 10000).toFixed(0)}만원`
      : `${n.toLocaleString()}원`;
  };

  const getDealTooltip = (deal: any): string => {
    const amount = formatAmount(deal.contract_total);
    return amount ? `${deal.name} (${amount})` : deal.name;
  };

  const goPrev = () => setCurrentDate(new Date(year, month - 1, 1));
  const goNext = () => setCurrentDate(new Date(year, month + 1, 1));

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <button
          onClick={goPrev}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h2 className="text-sm font-bold">{year}년 {month + 1}월</h2>
        <button
          onClick={goNext}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Day-of-week headers (Mon-Sun) */}
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DOW_LABELS.map((label, i) => (
          <div
            key={label}
            className={`text-center py-2 text-[10px] font-semibold ${
              i === 5 ? 'text-blue-400' : i === 6 ? 'text-red-400' : 'text-[var(--text-dim)]'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          const dealsOnDay = day ? (dayMap[day] || []) : [];
          const col = idx % 7;
          const isSat = col === 5;
          const isSun = col === 6;

          return (
            <div
              key={idx}
              className={`min-h-[100px] border-b border-r border-[var(--border)]/50 p-1.5 ${
                day === null ? 'bg-[var(--bg-surface)]/30' : ''
              } ${col === 6 ? 'border-r-0' : ''}`}
            >
              {day !== null && (
                <>
                  <div
                    className={`text-[11px] font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday(day)
                        ? 'bg-[var(--primary)] text-white'
                        : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dealsOnDay.slice(0, MAX_VISIBLE_DEALS).map((deal: any) => {
                      const pillColor = clsColorMap[deal.classification || 'B2B'] || '#3b82f6';
                      return (
                        <button
                          key={deal.id}
                          onClick={() => onSelectDeal(deal.id)}
                          className="w-full text-left text-[9px] px-1.5 py-0.5 rounded truncate hover:opacity-80 transition font-medium block"
                          style={{
                            backgroundColor: `${pillColor}18`,
                            color: pillColor,
                          }}
                          title={getDealTooltip(deal)}
                        >
                          {deal.name}
                        </button>
                      );
                    })}
                    {dealsOnDay.length > MAX_VISIBLE_DEALS && (
                      <div className="text-[8px] text-[var(--text-dim)] text-center">
                        +{dealsOnDay.length - MAX_VISIBLE_DEALS}건
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Deals List ──
function DealsPageInner() {
  const searchParams = useSearchParams(); const router = useRouter(); const selectedId = searchParams.get("id");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ classification: "B2B", name: "", contract_total: "", start_date: "", end_date: "", counterparty: "", priority: "medium" });
  const [formError, setFormError] = useState("");
  const [filterCls, setFilterCls] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);
  const [showDormant, setShowDormant] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [dealPartnerResults, setDealPartnerResults] = useState<any[]>([]);
  const [dealPartnerFocused, setDealPartnerFocused] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => { getCurrentUser().then((u) => u && setCompanyId(u.company_id)); }, []);

  async function searchDealPartners(q: string) {
    setForm((prev: any) => ({ ...prev, counterparty: q }));
    if (!companyId || q.length < 1) { setDealPartnerResults([]); return; }
    const db2 = supabase as any;
    const { data } = await db2.from('partners').select('id, name, contact_email, business_number').eq('company_id', companyId).ilike('name', `%${q}%`).limit(6);
    setDealPartnerResults(data || []);
  }

  const { data: deals = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({ queryKey: ["deals", companyId], queryFn: () => getDeals(companyId!), enabled: !!companyId });
  const { data: classifications = [] } = useQuery({ queryKey: ["deal-classifications", companyId], queryFn: () => getDealClassifications(companyId!), enabled: !!companyId });
  const { data: matchingStatuses = [] } = useQuery({ queryKey: ['deal-matching', companyId], queryFn: () => getDealMatchingStatuses(companyId!), enabled: !!companyId });
  const { data: dormantDeals = [] } = useQuery({ queryKey: ['dormant-deals', companyId], queryFn: () => getDormantDeals(companyId!), enabled: !!companyId && showDormant });

  // E-2: Fetch all assignments for kanban card avatars
  const { data: allAssignments = [] } = useQuery({
    queryKey: ['all-deal-assignments', companyId],
    queryFn: async () => { const db2 = supabase as any; const { data } = await db2.from('deal_assignments').select('deal_id, users(name, email)').eq('is_active', true); return data || []; },
    enabled: !!companyId,
  });
  const assignmentMap: Record<string, { name: string; email: string }[]> = {};
  allAssignments.forEach((a: any) => { if (!a.deal_id || !a.users) return; if (!assignmentMap[a.deal_id]) assignmentMap[a.deal_id] = []; assignmentMap[a.deal_id].push({ name: a.users.name || '', email: a.users.email || '' }); });

  const reactivateMut = useMutation({ mutationFn: (dealId: string) => reactivateDeal(dealId), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['deals'] }); queryClient.invalidateQueries({ queryKey: ['dormant-deals'] }); } });
  const matchMap = Object.fromEntries(matchingStatuses.map((m: any) => [m.dealId, m]));
  const clsColorMap = Object.fromEntries(classifications.map((c: any) => [c.name, c.color || DEFAULT_COLORS[c.name] || '#8b5cf6']));

  const createDeal = useMutation({
    mutationFn: async () => { if (!companyId) throw new Error("회사 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요."); const contractAmount = Number(form.contract_total); if (!contractAmount || contractAmount <= 0) throw new Error("계약금액은 1원 이상이어야 합니다"); if (!form.name.trim()) throw new Error("딜명을 입력해주세요."); const { data: newDeal, error } = await supabase.from("deals").insert({ company_id: companyId, name: form.name.trim(), classification: form.classification, contract_total: contractAmount, status: "active", start_date: form.start_date || null, end_date: form.end_date || null, priority: form.priority }).select().single(); if (error) throw error; if (form.counterparty.trim() && newDeal) { try { await autoCreatePartnerFromDeal(companyId, newDeal.id, form.counterparty.trim()); } catch (e) { console.error("거래처 자동 등록 실패:", e); } } },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["deals"] }); queryClient.invalidateQueries({ queryKey: ["partners"] }); setShowForm(false); setForm({ classification: "B2B", name: "", contract_total: "", start_date: "", end_date: "", counterparty: "", priority: "medium" }); setFormError(""); },
    onError: (err: Error) => { setFormError(err.message); },
  });

  // E-6: Filter by classification and priority
  let filteredDeals = filterCls ? deals.filter((d: any) => d.classification === filterCls) : deals;
  if (filterPriority) filteredDeals = filteredDeals.filter((d: any) => d.priority === filterPriority);
  const activeCls = Array.from(new Set(deals.map((d: any) => d.classification || 'B2B')));

  if (selectedId) return <DealDetailView dealId={selectedId} onBack={() => router.push("/deals")} />;

  return (
    <div className={viewMode === 'kanban' || viewMode === 'calendar' || viewMode === 'gantt' ? 'max-w-full' : 'max-w-[1000px]'}>
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="flex items-center justify-between mb-8">
        <div><h1 className="text-2xl font-extrabold">딜 관리</h1><p className="text-sm text-[var(--text-muted)] mt-1">모든 프로젝트/계약을 딜 단위로 관리합니다</p></div>
        <div className="flex items-center gap-3">
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">+ 새 딜</button>
        </div>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">새 딜 등록</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">분류 *</label><select value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">{classifications.length > 0 ? classifications.map((c: any) => (<option key={c.id} value={c.name}>{c.name}</option>)) : ['B2B', 'B2C', 'B2G'].map(v => (<option key={v} value={v}>{v}</option>))}</select></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">딜명 *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 수출바우처 - A기업" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">계약금액 (원) *</label><input type="number" min="1" value={form.contract_total} onChange={(e) => { setForm({ ...form, contract_total: e.target.value }); setFormError(""); }} placeholder="15000000" className={`w-full px-3 py-2.5 bg-[var(--bg)] border rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] ${formError && (!form.contract_total || Number(form.contract_total) <= 0) ? "border-red-400" : "border-[var(--border)]"}`} />{formError && (!form.contract_total || Number(form.contract_total) <= 0) && (<p className="text-xs text-red-500 mt-1">{formError}</p>)}</div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">시작일</label><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">우선순위</label><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"><option value="low">낮음</option><option value="medium">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></div>
            <div className="relative"><label className="block text-xs text-[var(--text-muted)] mb-1">거래처명</label><input value={form.counterparty} onChange={(e) => { setForm({ ...form, counterparty: e.target.value }); searchDealPartners(e.target.value); }} onFocus={() => setDealPartnerFocused(true)} onBlur={() => setTimeout(() => setDealPartnerFocused(false), 200)} placeholder="예: (주)ABC컴퍼니 (기존 거래처 검색)" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />{dealPartnerFocused && dealPartnerResults.length > 0 && (<div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-lg max-h-40 overflow-y-auto">{dealPartnerResults.map((p: any) => (<button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, counterparty: p.name }); setDealPartnerResults([]); setDealPartnerFocused(false); }} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-sm transition"><span className="font-medium">{p.name}</span>{p.business_number && <span className="text-xs text-[var(--text-muted)] ml-2">{p.business_number}</span>}</button>))}</div>)}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => form.name && Number(form.contract_total) > 0 && createDeal.mutate()} disabled={!form.name || !form.contract_total || Number(form.contract_total) <= 0 || createDeal.isPending} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">{createDeal.isPending ? "생성 중..." : "딜 생성"}</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Classification + Priority Filter (E-6) */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {activeCls.length > 1 && (<>
          <button onClick={() => setFilterCls(null)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${!filterCls ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]'}`}>전체 ({deals.length})</button>
          {activeCls.map(cls => { const count = deals.filter((d: any) => (d.classification || 'B2B') === cls).length; return (<button key={cls} onClick={() => setFilterCls(filterCls === cls ? null : cls)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${filterCls === cls ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]'}`}>{cls} ({count})</button>); })}
        </>)}
        <span className="text-[var(--border)] mx-1">|</span>
        <button onClick={() => setFilterPriority(null)} className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${!filterPriority ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>우선순위 전체</button>
        {(['high', 'medium', 'low'] as DealPriority[]).map(p => { const cfg = PRIORITY_CONFIG[p]; return (<button key={p} onClick={() => setFilterPriority(filterPriority === p ? null : p)} className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${filterPriority === p ? '' : 'bg-[var(--bg-surface)]'}`} style={filterPriority === p ? { backgroundColor: cfg.bg, color: cfg.color } : { color: 'var(--text-muted)' }}>{cfg.label}</button>); })}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={showDormant} onChange={(e) => setShowDormant(e.target.checked)} className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] focus:ring-[var(--primary)] accent-[var(--primary)]" /><span className="text-xs text-[var(--text-muted)]">휴면 딜 표시</span></label>
        {showDormant && dormantDeals.length > 0 && (<span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">{dormantDeals.length}건 휴면</span>)}
      </div>

      {showDormant && dormantDeals.length > 0 && (<div className="mb-6"><h3 className="text-xs font-bold text-orange-400 mb-2">휴면 딜 (30일 이상 활동 없음)</h3><div className="space-y-2">{dormantDeals.map((d: any) => (<div key={d.id} className="bg-[var(--bg-card)] rounded-xl border border-orange-500/20 p-4 opacity-70"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">휴면</span><div><div className="text-sm font-semibold">{d.name}</div><div className="text-xs text-[var(--text-dim)] mt-0.5">마지막 활동: {d.last_activity_at ? new Date(d.last_activity_at).toLocaleDateString('ko') : '--'}</div></div></div><div className="flex items-center gap-2"><span className="text-sm font-bold text-[var(--text-muted)]">{Number(d.contract_total || 0).toLocaleString()}원</span><button onClick={(e) => { e.stopPropagation(); reactivateMut.mutate(d.id); }} disabled={reactivateMut.isPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition disabled:opacity-50">활성화</button></div></div></div>))}</div></div>)}

      {isLoading ? (
        <div className="text-center py-20 text-[var(--text-muted)] text-sm">로딩 중...</div>
      ) : deals.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center"><div className="text-4xl mb-4">💼</div><div className="text-lg font-bold mb-2">첫 딜을 등록하세요</div><div className="text-sm text-[var(--text-muted)] mb-6">딜 = 프로젝트 = 계약. 모든 돈은 딜에 연결됩니다.</div><button onClick={() => setShowForm(true)} className="px-6 py-3 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">+ 새 딜 등록</button></div>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard deals={filteredDeals} clsColorMap={clsColorMap} onSelectDeal={(id) => router.push(`/deals?id=${id}`)} assignmentMap={assignmentMap} />
      ) : viewMode === 'calendar' ? (
        <CalendarView deals={filteredDeals} clsColorMap={clsColorMap} onSelectDeal={(id) => router.push(`/deals?id=${id}`)} />
      ) : viewMode === 'gantt' ? (
        <GanttView deals={filteredDeals} clsColorMap={clsColorMap} />
      ) : (
        <div className="space-y-3">
          {filteredDeals.map((d: any) => (
            <button key={d.id} onClick={() => router.push(`/deals?id=${d.id}`)} className={`w-full text-left block bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 hover:border-[var(--primary)]/40 transition group ${d.is_dormant ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {d.is_dormant && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-semibold">휴면</span>)}
                    <ClassificationBadge classification={d.classification || 'B2B'} color={clsColorMap[d.classification || 'B2B']} />
                    {d.deal_number && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] font-mono">{d.deal_number}</span>)}
                    <PriorityBadge priority={d.priority} />
                    <RiskBadge risk={d.risk_level} />
                    <span className="text-sm font-bold group-hover:text-[var(--primary)] transition">{d.name}</span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)] mt-1">{d.start_date && `${d.start_date} ~ ${d.end_date || "진행중"}`}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">₩{Number(d.contract_total || 0).toLocaleString()}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${d.status === 'active' ? 'bg-green-500/10 text-green-400' : d.status === 'completed' ? 'bg-blue-500/10 text-blue-400' : 'bg-gray-500/10 text-gray-400'}`}>{DEAL_STATUS_LABEL[d.status || ''] || d.status || '대기'}</span>
                </div>
              </div>
              {matchMap[d.id] && matchMap[d.id].contractTotal > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]/50">
                  <div className="flex items-center gap-4 text-[10px]"><span className="text-[var(--text-dim)]">계약 ₩{Number(matchMap[d.id].contractTotal).toLocaleString()}</span><span className="text-[var(--text-dim)]">세금계산서 ₩{Number(matchMap[d.id].taxInvoicedAmount).toLocaleString()}</span><span className="text-[var(--text-dim)]">수금 ₩{Number(matchMap[d.id].paidAmount).toLocaleString()}</span><span className={`ml-auto font-semibold mono-number ${matchMap[d.id].matchRate >= 100 ? 'text-[var(--success)]' : matchMap[d.id].matchRate >= 50 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>{matchMap[d.id].matchRate}%</span></div>
                  <div className="mt-1 h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden"><div className={`h-full rounded-full transition-all ${matchMap[d.id].matchRate >= 100 ? 'bg-[var(--success)]' : matchMap[d.id].matchRate >= 50 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'}`} style={{ width: `${Math.min(100, matchMap[d.id].matchRate)}%` }} /></div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DealsPage() {
  return (<Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}><DealsPageInner /></Suspense>);
}

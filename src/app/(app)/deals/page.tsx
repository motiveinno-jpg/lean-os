"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getDeals, getDealClassifications, getDealMatchingStatuses, getDealWithNodes, buildTree, type TreeNode, getMilestones, getSubDeals, getAssignments, upsertMilestone, completeMilestone, getChannelByDeal, getMessages, getDormantDeals, reactivateDeal } from "@/lib/queries";
import { sendMessage, createChannel } from "@/lib/chat";
import { ClassificationBadge } from "@/components/classification-badge";
import { getDealPipelineStatus, createDocumentFromDeal, type PipelineStage } from "@/lib/deal-pipeline";
import type { DealMilestone } from "@/types/models";
import Link from "next/link";

const DEFAULT_COLORS: Record<string, string> = { B2B: '#3b82f6', B2C: '#22c55e', B2G: '#f59e0b' };

// ── Deal Detail (previously deals/[id]/client.tsx) ──

function NodeRow({ node, depth, dealId, onRefresh }: {
  node: TreeNode; depth: number; dealId: string; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");

  const revAmt = Number(node.revenue_amount) || 0;
  const actCost = Number(node.actual_cost) || 0;
  const margin = revAmt > 0 ? ((revAmt - actCost) / revAmt * 100) : 0;
  const marginColor = margin < 20 ? "text-red-400" : margin < 35 ? "text-yellow-400" : "text-green-400";

  async function addChild() {
    if (!newName.trim()) return;
    await supabase.from("deal_nodes").insert({
      deal_id: dealId,
      parent_id: node.id,
      name: newName.trim(),
      status: "pending",
    });
    setNewName("");
    setShowAdd(false);
    onRefresh();
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 hover:bg-[var(--bg-surface)] rounded-lg transition group"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-5 h-5 flex items-center justify-center text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          {node.children.length > 0 ? (expanded ? "▼" : "▶") : "·"}
        </button>
        <span className="text-sm font-medium flex-1">{node.name}</span>
        <span className="text-xs text-green-400 w-24 text-right">
          {revAmt > 0 ? `₩${revAmt.toLocaleString()}` : "—"}
        </span>
        <span className="text-xs text-[var(--text-muted)] w-24 text-right">
          {Number(node.expected_cost) > 0 ? `₩${Number(node.expected_cost).toLocaleString()}` : "—"}
        </span>
        <span className="text-xs text-red-400 w-24 text-right">
          {actCost > 0 ? `₩${actCost.toLocaleString()}` : "—"}
        </span>
        <span className={`text-xs font-bold w-16 text-right ${marginColor}`}>
          {revAmt > 0 ? `${margin.toFixed(1)}%` : "—"}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full w-14 text-center ${
          node.status === "done" ? "bg-green-500/10 text-green-400" :
          node.status === "active" ? "bg-blue-500/10 text-blue-400" :
          "bg-gray-500/10 text-gray-400"
        }`}>
          {node.status === "done" ? "완료" : node.status === "active" ? "진행" : "대기"}
        </span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="opacity-0 group-hover:opacity-100 text-xs text-[var(--primary)] hover:text-[var(--text)] transition px-1"
        >
          +
        </button>
      </div>

      {showAdd && (
        <div className="flex items-center gap-2 py-2" style={{ paddingLeft: `${(depth + 1) * 24 + 32}px` }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChild()}
            placeholder="하위 항목명"
            className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] w-48"
            autoFocus
          />
          <button onClick={addChild} className="text-xs text-[var(--primary)] font-semibold">추가</button>
          <button onClick={() => setShowAdd(false)} className="text-xs text-[var(--text-dim)]">취소</button>
        </div>
      )}

      {expanded && node.children.map((child: TreeNode) => (
        <NodeRow key={child.id} node={child} depth={depth + 1} dealId={dealId} onRefresh={onRefresh} />
      ))}
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

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setUserId(u.id); setCompanyId(u.company_id); }
    });
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["deal-detail", dealId],
    queryFn: () => getDealWithNodes(dealId),
    enabled: !!dealId,
  });

  const { data: milestones = [], refetch: refetchMs } = useQuery({
    queryKey: ["milestones", dealId],
    queryFn: () => getMilestones(dealId),
    enabled: !!dealId,
  });

  const { data: subDeals = [] } = useQuery({
    queryKey: ["sub-deals", dealId],
    queryFn: () => getSubDeals(dealId),
    enabled: !!dealId,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["assignments", dealId],
    queryFn: () => getAssignments(dealId),
    enabled: !!dealId,
  });

  const addMilestoneMut = useMutation({
    mutationFn: () => upsertMilestone({ deal_id: dealId, name: msForm.name, due_date: msForm.due_date }),
    onSuccess: () => { refetchMs(); setShowMilestoneForm(false); setMsForm({ name: "", due_date: "" }); },
  });

  const completeMsMut = useMutation({
    mutationFn: (id: string) => completeMilestone(id, userId || undefined),
    onSuccess: () => refetchMs(),
  });

  const { data: dealChannel } = useQuery({
    queryKey: ["deal-channel", dealId],
    queryFn: () => getChannelByDeal(dealId),
    enabled: !!dealId,
  });

  const { data: recentMessages = [] } = useQuery({
    queryKey: ["deal-chat-messages", dealChannel?.id],
    queryFn: () => getMessages(dealChannel!.id, 5),
    enabled: !!dealChannel?.id,
    refetchInterval: 5000,
  });

  const createChannelMut = useMutation({
    mutationFn: () => createChannel({
      companyId: companyId!,
      dealId,
      type: 'deal',
      name: `${deal?.name || '딜'} 채팅`,
      creatorUserId: userId!,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deal-channel", dealId] }),
  });

  const sendChatMut = useMutation({
    mutationFn: () => sendMessage({ channelId: dealChannel!.id, senderId: userId!, content: chatMsg }),
    onSuccess: () => {
      setChatMsg("");
      queryClient.invalidateQueries({ queryKey: ["deal-chat-messages", dealChannel?.id] });
    },
  });

  const tree = data?.nodes ? buildTree(data.nodes) : [];
  const deal = data?.deal;

  const totalRevenue = (data?.revenue || []).reduce((s, r) => s + Number(r.amount), 0);
  const totalCost = (data?.costs || []).reduce((s, c) => s + Number(c.amount), 0);
  const dealMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;

  async function addRootNode() {
    if (!rootName.trim()) return;
    await supabase.from("deal_nodes").insert({
      deal_id: dealId,
      parent_id: null,
      name: rootName.trim(),
      status: "pending",
    });
    setRootName("");
    setShowAddRoot(false);
    refetch();
  }

  if (isLoading) {
    return <div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>;
  }

  if (!deal) {
    return <div className="text-center py-20 text-[var(--text-muted)]">딜을 찾을 수 없습니다.</div>;
  }

  return (
    <div className="max-w-[1100px]">
      {/* Breadcrumb */}
      <div className="text-xs text-[var(--text-dim)] mb-4">
        <button onClick={onBack} className="hover:text-[var(--primary)]">딜 관리</button>
        <span className="mx-2">›</span>
        <span className="text-[var(--text-muted)]">{deal.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            {deal.deal_number && (
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] font-mono">
                {deal.deal_number}
              </span>
            )}
            <h1 className="text-2xl font-extrabold">{deal.name}</h1>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-[var(--text-muted)]">
            <span>계약금: ₩{Number(deal.contract_total || 0).toLocaleString()}</span>
            {deal.start_date && <span>{deal.start_date} ~ {deal.end_date || "진행중"}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={dealChannel ? `/chat?channel=${dealChannel.id}` : `/chat`}
            className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition">
            💬 채팅
          </Link>
          {deal.status !== 'archived' && (
            <button
              onClick={async () => {
                if (!confirm('이 딜을 아카이브하시겠습니까?\n대시보드/목록에서 숨겨집니다.')) return;
                const { archiveDeal } = await import('@/lib/archiving');
                await archiveDeal(dealId);
                queryClient.invalidateQueries({ queryKey: ['deal'] });
              }}
              className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition"
            >
              아카이브
            </button>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            deal.status === 'active' ? 'bg-green-500/10 text-green-400' :
            deal.status === 'archived' ? 'bg-orange-500/10 text-orange-400' :
            'bg-gray-500/10 text-gray-400'
          }`}>
            {deal.status === 'active' ? '진행중' : deal.status === 'archived' ? '아카이브' : deal.status}
          </span>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">총 매출</div>
          <div className="text-lg font-bold text-green-400 mt-1">₩{totalRevenue.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">총 비용</div>
          <div className="text-lg font-bold text-red-400 mt-1">₩{totalCost.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">마진</div>
          <div className={`text-lg font-bold mt-1 ${dealMargin < 20 ? 'text-red-400' : dealMargin < 35 ? 'text-yellow-400' : 'text-green-400'}`}>
            {dealMargin.toFixed(1)}%
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">작업 단계</div>
          <div className="text-lg font-bold mt-1">{data?.nodes.length || 0}</div>
        </div>
      </div>

      {/* Pipeline Visualization */}
      <DealPipelineWidget dealId={dealId} companyId={companyId} userId={userId} onRefresh={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["deal-detail"] }); }} />

      {/* Tree */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-bold">작업 트리 (무한 구조)</h2>
          <button
            onClick={() => setShowAddRoot(!showAddRoot)}
            className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold"
          >
            + 작업 추가
          </button>
        </div>

        <div className="flex items-center gap-2 py-2 px-5 text-[10px] text-[var(--text-dim)] font-medium border-b border-[var(--border)]/50">
          <span className="flex-1" style={{ paddingLeft: "32px" }}>항목명</span>
          <span className="w-24 text-right">매출</span>
          <span className="w-24 text-right">예상비용</span>
          <span className="w-24 text-right">실비용</span>
          <span className="w-16 text-right">마진</span>
          <span className="w-14 text-center">상태</span>
          <span className="w-5" />
        </div>

        {showAddRoot && (
          <div className="flex items-center gap-2 py-2 px-5">
            <input
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRootNode()}
              placeholder="작업 단계명 (예: 1차 수행)"
              className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] w-64"
              autoFocus
            />
            <button onClick={addRootNode} className="text-xs text-[var(--primary)] font-semibold">추가</button>
            <button onClick={() => setShowAddRoot(false)} className="text-xs text-[var(--text-dim)]">취소</button>
          </div>
        )}

        {tree.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--text-muted)]">
            작업 단계가 없습니다. 새 작업을 추가해주세요.
          </div>
        ) : (
          <div className="py-1">
            {tree.map((node) => (
              <NodeRow key={node.id} node={node} depth={0} dealId={dealId} onRefresh={refetch} />
            ))}
          </div>
        )}
      </div>

      {/* Revenue Schedule */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-bold">매출 스케줄</h2>
        </div>
        {(data?.revenue || []).length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">등록된 매출 스케줄이 없습니다.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-2 font-medium">예정일</th>
                <th className="text-right px-5 py-2 font-medium">금액</th>
                <th className="text-left px-5 py-2 font-medium">유형</th>
                <th className="text-left px-5 py-2 font-medium">발신처</th>
                <th className="text-center px-5 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {(data?.revenue || []).map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]/50">
                  <td className="px-5 py-2.5 text-sm">{r.due_date || "—"}</td>
                  <td className="px-5 py-2.5 text-sm text-right font-medium text-green-400">
                    ₩{Number(r.amount).toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{r.type || "—"}</td>
                  <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{r.expected_sender || "—"}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.status === 'received' ? 'bg-green-500/10 text-green-400' :
                      r.status === 'overdue' ? 'bg-red-500/10 text-red-400' :
                      'bg-gray-500/10 text-gray-400'
                    }`}>
                      {r.status === 'received' ? '수금' : r.status === 'overdue' ? '연체' : '예정'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Milestones */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-bold">마일스톤 / D-day</h2>
          <button
            onClick={() => setShowMilestoneForm(!showMilestoneForm)}
            className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold"
          >
            + 마일스톤
          </button>
        </div>

        {showMilestoneForm && (
          <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]/50">
            <input
              value={msForm.name}
              onChange={(e) => setMsForm({ ...msForm, name: e.target.value })}
              placeholder="마일스톤명"
              className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] w-48"
            />
            <input
              type="date"
              value={msForm.due_date}
              onChange={(e) => setMsForm({ ...msForm, due_date: e.target.value })}
              className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              onClick={() => msForm.name && msForm.due_date && addMilestoneMut.mutate()}
              disabled={!msForm.name || !msForm.due_date}
              className="text-xs text-[var(--primary)] font-semibold disabled:opacity-50"
            >
              추가
            </button>
            <button onClick={() => setShowMilestoneForm(false)} className="text-xs text-[var(--text-dim)]">취소</button>
          </div>
        )}

        {milestones.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">마일스톤이 없습니다.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {milestones.map((ms: DealMilestone) => {
              const daysLeft = Math.ceil((new Date(ms.due_date).getTime() - Date.now()) / 86400000);
              const isOverdue = daysLeft < 0 && ms.status !== 'completed';
              return (
                <div key={ms.id} className="flex items-center gap-3 px-5 py-3">
                  <button
                    onClick={() => ms.status !== 'completed' && completeMsMut.mutate(ms.id)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${
                      ms.status === 'completed'
                        ? 'border-green-400 bg-green-400/20 text-green-400 text-[10px]'
                        : 'border-[var(--border)] hover:border-[var(--primary)]'
                    }`}
                  >
                    {ms.status === 'completed' && '✓'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${ms.status === 'completed' ? 'line-through text-[var(--text-dim)]' : ''}`}>
                      {ms.name}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-dim)]">{ms.due_date}</span>
                  {ms.status !== 'completed' && (
                    <span className={`text-xs font-bold ${
                      isOverdue ? 'text-red-400' : daysLeft <= 3 ? 'text-yellow-400' : 'text-[var(--text-muted)]'
                    }`}>
                      {isOverdue ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sub Deals */}
      {subDeals.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-bold">서브딜 (외주/파트너)</h2>
          </div>
          <div className="divide-y divide-[var(--border)]/50">
            {subDeals.map((sd: any) => (
              <div key={sd.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <span className="text-sm font-medium">{sd.name}</span>
                  <span className="text-xs text-[var(--text-dim)] ml-2">
                    {sd.vendors?.name || sd.type}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold">₩{Number(sd.contract_amount || 0).toLocaleString()}</span>
                  <span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${
                    sd.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'
                  }`}>
                    {sd.status === 'active' ? '진행중' : sd.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignments */}
      {assignments.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-bold">담당자</h2>
          </div>
          <div className="divide-y divide-[var(--border)]/50">
            {assignments.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-xs font-bold">
                    {(a.users?.name || a.users?.email || '?')[0]}
                  </div>
                  <span className="text-sm">{a.users?.name || a.users?.email}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">
                  {a.role === 'manager' ? '담당자' : a.role === 'reviewer' ? '검토자' : '참여자'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline Chat Widget */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-bold">💬 딜 채팅</h2>
          {dealChannel && (
            <Link href={`/chat?channel=${dealChannel.id}`}
              className="text-[10px] text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">
              전체 채팅 보기 &rarr;
            </Link>
          )}
        </div>
        {!dealChannel ? (
          <div className="p-6 text-center">
            <div className="text-sm text-[var(--text-muted)] mb-3">이 딜에 연결된 채팅이 없습니다</div>
            <button
              onClick={() => userId && companyId && createChannelMut.mutate()}
              disabled={createChannelMut.isPending || !userId}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {createChannelMut.isPending ? '생성 중...' : '딜 채팅 생성'}
            </button>
          </div>
        ) : (
          <div>
            <div className="px-5 py-3 max-h-48 overflow-y-auto">
              {recentMessages.length === 0 ? (
                <div className="text-center text-xs text-[var(--text-dim)] py-4">메시지가 없습니다</div>
              ) : (
                recentMessages.map((msg: any) => (
                  <div key={msg.id} className="flex items-start gap-2 py-1.5">
                    <div className="w-5 h-5 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[9px] font-bold text-[var(--primary)] flex-shrink-0 mt-0.5">
                      {(msg.users?.name || msg.users?.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                        {msg.users?.name || msg.users?.email}
                      </span>
                      <div className="text-xs text-[var(--text)]">{msg.content}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)]/50 flex gap-2">
              <input
                value={chatMsg}
                onChange={(e) => setChatMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && chatMsg.trim() && sendChatMut.mutate()}
                placeholder="빠른 메시지..."
                className="flex-1 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
              />
              <button
                onClick={() => chatMsg.trim() && sendChatMut.mutate()}
                disabled={!chatMsg.trim() || sendChatMut.isPending}
                className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-30">
                전송
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Deal Pipeline Widget ──

const PIPELINE_STAGES: { key: PipelineStage['stage']; label: string; icon: string }[] = [
  { key: 'quote', label: '견적서', icon: '📄' },
  { key: 'contract', label: '계약서', icon: '📝' },
  { key: 'tax_invoice', label: '세금계산서', icon: '🧾' },
  { key: 'payment_schedule', label: '입금 스케줄', icon: '📅' },
  { key: 'payment_received', label: '입금 완료', icon: '💰' },
];

function DealPipelineWidget({ dealId, companyId, userId, onRefresh }: {
  dealId: string;
  companyId: string | null;
  userId: string | null;
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data: stages = [] } = useQuery({
    queryKey: ['deal-pipeline', dealId],
    queryFn: () => getDealPipelineStatus(dealId),
    enabled: !!dealId,
  });

  const completedCount = stages.filter(s => s.status === 'completed').length;
  const progress = stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0;

  async function handleCreateQuote() {
    if (!companyId || !userId || creating) return;
    setCreating(true);
    try {
      await createDocumentFromDeal({ companyId, dealId, docType: 'invoice', createdBy: userId });
      queryClient.invalidateQueries({ queryKey: ['deal-pipeline', dealId] });
      onRefresh();
    } catch {
      // silent
    }
    setCreating(false);
  }

  const hasQuote = stages.some(s => s.stage === 'quote' && s.status !== 'pending');

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold">프로세스 파이프라인</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
            {progress}%
          </span>
        </div>
        {!hasQuote && companyId && userId && (
          <button
            onClick={handleCreateQuote}
            disabled={creating}
            className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-[var(--primary-hover)] transition"
          >
            {creating ? '생성 중...' : '+ 견적서 생성'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-5 pt-4">
        <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stages */}
      <div className="px-5 py-4 flex items-center gap-1">
        {PIPELINE_STAGES.map((ps, idx) => {
          const stage = stages.find(s => s.stage === ps.key);
          const status = stage?.status || 'pending';
          const isCompleted = status === 'completed';
          const isActive = status === 'active';

          return (
            <div key={ps.key} className="flex items-center flex-1">
              <div className={`flex-1 rounded-xl p-3 text-center transition ${
                isCompleted ? 'bg-green-500/8 border border-green-500/20' :
                isActive ? 'bg-blue-500/8 border border-blue-500/20' :
                'bg-[var(--bg-surface)] border border-[var(--border)]'
              }`}>
                <div className="text-lg mb-1">{ps.icon}</div>
                <div className={`text-[10px] font-semibold ${
                  isCompleted ? 'text-green-500' :
                  isActive ? 'text-blue-500' :
                  'text-[var(--text-dim)]'
                }`}>
                  {ps.label}
                </div>
                <div className={`text-[9px] mt-0.5 ${
                  isCompleted ? 'text-green-400' :
                  isActive ? 'text-blue-400' :
                  'text-[var(--text-dim)]'
                }`}>
                  {isCompleted ? '완료' : isActive ? '진행중' : '대기'}
                </div>
              </div>
              {idx < PIPELINE_STAGES.length - 1 && (
                <div className={`w-4 h-0.5 mx-0.5 flex-shrink-0 rounded ${
                  isCompleted ? 'bg-green-500/40' : 'bg-[var(--border)]'
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-process hint */}
      <div className="px-5 pb-4">
        <div className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] rounded-lg p-2.5">
          자동 흐름: 견적서 승인 → 계약서 자동생성 → 계약서 승인 → 세금계산서 자동발행 + 입금 스케줄(선금30%/잔금70%) 자동생성
        </div>
      </div>
    </div>
  );
}

// ── Kanban Status Config ──

type KanbanStatus = 'active' | 'pending' | 'closed_won' | 'closed_lost' | 'dormant';

interface KanbanColumn {
  key: KanbanStatus;
  label: string;
  color: string;
  bgLight: string;
  borderColor: string;
  headerBg: string;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'active',      label: '진행중',  color: '#2563EB', bgLight: 'rgba(37,99,235,0.06)',  borderColor: 'rgba(37,99,235,0.2)',  headerBg: 'rgba(37,99,235,0.08)' },
  { key: 'pending',     label: '검토중',  color: '#EAB308', bgLight: 'rgba(234,179,8,0.06)',   borderColor: 'rgba(234,179,8,0.2)',   headerBg: 'rgba(234,179,8,0.08)' },
  { key: 'closed_won',  label: '완료',    color: '#22C55E', bgLight: 'rgba(34,197,94,0.06)',   borderColor: 'rgba(34,197,94,0.2)',   headerBg: 'rgba(34,197,94,0.08)' },
  { key: 'closed_lost', label: '실패',    color: '#EF4444', bgLight: 'rgba(239,68,68,0.06)',   borderColor: 'rgba(239,68,68,0.2)',   headerBg: 'rgba(239,68,68,0.08)' },
  { key: 'dormant',     label: '휴면',    color: '#6B7280', bgLight: 'rgba(107,114,128,0.06)', borderColor: 'rgba(107,114,128,0.2)', headerBg: 'rgba(107,114,128,0.08)' },
];

function mapDealToKanbanStatus(deal: any): KanbanStatus {
  if (deal.is_dormant) return 'dormant';
  switch (deal.status) {
    case 'active':    return 'active';
    case 'pending':   return 'pending';
    case 'completed': return 'closed_won';
    case 'archived':  return 'closed_lost';
    default:          return 'pending';
  }
}

// ── Kanban Card ──

function KanbanCard({ deal, clsColorMap, onClick }: {
  deal: any;
  clsColorMap: Record<string, string>;
  onClick: () => void;
}) {
  const total = Number(deal.contract_total || 0);
  const dateStr = deal.start_date
    ? `${deal.start_date}${deal.end_date ? ` ~ ${deal.end_date}` : ''}`
    : deal.created_at ? new Date(deal.created_at).toLocaleDateString('ko') : '';

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)]/40 hover:shadow-md transition-all group cursor-pointer"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <ClassificationBadge
          classification={deal.classification || 'B2B'}
          color={clsColorMap[deal.classification || 'B2B']}
        />
        {deal.deal_number && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] font-mono">
            {deal.deal_number}
          </span>
        )}
      </div>
      <div className="text-sm font-bold leading-tight group-hover:text-[var(--primary)] transition mb-2 line-clamp-2">
        {deal.name}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-[var(--text)]">
          {total > 0 ? `₩${total.toLocaleString()}` : '—'}
        </span>
      </div>
      {dateStr && (
        <div className="text-[10px] text-[var(--text-dim)] mt-1.5">{dateStr}</div>
      )}
    </button>
  );
}

// ── Kanban Board ──

function KanbanBoard({ deals, clsColorMap, onSelectDeal }: {
  deals: any[];
  clsColorMap: Record<string, string>;
  onSelectDeal: (id: string) => void;
}) {
  const grouped = KANBAN_COLUMNS.map((col) => ({
    ...col,
    deals: deals.filter((d) => mapDealToKanbanStatus(d) === col.key),
  }));

  return (
    <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
      {grouped.map((col) => (
        <div
          key={col.key}
          className="flex-shrink-0 rounded-2xl border overflow-hidden flex flex-col"
          style={{
            width: '280px',
            backgroundColor: col.bgLight,
            borderColor: col.borderColor,
          }}
        >
          {/* Column Header */}
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ backgroundColor: col.headerBg }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: col.color }}
              />
              <span className="text-sm font-bold" style={{ color: col.color }}>
                {col.label}
              </span>
            </div>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: `${col.color}15`,
                color: col.color,
              }}
            >
              {col.deals.length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex-1 p-3 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            {col.deals.length === 0 ? (
              <div className="text-center py-8 text-xs text-[var(--text-dim)]">
                딜 없음
              </div>
            ) : (
              col.deals.map((deal) => (
                <KanbanCard
                  key={deal.id}
                  deal={deal}
                  clsColorMap={clsColorMap}
                  onClick={() => onSelectDeal(deal.id)}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── View Toggle ──

function ViewToggle({ viewMode, onChange }: { viewMode: 'table' | 'kanban'; onChange: (v: 'table' | 'kanban') => void }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
      <button
        onClick={() => onChange('table')}
        className={`px-4 py-2 text-xs font-semibold transition-all ${
          viewMode === 'table'
            ? 'bg-[var(--primary)] text-white shadow-sm'
            : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
          테이블
        </span>
      </button>
      <button
        onClick={() => onChange('kanban')}
        className={`px-4 py-2 text-xs font-semibold transition-all ${
          viewMode === 'kanban'
            ? 'bg-[var(--primary)] text-white shadow-sm'
            : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="6" height="18" rx="1"/>
            <rect x="9" y="3" width="6" height="12" rx="1"/>
            <rect x="16" y="3" width="6" height="15" rx="1"/>
          </svg>
          칸반
        </span>
      </button>
    </div>
  );
}

// ── Deals List ──

function DealsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ classification: "B2B", name: "", contract_total: "", start_date: "", end_date: "" });
  const [filterCls, setFilterCls] = useState<string | null>(null);
  const [showDormant, setShowDormant] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => u && setCompanyId(u.company_id));
  }, []);

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });

  const { data: classifications = [] } = useQuery({
    queryKey: ["deal-classifications", companyId],
    queryFn: () => getDealClassifications(companyId!),
    enabled: !!companyId,
  });

  const { data: matchingStatuses = [] } = useQuery({
    queryKey: ['deal-matching', companyId],
    queryFn: () => getDealMatchingStatuses(companyId!),
    enabled: !!companyId,
  });

  const { data: dormantDeals = [] } = useQuery({
    queryKey: ['dormant-deals', companyId],
    queryFn: () => getDormantDeals(companyId!),
    enabled: !!companyId && showDormant,
  });

  const reactivateMut = useMutation({
    mutationFn: (dealId: string) => reactivateDeal(dealId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['dormant-deals'] });
    },
  });

  const matchMap = Object.fromEntries(matchingStatuses.map((m: any) => [m.dealId, m]));

  const clsColorMap = Object.fromEntries(
    classifications.map((c: any) => [c.name, c.color || DEFAULT_COLORS[c.name] || '#8b5cf6'])
  );

  const createDeal = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("deals").insert({
        company_id: companyId!,
        name: form.name,
        classification: form.classification,
        contract_total: Number(form.contract_total) || 0,
        status: "active",
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      setShowForm(false);
      setForm({ classification: "B2B", name: "", contract_total: "", start_date: "", end_date: "" });
    },
  });

  const filteredDeals = filterCls ? deals.filter((d: any) => d.classification === filterCls) : deals;
  const activeCls = Array.from(new Set(deals.map((d: any) => d.classification || 'B2B')));

  // If an ID is selected, show the detail view
  if (selectedId) {
    return (
      <DealDetailView
        dealId={selectedId}
        onBack={() => router.push("/deals")}
      />
    );
  }

  return (
    <div className={viewMode === 'kanban' ? 'max-w-full' : 'max-w-[1000px]'}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">딜 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">모든 프로젝트/계약을 딜 단위로 관리합니다</p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
          >
            + 새 딜
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">새 딜 등록</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류 *</label>
              <select
                value={form.classification}
                onChange={(e) => setForm({ ...form, classification: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {classifications.length > 0
                  ? classifications.map((c: any) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))
                  : ['B2B', 'B2C', 'B2G'].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))
                }
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">딜명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 수출바우처 - A기업"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">계약금액 (원)</label>
              <input
                type="number"
                value={form.contract_total}
                onChange={(e) => setForm({ ...form, contract_total: e.target.value })}
                placeholder="15000000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">시작일</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => form.name && createDeal.mutate()}
              disabled={!form.name || createDeal.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {createDeal.isPending ? "생성 중..." : "딜 생성"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Classification Filter Pills */}
      {activeCls.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setFilterCls(null)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              !filterCls ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]'
            }`}
          >
            전체 ({deals.length})
          </button>
          {activeCls.map(cls => {
            const count = deals.filter((d: any) => (d.classification || 'B2B') === cls).length;
            return (
              <button
                key={cls}
                onClick={() => setFilterCls(filterCls === cls ? null : cls)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  filterCls === cls ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                {cls} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Dormant Toggle */}
      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDormant}
            onChange={(e) => setShowDormant(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] focus:ring-[var(--primary)] accent-[var(--primary)]"
          />
          <span className="text-xs text-[var(--text-muted)]">휴면 딜 표시</span>
        </label>
        {showDormant && dormantDeals.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">
            {dormantDeals.length}건 휴면
          </span>
        )}
      </div>

      {/* Dormant Deals */}
      {showDormant && dormantDeals.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-orange-400 mb-2">휴면 딜 (30일 이상 활동 없음)</h3>
          <div className="space-y-2">
            {dormantDeals.map((d: any) => (
              <div key={d.id}
                className="bg-[var(--bg-card)] rounded-xl border border-orange-500/20 p-4 opacity-70">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">휴면</span>
                    <div>
                      <div className="text-sm font-semibold">{d.name}</div>
                      <div className="text-xs text-[var(--text-dim)] mt-0.5">
                        마지막 활동: {d.last_activity_at ? new Date(d.last_activity_at).toLocaleDateString('ko') : '--'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--text-muted)]">
                      {Number(d.contract_total || 0).toLocaleString()}원
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); reactivateMut.mutate(d.id); }}
                      disabled={reactivateMut.isPending}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition disabled:opacity-50">
                      활성화
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deals List */}
      {isLoading ? (
        <div className="text-center py-20 text-[var(--text-muted)] text-sm">로딩 중...</div>
      ) : deals.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
          <div className="text-4xl mb-4">💼</div>
          <div className="text-lg font-bold mb-2">첫 딜을 등록하세요</div>
          <div className="text-sm text-[var(--text-muted)] mb-6">딜 = 프로젝트 = 계약. 모든 돈은 딜에 연결됩니다.</div>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold"
          >
            + 새 딜 등록
          </button>
        </div>
      ) : viewMode === 'kanban' ? (
        /* ── Kanban View ── */
        <KanbanBoard
          deals={filteredDeals}
          clsColorMap={clsColorMap}
          onSelectDeal={(id) => router.push(`/deals?id=${id}`)}
        />
      ) : (
        /* ── Table View (default) ── */
        <div className="space-y-3">
          {filteredDeals.map((d: any) => (
            <button
              key={d.id}
              onClick={() => router.push(`/deals?id=${d.id}`)}
              className={`w-full text-left block bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 hover:border-[var(--primary)]/40 transition group ${d.is_dormant ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {d.is_dormant && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-semibold">휴면</span>
                    )}
                    <ClassificationBadge
                      classification={d.classification || 'B2B'}
                      color={clsColorMap[d.classification || 'B2B']}
                    />
                    {d.deal_number && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] font-mono">
                        {d.deal_number}
                      </span>
                    )}
                    <span className="text-sm font-bold group-hover:text-[var(--primary)] transition">{d.name}</span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)] mt-1">
                    {d.start_date && `${d.start_date} ~ ${d.end_date || "진행중"}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">₩{Number(d.contract_total || 0).toLocaleString()}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    d.status === 'active' ? 'bg-green-500/10 text-green-400' :
                    d.status === 'completed' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    {d.status === 'active' ? '진행중' : d.status === 'completed' ? '완료' : d.status}
                  </span>
                </div>
              </div>
              {matchMap[d.id] && matchMap[d.id].contractTotal > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]/50">
                  <div className="flex items-center gap-4 text-[10px]">
                    <span className="text-[var(--text-dim)]">계약 ₩{Number(matchMap[d.id].contractTotal).toLocaleString()}</span>
                    <span className="text-[var(--text-dim)]">세금계산서 ₩{Number(matchMap[d.id].taxInvoicedAmount).toLocaleString()}</span>
                    <span className="text-[var(--text-dim)]">수금 ₩{Number(matchMap[d.id].paidAmount).toLocaleString()}</span>
                    <span className={`ml-auto font-semibold mono-number ${matchMap[d.id].matchRate >= 100 ? 'text-[var(--success)]' : matchMap[d.id].matchRate >= 50 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>
                      {matchMap[d.id].matchRate}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${matchMap[d.id].matchRate >= 100 ? 'bg-[var(--success)]' : matchMap[d.id].matchRate >= 50 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'}`}
                      style={{ width: `${Math.min(100, matchMap[d.id].matchRate)}%` }}
                    />
                  </div>
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
  return (
    <Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}>
      <DealsPageInner />
    </Suspense>
  );
}

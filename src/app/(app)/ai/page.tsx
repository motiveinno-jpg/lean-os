"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { aiSearchEntities, aiGetDashboardSummary, aiGetFinancialSummary } from "@/lib/ai-tools";
import { getPendingActions, getAllActions, approveAction, rejectAction, getAiHistory } from "@/lib/ai-pending";

// ── Types ──
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  data?: any;
  timestamp: Date;
};

type Tab = "pending" | "history";

// ── Formatters ──
function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}

function timeAgo(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  return `${days}일 전`;
}

// ═══════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════
export default function AiPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [rightTab, setRightTab] = useState<Tab>("pending");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    });
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Pending Actions ──
  const { data: pendingActions = [] } = useQuery({
    queryKey: ["ai-pending", companyId],
    queryFn: () => getPendingActions(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  // ── All Actions (history) ──
  const { data: allActions = [] } = useQuery({
    queryKey: ["ai-all-actions", companyId],
    queryFn: () => getAllActions(companyId!),
    enabled: !!companyId && rightTab === "history",
  });

  // ── AI Interaction History ──
  const { data: aiHistoryData = [] } = useQuery({
    queryKey: ["ai-history", companyId],
    queryFn: () => getAiHistory(companyId!),
    enabled: !!companyId && rightTab === "history",
  });

  // ── Approve/Reject Mutations ──
  const approveMut = useMutation({
    mutationFn: (actionId: string) => approveAction(actionId, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-pending"] });
      queryClient.invalidateQueries({ queryKey: ["ai-all-actions"] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: (actionId: string) => rejectAction(actionId, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-pending"] });
      queryClient.invalidateQueries({ queryKey: ["ai-all-actions"] });
    },
  });

  // ── Chat Handler ──
  const addMessage = useCallback((role: "user" | "assistant", content: string, data?: any) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, content, data, timestamp: new Date() },
    ]);
  }, []);

  const handleQuickAction = useCallback(
    async (action: "dashboard" | "financial" | "search") => {
      if (!companyId) return;
      setLoading(true);

      try {
        if (action === "dashboard") {
          addMessage("user", "대시보드 요약을 보여줘");
          const data = await aiGetDashboardSummary(companyId);
          addMessage("assistant", "대시보드 요약 결과입니다.", data);
        } else if (action === "financial") {
          addMessage("user", "재무 현황을 알려줘");
          const data = await aiGetFinancialSummary(companyId);
          addMessage("assistant", "재무 현황 요약입니다.", data);
        } else if (action === "search") {
          const query = input.trim() || "전체";
          addMessage("user", `"${query}" 검색`);
          const data = await aiSearchEntities(companyId, query);
          addMessage("assistant", `"${query}" 검색 결과입니다.`, data);
          setInput("");
        }
      } catch (err: any) {
        addMessage("assistant", `오류 발생: ${err.message || "알 수 없는 오류"}`);
      } finally {
        setLoading(false);
      }
    },
    [companyId, input, addMessage],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || !companyId) return;
      const query = input.trim();
      setInput("");
      addMessage("user", query);
      setLoading(true);

      try {
        // Simple keyword-based routing
        if (query.includes("요약") || query.includes("대시보드") || query.includes("현황판")) {
          const data = await aiGetDashboardSummary(companyId);
          addMessage("assistant", "대시보드 요약 결과입니다.", data);
        } else if (query.includes("재무") || query.includes("수입") || query.includes("지출") || query.includes("매출")) {
          const data = await aiGetFinancialSummary(companyId);
          addMessage("assistant", "재무 현황 요약입니다.", data);
        } else {
          // Default: search
          const data = await aiSearchEntities(companyId, query);
          const total = data.deals.length + data.partners.length + data.documents.length + data.employees.length;
          if (total > 0) {
            addMessage("assistant", `"${query}" 검색 결과입니다. (${total}건)`, data);
          } else {
            addMessage("assistant", `"${query}"에 대한 검색 결과가 없습니다. AI 도구가 연결되면 자동 응답합니다.`);
          }
        }
      } catch (err: any) {
        addMessage("assistant", `오류 발생: ${err.message || "알 수 없는 오류"}`);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [companyId, input, addMessage],
  );

  // ── Render Helpers ──
  function renderData(data: any) {
    if (!data) return null;

    // Dashboard summary
    if ("totalDeals" in data && "totalEmployees" in data) {
      return (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">총 딜</div>
            <div className="text-lg font-bold mt-1">{data.totalDeals}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">활성 {data.activeDeals}건</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">총 금액</div>
            <div className="text-lg font-bold mt-1">{fmtW(data.totalAmount)}</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">직원</div>
            <div className="text-lg font-bold mt-1">{data.totalEmployees}명</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">미결 비용</div>
            <div className="text-lg font-bold mt-1">{fmtW(data.pendingExpenses)}</div>
          </div>
        </div>
      );
    }

    // Financial summary
    if ("totalIncome" in data && "totalExpense" in data) {
      return (
        <div className="mt-2 space-y-2">
          <div className="flex justify-between items-center bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <span className="text-xs text-[var(--text-secondary)]">총 수입</span>
            <span className="text-sm font-bold text-green-400">{fmtW(data.totalIncome)}</span>
          </div>
          <div className="flex justify-between items-center bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <span className="text-xs text-[var(--text-secondary)]">총 지출</span>
            <span className="text-sm font-bold text-red-400">{fmtW(data.totalExpense)}</span>
          </div>
          <div className="flex justify-between items-center bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border)]">
            <span className="text-xs text-[var(--text-secondary)]">순이익</span>
            <span className={`text-sm font-bold ${data.netIncome >= 0 ? "text-green-400" : "text-red-400"}`}>
              {fmtW(data.netIncome)}
            </span>
          </div>
        </div>
      );
    }

    // Search results
    if ("deals" in data && "partners" in data) {
      const sections = [
        { key: "deals", label: "딜", items: data.deals },
        { key: "partners", label: "거래처", items: data.partners },
        { key: "documents", label: "문서", items: data.documents },
        { key: "employees", label: "직원", items: data.employees },
      ];
      return (
        <div className="mt-2 space-y-2">
          {sections.map((s) =>
            s.items.length > 0 ? (
              <div key={s.key}>
                <div className="text-[10px] text-[var(--text-dim)] uppercase font-semibold mb-1">{s.label} ({s.items.length})</div>
                <div className="space-y-1">
                  {s.items.map((item: any) => (
                    <div key={item.id} className="bg-[var(--bg-surface)] rounded px-3 py-2 text-xs border border-[var(--border)]">
                      <span className="font-medium">{item.name}</span>
                      {item.status && (
                        <span className="ml-2 text-[10px] text-[var(--text-dim)]">[{item.status}]</span>
                      )}
                      {item.amount != null && (
                        <span className="ml-2 text-[10px] text-[var(--text-secondary)]">{fmtW(item.amount)}</span>
                      )}
                      {item.position && (
                        <span className="ml-2 text-[10px] text-[var(--text-dim)]">{item.position}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      );
    }

    return null;
  }

  const STATUS_COLORS: Record<string, string> = {
    pending: "text-yellow-400",
    approved: "text-green-400",
    rejected: "text-red-400",
  };

  const ACTION_LABELS: Record<string, string> = {
    delete: "삭제 요청",
    update_financials: "재무 수정 요청",
  };

  // ═══════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════
  return (
    <div className="flex h-full gap-4 p-4">
      {/* ── Left: Chat Panel ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white text-sm font-black">
            AI
          </div>
          <div>
            <div className="text-sm font-bold">AI 어시스턴트</div>
            <div className="text-[10px] text-[var(--text-dim)]">L1 조회 / L2 자동실행 / L3 승인 큐</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex gap-2 flex-wrap">
          <button
            onClick={() => handleQuickAction("dashboard")}
            disabled={loading || !companyId}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition disabled:opacity-40"
          >
            대시보드 요약
          </button>
          <button
            onClick={() => handleQuickAction("financial")}
            disabled={loading || !companyId}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-40"
          >
            재무 현황
          </button>
          <button
            onClick={() => handleQuickAction("search")}
            disabled={loading || !companyId}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition disabled:opacity-40"
          >
            검색
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
              <div className="text-3xl mb-3">AI</div>
              <div className="text-sm font-medium text-[var(--text-secondary)]">LeanOS AI 어시스턴트</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1 max-w-xs">
                질문을 입력하거나 퀵 액션 버튼을 눌러보세요.
                대시보드 요약, 재무 현황, 엔티티 검색이 가능합니다.
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-[var(--primary)] text-white"
                    : "bg-[var(--bg-surface)] border border-[var(--border)]"
                }`}
              >
                <div className="text-xs whitespace-pre-wrap">{msg.content}</div>
                {msg.data && renderData(msg.data)}
                <div
                  className={`text-[9px] mt-2 ${
                    msg.role === "user" ? "text-white/50" : "text-[var(--text-dim)]"
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                  <span className="inline-block w-2 h-2 bg-[var(--primary)] rounded-full animate-pulse" />
                  처리 중...
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-[var(--border)] flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="질문을 입력하세요... (예: 대시보드 요약, 재무 현황, 검색어)"
            className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-xs text-white placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--primary)] transition"
            disabled={loading || !companyId}
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || !companyId}
            className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-40"
          >
            전송
          </button>
        </form>
      </div>

      {/* ── Right: Pending Actions & History ── */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          <button
            onClick={() => setRightTab("pending")}
            className={`flex-1 px-4 py-3 text-xs font-semibold transition ${
              rightTab === "pending"
                ? "text-[var(--primary)] border-b-2 border-[var(--primary)]"
                : "text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
            }`}
          >
            대기 ({pendingActions.length})
          </button>
          <button
            onClick={() => setRightTab("history")}
            className={`flex-1 px-4 py-3 text-xs font-semibold transition ${
              rightTab === "history"
                ? "text-[var(--primary)] border-b-2 border-[var(--primary)]"
                : "text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
            }`}
          >
            히스토리
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {rightTab === "pending" && (
            <>
              {pendingActions.length === 0 && (
                <div className="text-center py-8 text-[var(--text-dim)] text-xs">
                  대기 중인 액션이 없습니다
                </div>
              )}
              {pendingActions.map((action: any) => (
                <div
                  key={action.id}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-3"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-[10px] font-bold text-yellow-400 uppercase">
                      {ACTION_LABELS[action.action_type] || action.action_type}
                    </span>
                    <span className="text-[9px] text-[var(--text-dim)]">
                      {timeAgo(action.created_at)}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mb-1">
                    {action.entity_type} / {action.entity_id?.slice(0, 8)}...
                  </div>
                  <div className="text-[11px] mb-3">{action.description}</div>
                  {action.users && (
                    <div className="text-[9px] text-[var(--text-dim)] mb-2">
                      요청자: {action.users.name || action.users.email}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveMut.mutate(action.id)}
                      disabled={approveMut.isPending}
                      className="flex-1 px-2 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition disabled:opacity-40"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => rejectMut.mutate(action.id)}
                      disabled={rejectMut.isPending}
                      className="flex-1 px-2 py-1.5 bg-red-500/15 text-red-400 rounded text-[10px] font-semibold hover:bg-red-500/25 transition disabled:opacity-40"
                    >
                      거부
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {rightTab === "history" && (
            <>
              {allActions.length === 0 && aiHistoryData.length === 0 && (
                <div className="text-center py-8 text-[var(--text-dim)] text-xs">
                  아직 기록이 없습니다
                </div>
              )}

              {/* Pending action history */}
              {allActions.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] text-[var(--text-dim)] uppercase font-semibold mb-2 px-1">
                    승인/거부 내역
                  </div>
                  {allActions.map((action: any) => (
                    <div
                      key={action.id}
                      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-3 mb-2"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] font-bold uppercase ${STATUS_COLORS[action.status] || "text-[var(--text-dim)]"}`}>
                          {ACTION_LABELS[action.action_type] || action.action_type}
                        </span>
                        <span className={`text-[9px] font-medium ${STATUS_COLORS[action.status] || ""}`}>
                          {action.status === "approved" ? "승인됨" : action.status === "rejected" ? "거부됨" : "대기"}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{action.description}</div>
                      <div className="text-[9px] text-[var(--text-dim)] mt-1">
                        {timeAgo(action.created_at)}
                        {action.approver?.name && ` - ${action.approver.name}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI interaction history */}
              {aiHistoryData.length > 0 && (
                <div>
                  <div className="text-[10px] text-[var(--text-dim)] uppercase font-semibold mb-2 px-1">
                    AI 사용 기록
                  </div>
                  {aiHistoryData.map((item: any) => (
                    <div
                      key={item.id}
                      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-3 mb-2"
                    >
                      <div className="text-[11px] font-medium">{item.query}</div>
                      {item.users?.name && (
                        <div className="text-[9px] text-[var(--text-dim)] mt-1">
                          {item.users.name} - {timeAgo(item.created_at)}
                        </div>
                      )}
                      {item.tokens_used && (
                        <div className="text-[9px] text-[var(--text-dim)]">
                          토큰: {item.tokens_used.toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

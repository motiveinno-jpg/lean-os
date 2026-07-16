"use client";

// 3-Way 매칭 페이지 — 사장님 요청 (2026-05-21)
//   세금계산서(좌) ↔ 매칭 후보 입출금(우) 추천 리스트.
//   추천 규칙: 거래처명 / 대표자명 / 금액±10% — 하나라도 충족 시 노출.
//   기존 /tax-invoices·/matching 의 3-way 매칭 UI 는 본 페이지로 일원화.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import {
  listUnmatchedInvoices,
  listMatchedInvoices,
  getThreeWayCandidates,
  confirmThreeWayMatch,
  unmatchInvoice,
  type ThreeWayInvoice,
} from "@/lib/three-way-match";
import { getCurrentUser } from "@/lib/queries";

export default function ThreeWayMatchPage() {
  const { role, loading } = useUser();
  if (loading) return <div className="p-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  if (role === "partner") {
    return <AccessDenied detail="3-Way 매칭은 대표/관리자 전용입니다." />;
  }
  return <Inner />;
}

function Inner() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'sales' | 'purchase'>("all");
  const [selectedInvoice, setSelectedInvoice] = useState<ThreeWayInvoice | null>(null);

  // 회사 id — QA 2026-06-12: useState 초기화자에서 side effect(렌더 중 fetch, strict mode 2회) → useEffect 로 교정
  useEffect(() => {
    getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); });
  }, []);

  // 미매칭 세금계산서 목록
  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["three-way-invoices", companyId, typeFilter],
    queryFn: () => listUnmatchedInvoices(companyId!, typeFilter === 'all' ? undefined : { type: typeFilter }),
    enabled: !!companyId,
  });

  // 선택된 invoice 의 매칭 후보
  const { data: candidates = [], isLoading: candLoading } = useQuery({
    queryKey: ["three-way-candidates", companyId, selectedInvoice?.id],
    queryFn: () => getThreeWayCandidates(companyId!, selectedInvoice!),
    enabled: !!companyId && !!selectedInvoice,
  });

  // 매칭 완료 목록 — 우측 패널
  const { data: matched = [], isLoading: matchedLoading } = useQuery({
    queryKey: ["three-way-matched", companyId, typeFilter],
    queryFn: () => listMatchedInvoices(companyId!, typeFilter === 'all' ? undefined : { type: typeFilter }),
    enabled: !!companyId,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["three-way-invoices"] });
    qc.invalidateQueries({ queryKey: ["three-way-candidates"] });
    qc.invalidateQueries({ queryKey: ["three-way-matched"] });
  };

  const matchMut = useMutation({
    mutationFn: ({ bankTxId, invoiceId }: { bankTxId: string; invoiceId: string }) => confirmThreeWayMatch(bankTxId, invoiceId),
    onSuccess: () => {
      toast("매칭 완료", "success");
      invalidateAll();
      setSelectedInvoice(null);
    },
    onError: (err: Error) => toast(friendlyError(err, "매칭 실패"), "error"),
  });

  const unmatchMut = useMutation({
    mutationFn: ({ bankTxId, invoiceId }: { bankTxId: string; invoiceId: string }) => unmatchInvoice(bankTxId, invoiceId),
    onSuccess: () => {
      toast("매칭이 해제되었습니다", "success");
      invalidateAll();
    },
    onError: (err: Error) => toast(friendlyError(err, "매칭 해제 실패"), "error"),
  });

  return (
    <div className="three-way-match-page">
      {/* 툴바 — 유형 필터 탭. 페이지 타이틀은 공통 헤더바가 표시 (2026-07-03 라운드6.5) */}
      <div className="three-way-match-toolbar page-sticky-header">
        <div className="seg-bar">
          {(["all", "sales", "purchase"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`seg-item ${typeFilter === t ? 'seg-item-active' : ''}`}
            >
              {t === 'all' ? '전체' : t === 'sales' ? '매출' : '매입'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
        {/* 좌측 — 미매칭 세금계산서 */}
        <div className="three-way-unmatched-panel glass-card">
          <div className="three-way-panel-header">
            <div className="text-sm font-bold">미매칭 세금계산서 ({invoices.length})</div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {invLoading ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">불러오는 중...</div>
            ) : invoices.length === 0 ? (
              <div className="py-14 px-4 text-center">
                <div className="text-xs font-semibold text-[var(--text)]">미매칭 세금계산서 없음</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">모든 세금계산서가 매칭 완료된 상태입니다</div>
              </div>
            ) : (
              <ul className="three-way-invoice-list">
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <button
                      onClick={() => setSelectedInvoice(inv)}
                      className={`three-way-invoice-row ${selectedInvoice?.id === inv.id ? 'bg-[var(--primary)]/10' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${inv.type === 'sales' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-orange-500/15 text-orange-400'}`}>
                          {inv.type === 'sales' ? '매출' : '매입'}
                        </span>
                        <span className="text-xs font-semibold truncate flex-1">{inv.counterparty_name || '거래처 미상'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                        <span>{inv.issue_date || '—'}</span>
                        <span className="font-semibold text-[var(--text)] mono-number">₩{Number(inv.total_amount || 0).toLocaleString()}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 가운데 — 매칭 후보 */}
        <div className="three-way-candidates-panel glass-card">
          <div className="three-way-candidates-header">
            <div className="text-sm font-bold">매칭 후보 추천</div>
            {selectedInvoice ? (
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                {selectedInvoice.counterparty_name} · ₩{Number(selectedInvoice.total_amount || 0).toLocaleString()}
                {' · 공급가 '}₩{Number(selectedInvoice.supply_amount || 0).toLocaleString()}
              </div>
            ) : (
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">좌측에서 세금계산서를 선택하세요</div>
            )}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {!selectedInvoice ? (
              <div className="py-16 px-4 text-center">
                <div className="text-xs font-semibold text-[var(--text)]">좌측 미매칭 세금계산서를 클릭해 매칭 후보를 확인하세요</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">거래처명·대표자명·금액±10% 기준으로 자동 추천됩니다</div>
              </div>
            ) : candLoading ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">후보 분석 중...</div>
            ) : candidates.length === 0 ? (
              <div className="py-14 px-4 text-center">
                <div className="text-xs font-semibold text-[var(--text)]">매칭 후보 없음</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">거래처명·대표자명·금액±10% 모두 미충족</div>
              </div>
            ) : (
              <ul className="three-way-candidate-list">
                {candidates.map((c) => (
                  <li key={c.bankTxId}>
                    <button
                      onClick={() => matchMut.mutate({ bankTxId: c.bankTxId, invoiceId: selectedInvoice.id })}
                      disabled={matchMut.isPending}
                      className={`three-way-candidate-row ${c.score >= 3 ? 'bg-emerald-500/5' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-semibold truncate ${c.score >= 3 ? 'text-emerald-400' : ''}`}>
                            {c.bankCounterparty || '입금자 미상'}
                          </span>
                          {c.score >= 3 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">강력 추천</span>}
                        </div>
                        <span className="text-xs font-bold text-[var(--text)] shrink-0 mono-number">₩{c.bankAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="text-[10px] text-[var(--text-muted)] truncate">
                          {c.bankDate} {c.bankDescription ? `· ${c.bankDescription}` : ''}
                        </div>
                      </div>
                      <div className="three-way-candidate-reasons">
                        {c.reasons.map((r, i) => (
                          <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                            r.startsWith('거래처명') ? 'bg-blue-500/15 text-blue-400'
                            : r.startsWith('대표자명') ? 'bg-purple-500/15 text-purple-400'
                            : 'bg-amber-500/15 text-amber-400'
                          }`}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 우측 — 매칭됨 (확정된 결과) */}
        <div className="three-way-matched-panel glass-card">
          <div className="three-way-matched-header">
            <div>
              <div className="text-sm font-bold">매칭됨 ({matched.length})</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">행 클릭 → 연결 프로젝트 진입 · ✕ 로 해제</div>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {matchedLoading ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">불러오는 중...</div>
            ) : matched.length === 0 ? (
              <div className="py-14 px-4 text-center">
                <div className="text-3xl mb-2">🧾</div>
                <div className="text-xs font-semibold text-[var(--text)]">매칭된 항목 없음</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">가운데 후보를 클릭해 매칭을 확정하면 여기에 쌓입니다</div>
              </div>
            ) : (
              <ul className="three-way-matched-list">
                {matched.map((m) => {
                  const diff = Math.abs(m.invoiceTotal - m.bankAmount);
                  const hasDeal = !!m.dealId;
                  const enterProject = () => {
                    if (m.dealId) router.push(`/projects/${m.dealId}`);
                  };
                  return (
                    <li key={m.bankTxId}>
                      {/* 행 본체 — deal 연결 시 클릭하면 프로젝트 진입. 해제는 우측 ✕ 버튼 분리. */}
                      <div
                        onClick={hasDeal ? enterProject : undefined}
                        role={hasDeal ? "button" : undefined}
                        tabIndex={hasDeal ? 0 : undefined}
                        onKeyDown={hasDeal ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterProject(); } } : undefined}
                        className={`three-way-matched-row ${hasDeal ? 'cursor-pointer hover:bg-[var(--bg-surface)]' : ''}`}
                        title={hasDeal ? `클릭 시 '${m.dealName}' 프로젝트로 이동` : '연결된 프로젝트 없음'}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${m.invoiceType === 'sales' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-orange-500/15 text-orange-400'}`}>
                            {m.invoiceType === 'sales' ? '매출' : '매입'}
                          </span>
                          <span className="text-xs font-semibold truncate flex-1">{m.invoiceCounterparty || '거래처'}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-emerald-500/15 text-emerald-400 shrink-0">완료</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`이 매칭을 해제하시겠습니까?\n\n세금계산서: ${m.invoiceCounterparty || '거래처'} ₩${m.invoiceTotal.toLocaleString()}\n입출금: ${m.bankCounterparty} ₩${m.bankAmount.toLocaleString()}`)) {
                                unmatchMut.mutate({ bankTxId: m.bankTxId, invoiceId: m.invoiceId });
                              }
                            }}
                            disabled={unmatchMut.isPending}
                            className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50 shrink-0"
                            title="매칭 해제"
                          >
                            ✕ 해제
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-[var(--text-muted)]">계산서 {m.invoiceDate || '—'}</span>
                          <span className="text-[var(--text)] font-semibold mono-number">₩{m.invoiceTotal.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-[var(--text-muted)] truncate">입출금 {m.bankCounterparty} · {m.bankDate}</span>
                          <span className="text-[var(--text)] font-semibold mono-number">₩{m.bankAmount.toLocaleString()}</span>
                        </div>
                        {diff > 0 && (
                          <div className="text-[9px] text-amber-400 mb-1">차이 ₩{diff.toLocaleString()}</div>
                        )}
                        {hasDeal && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); enterProject(); }}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--primary)] hover:underline mt-0.5"
                            title={`'${m.dealName}' 프로젝트로 이동`}
                          >
                            {m.dealName} →
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

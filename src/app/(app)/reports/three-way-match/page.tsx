"use client";

// 3-Way 매칭 페이지 — (2026-05-21)
//   세금계산서(좌) ↔ 매칭 후보 입출금(우) 추천 리스트.
//   추천 규칙: 거래처명 / 대표자명 / 금액±10% — 하나라도 충족 시 노출.
//   기존 /tax-invoices·/matching 의 3-way 매칭 UI 는 본 페이지로 일원화.

import { appConfirm } from "@/components/global-confirm";
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
import { ReportHead } from "../_components/ReportHead";
import { ChipGroup, Stat, SelectionBar, type ExcelItem } from "@/components/query-kit";
import { exportToExcel } from "@/lib/excel-export";

export default function ThreeWayMatchPage() {
  const { role, loading } = useUser();
  if (loading) return <div className="p-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  if (role === "partner") {
    return <AccessDenied detail="3-Way 매칭은 회사 구성원 전용입니다 (외부 파트너 제외)." />;
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
  //   2026-10-06 결정 6: 후보 줄 클릭 = 고르기만, 확정은 아래 바의 버튼(확정은 사람 버튼 원칙). 계산서를 바꾸면 고른 후보도 비운다
  const [pickedTxId, setPickedTxId] = useState<string | null>(null);
  useEffect(() => { setPickedTxId(null); }, [selectedInvoice?.id]);

  // 회사 id — useState 초기화자에서 side effect(렌더 중 fetch, strict mode 2회) → useEffect 로 교정
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

  // 매칭 완료 목록 · 우측 패널
  const  { data: matched = [], isLoading: matchedLoading } = useQuery({
    queryKey: ["three-way-matched", companyId, typeFilter],
    queryFn: () => listMatchedInvoices(companyId!, typeFilter === 'all' ? undefined : { type: typeFilter }),
    enabled: !!companyId,
  });

  const pickedCand = candidates.find((c) => c.bankTxId === pickedTxId) ?? null;

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
      setPickedTxId(null);
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

  //   엑셀 — 화면의 두 목록(미매칭 · 매칭됨) 그대로. 지금 고른 유형(전체/매출/매입)만
  const kindLabel = (t: "sales" | "purchase") => (t === "sales" ? "매출" : "매입");
  const excel: ExcelItem[] = [
    { label: "미매칭 세금계산서", count: invoices.length, disabled: invoices.length === 0, onClick: () => exportToExcel(invoices.map((i) => ({
      "구분": kindLabel(i.type), "거래처": i.counterparty_name || "", "발행일": i.issue_date || "", "공급가액": Math.round(i.supply_amount), "합계금액": Math.round(i.total_amount),
    })), "미매칭", `3way_미매칭_${typeFilter}`) },
    { label: "매칭됨", count: matched.length, disabled: matched.length === 0, onClick: () => exportToExcel(matched.map((m) => ({
      "구분": kindLabel(m.invoiceType), "거래처": m.invoiceCounterparty || "", "계산서 일자": m.invoiceDate || "", "계산서 금액": Math.round(m.invoiceTotal),
      "입출금 상대": m.bankCounterparty, "입출금 일자": m.bankDate, "입출금 금액": Math.round(m.bankAmount), "차이": Math.round(Math.abs(m.invoiceTotal - m.bankAmount)), "프로젝트": m.dealName || "",
    })), "매칭됨", `3way_매칭됨_${typeFilter}`) },
  ];

  return (
    <div className="three-way-match-page">
      {/* 조회 줄(유형 보기 ‖ 엑셀·인쇄)·건수는 다른 회계 자료 탭과 같이 상자 머리에 — 예전 상자 밖 seg-bar 는 탭마다 자리가 달랐다 */}
      <ReportHead
        bar={<ChipGroup value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "전체" }, { value: "sales", label: "매출" }, { value: "purchase", label: "매입" }] as const} />}
        excel={excel}
        print
        stats={<>
          <Stat label="미매칭 세금계산서" value={`${invoices.length.toLocaleString()}건`} tone={invoices.length > 0 ? "minus" : undefined} />
          <Stat label="매칭됨" value={`${matched.length.toLocaleString()}건`} tone="plus" />
        </>}
      />

      {/*   2026-10-01 UI 점검 9순위: glass-card 판 3 → 분석 판, 직접 색(emerald·orange·blue·purple·amber·red) → 상태 칩·토큰, 이모지 빈 상태 → 글.
          2026-10-06 결정 6(사장님 추천안 승인): 후보 줄 클릭 = 고르기, 확정은 SelectionBar 의 파란 버튼 하나. */}
      <div className="three-way-grid">
        {/* 좌측 — 미매칭 세금계산서 */}
        <div className="three-way-unmatched-panel pnl-panel">
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
                      className={`three-way-invoice-row ${selectedInvoice?.id === inv.id ? 'three-way-row-on' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="ol-sure">
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
        <div className="three-way-candidates-panel pnl-panel">
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
                      onClick={() => setPickedTxId((p) => (p === c.bankTxId ? null : c.bankTxId))}
                      disabled={matchMut.isPending}
                      aria-pressed={pickedTxId === c.bankTxId}
                      className={`three-way-candidate-row ${pickedTxId === c.bankTxId ? 'three-way-row-on' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            {c.bankCounterparty || '입금자 미상'}
                          </span>
                          {c.score >= 3 && <span className="ol-sure ol-sure-ok">강력 추천</span>}
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
                          <span key={i} className="ol-sure">
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
        <div className="three-way-matched-panel pnl-panel">
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
                <div className="text-xs font-semibold text-[var(--text)]">매칭된 항목 없음</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">가운데 후보를 골라 「매칭 확정」을 누르면 여기에 쌓입니다</div>
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
                          <span className="ol-sure">
                            {m.invoiceType === 'sales' ? '매출' : '매입'}
                          </span>
                          <span className="text-xs font-semibold truncate flex-1">{m.invoiceCounterparty || '거래처'}</span>
                          <span className="ol-sure ol-sure-ok shrink-0">완료</span>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (await appConfirm(`이 매칭을 해제하시겠습니까?\n\n세금계산서: ${m.invoiceCounterparty || '거래처'} ₩${m.invoiceTotal.toLocaleString()}\n입출금: ${m.bankCounterparty} ₩${m.bankAmount.toLocaleString()}`, { confirmLabel: "매칭 해제" })) {
                                unmatchMut.mutate({ bankTxId: m.bankTxId, invoiceId: m.invoiceId });
                              }
                            }}
                            disabled={unmatchMut.isPending}
                            className="btn-secondary btn-sm shrink-0"
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
                          <div className="text-[10px] text-[var(--warning)] mb-1">차이 ₩{diff.toLocaleString()}</div>
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

      {selectedInvoice && pickedCand && (
        <SelectionBar
          count={1}
          summary={`${selectedInvoice.counterparty_name || '거래처 미상'} ₩${Number(selectedInvoice.total_amount || 0).toLocaleString()} ↔ ${pickedCand.bankCounterparty || '입금자 미상'} ${pickedCand.bankDate} ₩${pickedCand.bankAmount.toLocaleString()}`}
          onClear={() => setPickedTxId(null)}
        >
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={matchMut.isPending}
            onClick={() => matchMut.mutate({ bankTxId: pickedCand.bankTxId, invoiceId: selectedInvoice.id })}
          >
            {matchMut.isPending ? "확정 중…" : "매칭 확정"}
          </button>
        </SelectionBar>
      )}
    </div>
  );
}

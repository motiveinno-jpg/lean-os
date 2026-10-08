"use client";

// ── 월 마감 판 — 재무 › 전표 현황 › 처리할 것 (2026-10-08 결산 진입로 점검) ──
//
//   History: 마감 체크리스트는 마스터 화면 위젯에만 있었고, 위젯은 늘 '오늘이 속한 달'만 열었다.
//            마감은 다음 달 초에 하는 일이라 달이 바뀌면 지난달은 다시 열 수 없었다 → 운영 체크리스트 12건 전부 open, 확정본 0건.
//   결정: 결산 초안 만들기와 같은 달(기본 지난달)을 받아, 초안 → 확정 → 점검 → 마감 완료 → 잠금을 한 탭에서 끝낸다.
//         쓰기(시작·체크·완료·잠금·해제)는 마스터 | 회계마감 권한자만(DB 20261008100000 이 같은 기준으로 막는다).
//         잠그기 전 그 달에 확정 안 된 전표가 있으면 알린다 — 막지는 않는다(반려할 초안도 있고, 판단은 사람 몫).
//   버린 안: 마스터 위젯에 달 선택만 붙이기 — 초안 확정은 전표 현황에 있어 두 화면을 오가야 했다.

import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { appConfirm } from "@/components/global-confirm";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { getFinancialDashboardData } from "@/lib/queries";
import { buildFinancialDashboard as buildFinDash } from "@/lib/engines";
import { generateMonthlyPLReport } from "@/lib/pdf-report";
import { getChecklist, getOrCreateChecklist, toggleChecklistItem, completeClosingChecklist, lockClosingMonth, unlockClosingMonth, autoVerifyChecklist, attachReportUrl } from "@/lib/closing";
import { monthEnd } from "@/lib/closing-snapshot";

// 항목별 처리 화면 바로가기 — closing.ts DEFAULT_ITEMS 의 제목 키워드로 매칭(제목이 바뀌어도 부분일치로 살아남게)
const ITEM_LINKS: { match: RegExp; href: string; label: string }[] = [
  { match: /은행 거래내역/, href: "/bank", label: "통장 보기" },
  { match: /법인카드/, href: "/cards", label: "카드 보기" },
  { match: /미매핑|분류/, href: "/collect?tab=bank", label: "통장 전표" },
  { match: /세금계산서/, href: "/tax-invoices", label: "계산서 대사" },
  { match: /미수금|미지급금/, href: "/partners/ledger", label: "원장 보기" },
  { match: /고정비/, href: "/payments", label: "정기 지출" },
  { match: /프로젝트/, href: "/projecthub", label: "프로젝트" },
  { match: /부가세/, href: "/tax-invoices?tab=vat", label: "부가세" },
  { match: /증빙/, href: "/collect", label: "수집·전표" },
  { match: /손익 리포트/, href: "/reports/pnl", label: "손익 보기" },
];
const itemLink = (title: string) => ITEM_LINKS.find((l) => l.match.test(title)) || null;

type Item = { id: string; title: string; description: string | null; is_required: boolean; is_completed: boolean; auto_verified: boolean | null; verified_reason: string | null };

/** 월 마감 PDF — 마스터 위젯에 있던 생성 로직 그대로 */
async function makeMonthlyReport(companyId: string, month: string, checklistId: string) {
  const finRaw = await getFinancialDashboardData(companyId);
  const finData = buildFinDash(
    (finRaw.allMonths as any[]).map((m: any) => ({
      month: m.month,
      revenue: Number(m.revenue || 0),
      totalIncome: Number(m.totalIncome || m.revenue || 0),
      totalExpense: Number(m.totalExpense || m.expense || 0),
    })),
    (finRaw.deals as any[]).map((d: any) => ({
      classification: d.classification || "미분류",
      contractTotal: Number(d.contractTotal || 0),
      revenue: Number(d.revenue || 0),
      cost: Number(d.cost || 0),
    })),
    finRaw.classificationColors || {},
  );
  const { publicUrl } = await generateMonthlyPLReport({
    month, companyName: "",
    revenue: finData.totalRevenue,
    expense: finData.totalExpense,
    netIncome: finData.netIncome,
    items: (finRaw.items || []).filter((i: any) => i.month === month).map((i: any) => ({
      name: i.name || "-",
      category: i.category || "expense",
      amount: Number(i.amount || 0),
      counterparty: i.project_name || undefined,
    })),
    bankBalance: 0, fixedCost: 0, runwayMonths: 999,
    dealBreakdown: finData.classificationBreakdown.map((cb) => ({
      dealName: cb.classification, classification: cb.classification,
      revenue: cb.totalRevenue, cost: cb.totalCost,
      margin: cb.totalRevenue > 0 ? cb.avgMargin : 0,
    })),
  }, { upload: true, companyId, download: true });
  if (publicUrl) await attachReportUrl(checklistId, publicUrl);
  return publicUrl;
}

export function ClosingMonthPanel({ companyId, userId, month, canClose }: { companyId: string; userId: string | null; month: string; canClose: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mLabel = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;

  const { data: checklist, isLoading } = useQuery({
    queryKey: ["closing-checklist", companyId, month],
    queryFn: () => getChecklist(companyId, month),
  });
  //   그 달에 확정 안 된 전표(결산 초안·생산 초안 포함) — 잠그기 전 알림용
  const { data: pendingN = 0 } = useQuery({
    queryKey: ["closing-pending-entries", companyId, month],
    queryFn: async () => {
      const { count } = await (supabase as any).from("journal_entries").select("id", { count: "exact", head: true })
        .eq("company_id", companyId).gte("entry_date", `${month}-01`).lte("entry_date", monthEnd(month))
        .not("status", "in", "(confirmed,rejected)");
      return count || 0;
    },
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["closing-checklist"] }); qc.invalidateQueries({ queryKey: ["closing-snapshots"] }); };
  const onErr = (e: unknown) => toast(friendlyError(e), "error");
  const need = () => { if (!userId) throw new Error("로그인 정보를 확인할 수 없습니다"); return userId; };

  const startMut = useMutation({
    mutationFn: async () => {
      const cl = await getOrCreateChecklist(companyId, month);
      return autoVerifyChecklist(companyId, cl.id, month);
    },
    onSuccess: (o) => { toast(`${mLabel} 마감 점검을 시작했습니다 · 자동 확인 ${o.filter((x) => x.passed).length}/${o.length} 통과`, "success"); refresh(); },
    onError: onErr,
  });
  const toggleMut = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => toggleChecklistItem(itemId, need(), completed),
    onSuccess: refresh, onError: onErr,
  });
  const verifyMut = useMutation({
    mutationFn: () => autoVerifyChecklist(companyId, checklist!.id, month),
    onSuccess: (o) => { toast(`자동 확인 ${o.filter((x) => x.passed).length}/${o.length} 항목 통과`, "success"); refresh(); },
    onError: onErr,
  });
  const reportMut = useMutation({
    mutationFn: () => makeMonthlyReport(companyId, month, checklist!.id),
    onSuccess: (url) => { toast(url ? "손익 리포트 PDF 를 내려받고 보관했습니다" : "PDF 를 내려받았지만 보관은 실패했습니다", url ? "success" : "info"); refresh(); },
    onError: onErr,
  });
  const completeMut = useMutation({ mutationFn: () => completeClosingChecklist(checklist!.id, need()), onSuccess: () => { toast(`${mLabel} 마감을 완료했습니다. 잠그면 확정본이 남습니다`, "success"); refresh(); }, onError: onErr });
  const lockMut = useMutation({ mutationFn: () => lockClosingMonth(checklist!.id, need()), onSuccess: () => { toast(`${mLabel}을 잠갔습니다 · 재무상태표·손익계산서 확정본이 남았습니다`, "success"); refresh(); }, onError: onErr });
  const unlockMut = useMutation({ mutationFn: () => unlockClosingMonth(checklist!.id, need()), onSuccess: () => { toast(`${mLabel} 잠금을 풀었습니다`, "success"); refresh(); }, onError: onErr });
  const busy = startMut.isPending || toggleMut.isPending || verifyMut.isPending || reportMut.isPending || completeMut.isPending || lockMut.isPending || unlockMut.isPending;

  const askLock = async () => {
    const msg = (pendingN ? `${mLabel}에 확정하지 않은 전표가 ${pendingN}건 있습니다. 잠그면 확정·반려도 막히고, 확정본에는 확정 전표만 들어갑니다.\n\n` : "")
      + `${mLabel}을 잠글까요? 그 달 전표 입력·수정이 막히고, 지금 숫자로 재무상태표·손익계산서 확정본이 남습니다.`;
    if (await appConfirm(msg, { title: "월 마감 잠금", confirmLabel: "잠그기" })) lockMut.mutate();
  };
  const askUnlock = async () => {
    if (await appConfirm(`${mLabel} 잠금을 풀까요? 전표를 다시 고칠 수 있게 됩니다. 확정본은 다시 잠글 때 새로 남습니다.`, { title: "잠금 해제", confirmLabel: "잠금 해제" })) unlockMut.mutate();
  };

  const items = ((checklist?.items || []) as Item[]);
  const done = items.filter((i) => i.is_completed).length;
  const reqTotal = items.filter((i) => i.is_required).length;
  const reqDone = items.filter((i) => i.is_required && i.is_completed).length;
  const status = checklist?.status as string | undefined;
  const editable = canClose && status === "open";
  const reportUrl = (checklist as any)?.report_url as string | null | undefined;
  const statusText = !checklist ? "시작 전" : status === "locked" ? "잠금" : status === "completed" ? "마감 완료" : "진행 중";

  return (
    <div className="pnl-panel">
      <div className="cm-head">
        <div>
          <h3>{mLabel} 마감 <span className="cm-status">{statusText}{checklist ? ` · ${done}/${items.length}` : ""}</span></h3>
          <p title="달은 위 '결산 초안 만들기'의 달을 따릅니다">초안 확정 → 항목 점검 → 마감 완료 → 잠금 순서입니다. 잠그면 그 달 전표가 막히고 재무제표 확정본이 남습니다.</p>
        </div>
        {canClose && checklist && (
          <div className="cm-actions">
            {status === "open" && <>
              <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => verifyMut.mutate()}>{verifyMut.isPending ? "확인 중…" : "자동 확인"}</button>
              <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => reportMut.mutate()} title="그 달 손익 리포트 PDF 를 내려받고 마감 자료로 보관합니다">{reportMut.isPending ? "만드는 중…" : "리포트 PDF"}</button>
              <button type="button" className="btn-secondary btn-sm" disabled={busy || reqDone < reqTotal} onClick={() => completeMut.mutate()} title={reqDone < reqTotal ? `필수 항목 ${reqTotal - reqDone}개가 남았습니다` : "필수 항목이 모두 끝났습니다"}>{completeMut.isPending ? "처리 중…" : `마감 완료 (필수 ${reqDone}/${reqTotal})`}</button>
            </>}
            {status === "completed" && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={askLock}>{lockMut.isPending ? "잠그는 중…" : "마감 잠금"}</button>}
            {status === "locked" && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={askUnlock}>{unlockMut.isPending ? "푸는 중…" : "잠금 해제"}</button>}
          </div>
        )}
      </div>

      {pendingN > 0 && status !== "locked" && (
        <p className="cm-warn">이 달에 확정하지 않은 전표가 <b>{pendingN}건</b> 있습니다. 아래 「반려 · 대기 · 미승인 전표」에서 확정하거나 반려하세요.</p>
      )}
      {reportUrl && <p className="cm-note"><a href={reportUrl} target="_blank" rel="noopener noreferrer" className="bz-link">보관된 {mLabel} 손익 리포트 PDF</a></p>}

      {isLoading ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : !checklist ? (
        <div className="collect-empty">
          {mLabel} 마감을 아직 시작하지 않았습니다.
          {canClose
            ? <div className="cm-empty-act"><button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => startMut.mutate()}>{startMut.isPending ? "시작하는 중…" : "마감 점검 시작"}</button></div>
            : <div className="cm-empty-sub">마감은 마스터나 회계마감 권한자가 진행합니다.</div>}
        </div>
      ) : (
        <div className="stg-table-wrap">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th>완료</th><th>항목</th><th>확인 결과</th><th></th></tr></thead>
            <tbody>{items.map((it) => {
              const link = itemLink(it.title || "");
              return (
                <tr key={it.id}>
                  <td className="tc"><input type="checkbox" checked={it.is_completed} disabled={!editable || busy} aria-label={it.title}
                    onChange={(e) => toggleMut.mutate({ itemId: it.id, completed: e.target.checked })} /></td>
                  <td className="text-left"><b>{it.title}</b>{it.is_required && <span className="cm-req" title="필수 항목">필수</span>}{it.auto_verified && <span className="ev-dim"> · 자동 확인</span>}
                    {it.description && <div className="ev-dim">{it.description}</div>}</td>
                  <td className={`text-left ${it.verified_reason && !it.is_completed ? "aging-b3" : "ev-dim"}`}>{it.verified_reason || "—"}</td>
                  <td className="tc">{link && <Link href={link.href} className="bz-link">{link.label}</Link>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";
import { kstDateStr } from "@/lib/kst";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ConditionPanel, ConditionRow, TokenField, ChipGroup, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, Stat, RowsPerPage, Pager, usePager, SelectionBar, type TokenItem, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { CONTRACT_TYPES } from "@/lib/hr";
import { getContractPackages, sendContractPackage, cancelContractPackage, cancelSentContractPackage, closeExpiredContractPackage, PACKAGE_STATUS } from "@/lib/hr-contracts";
import { sealAsDataUrl } from "@/lib/signatures";


// ── 계약서/서약서 템플릿 편집 + 회사 문서 + 발송 현황 · 구성원 상세패널의 "+ 계약서 보내기"로
//   개별 발송이 이관된 뒤, 회사 전체 관점(서식 관리·회사 문서·발송 현황/일괄발송)만 여기 남음.
//   (2026-07-15 employees/_components/ContractTab.tsx 에서 이관)
type CaCond =  { emp: string[]; dept: string[]; cFrom: string; cTo: string; sFrom: string; sTo: string; rows: number };
const CA_EMPTY: CaCond = { emp: [], dept: [], cFrom: "", cTo: "", sFrom: "", sTo: "", rows: 50 };
const caCount = (c: CaCond) => c.emp.length + c.dept.length + ((c.cFrom || c.cTo) ? 1 : 0) + ((c.sFrom || c.sTo) ? 1 : 0);
type CaSort = "title" | "emp" | "dept" | "status" | "created" | "sent" | "completed";
const STATUS_CHIPS = [
  { value: "all", label: "전체" }, { value: "draft", label: "임시저장" }, { value: "sent", label: "진행 중" },
  { value: "completed", label: "완료" }, { value: "cancelled", label: "취소" },
] as const;

export function ContractAdminPanel({ companyId, contracts, tabs }: { companyId: string; contracts: any[]; tabs?: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);
  const [sealApplying, setSealApplying] = useState<string | null>(null);
  // 회사 문서 서브탭 제거(2026-07-23). 발송/현황만 남아 항상 contracts.
  const [contractSubTab] = useState<"contracts">("contracts");
  // 계약 내역
  const { data: contractList = [], isPending: listPending, isError: listError } = useQuery({
    queryKey: ["contract-packages", companyId],
    queryFn: () => getContractPackages(companyId!),
    enabled: !!companyId,
  });

  // 서명 요청 발송/재발송
  async function handleSendSignRequest(contractId: string) {
    setSending(contractId);
    try {
      const result = await sendContractPackage(contractId);
      if (!result.success) {
        const msg = result.error || "알 수 없는 오류";
        console.error('[handleSendSignRequest] 실패:', msg);
        if (/RESEND_API_KEY/i.test(msg)) {
          toast("Supabase secrets 에 RESEND_API_KEY 미등록 · Edge Function Secrets 페이지에서 등록하세요.", "error");
        } else if (/verify|verif|domain|not\s*verified/i.test(msg)) {
          toast("Resend 도메인 인증 필요. owner-view.com 을 Resend dashboard 에서 verify 후 재시도.", "error");
        } else if (/invalid.*api.*key|unauthor/i.test(msg)) {
          toast("Resend API 키 오류 · Supabase secrets 의 RESEND_API_KEY 값 확인 필요.", "error");
        } else {
          toast("발송 실패: " + msg.slice(0, 200), "error");
        }
      } else {
        const channels: string[] = [];
        if ((result as any).inAppDelivered) channels.push("OwnerView 알림");
        if ((result as any).emailSent) channels.push("이메일");
        toast(channels.length > 0 ? `서명 요청 발송 완료 (${channels.join(" + ")})` : "서명 요청 발송 완료", "success");
      }
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    } catch (err: any) {
      console.error('[handleSendSignRequest] catch:', err);
      toast("발송 실패: " + (friendlyError(err, "오류")).slice(0, 200), "error");
    } finally {
      setSending(null);
    }
  }

  // 계약 취소
  const cancelContract = useMutation({
    mutationFn: cancelContractPackage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contract-packages"] }),
    onError: (err: any) => toast("계약 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });
  //   발송된 건의 취소 (2026-09-28) — 기한 안이면 '열람 전 발송 취소'(cancelSent), 기한이 지났으면 '만료 정리'(closeExpired).
  //   전에는 발송 상태 줄에 재발송만 있어, 모티브 만료 6건(5건은 문서 0건)이 처리할 것에 136일째 남아 있었다.
  const isExpired = (p: any) => !!p.expires_at && new Date(p.expires_at).getTime() < Date.now();
  const docCount = (p: any) => (Array.isArray(p.hr_contract_package_items) ? p.hr_contract_package_items.length : null);
  const daysPast = (v: string) => Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
  async function handleCancelSent(p: any) {
    const expired = isExpired(p);
    const ok = await appConfirm(
      expired
        ? `서명 기한(${day(p.expires_at)})이 지난 계약입니다. 취소로 정리할까요?\n서명 링크가 무효가 되고, 다시 보내려면 새 패키지를 만듭니다.`
        : "발송을 취소할까요? 직원이 아직 열람하지 않은 경우에만 됩니다.\n서명 링크가 무효가 되고 알림도 회수됩니다.",
      { danger: true, confirmLabel: expired ? "정리(취소)" : "발송 취소" },
    );
    if (!ok) return;
    const r = expired ? await closeExpiredContractPackage(p.id) : await cancelSentContractPackage(p.id);
    if (!r.success) { toast(r.error || "취소하지 못했습니다", "error"); return; }
    toast(expired ? "기한 지난 계약을 정리했습니다" : "발송을 취소했습니다", "success");
    queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    queryClient.invalidateQueries({ queryKey: ["hr-todos"] });
  }

  // 일괄 발송
  async function handleBatchSend() {
    const draftIds = Array.from(selectedIds).filter(id =>
      contractList.find((c: any) => c.id === id && c.status === "draft")
    );
    if (draftIds.length === 0) return;
    setBatchSending(true);
    //   ⚠️ sendContractPackage 는 전달 실패 시 던지지 않고 { success:false } 를 돌려준다 —
    //   예전엔 catch 만 두고 반환값을 안 봐서, 10건 골라 10건 다 실패해도 화면은 조용히
    //   새로고침만 됐다. 성공·실패를 세어 알린다.
    let ok = 0;
    const failed: string[] = [];
    for (const id of draftIds) {
      try {
        const r = await sendContractPackage(id);
        if (r && (r as { success?: boolean }).success === false) failed.push((r as { error?: string }).error || "발송 실패");
        else ok += 1;
      } catch (e: any) { failed.push(e?.message || "발송 실패"); }
    }
    queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    setSelectedIds(new Set());
    setBatchSending(false);
    if (failed.length === 0) toast(`${ok}건을 보냈습니다`, "success");
    else if (ok === 0) toast(`${failed.length}건 모두 보내지 못했습니다 · ${failed[0]}`, "error");
    else toast(`${ok}건 보냄 · ${failed.length}건 실패 · ${failed[0]}`, "error");
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  

  // 직인 적용 핸들러 · 패키지 단위로 적용 (notes JSON 에 seal_applied 표시 + 회사 seal_url 스냅샷)
  async function handleApplySeal(contractId: string)  {
    if (!companyId) return;
    setSealApplying(contractId);
    try {
      const company = logRead('_components/ContractAdminPanel:company', await supabase
        .from("companies").select("seal_url, name").eq("id", companyId).maybeSingle());
      if (!company?.seal_url) {
        toast("직인 이미지가 등록돼 있지 않습니다. 회사 설정에서 먼저 등록하세요.", "error");
        setSealApplying(null);
        return;
      }
      const pkg = logRead('_components/ContractAdminPanel:pkg', await supabase
        .from("hr_contract_packages").select("notes").eq("id", contractId).maybeSingle());
      let notesObj: Record<string, any> = {};
      if (pkg?.notes) {
        try {
          const parsed = JSON.parse(pkg.notes);
          if (typeof parsed === 'object' && parsed && !Array.isArray(parsed)) notesObj = parsed;
        } catch { /* keep empty */ }
      }
      
      notesObj.seal_applied_at = new Date().toISOString();
      // 서명 화면(비로그인)이 그대로 보여 주는 값 · 저장소 주소 대신 이미지 자체를 넣는다
      notesObj.seal_url = (await sealAsDataUrl(company.seal_url)) || company.seal_url;
      notesObj.seal_company_name = company.name || '';
      const  { error: sealErr } = await supabase
        .from("hr_contract_packages")
        .update({ notes: JSON.stringify(notesObj) })
        .eq("id", contractId);
      if (sealErr) throw sealErr;   // 미검사 시 실패해도 "직인 적용됨" · 실제 PDF엔 직인 없음 (2026-08-19)
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
      toast("직인이 적용되었습니다 (서명본/PDF에 반영됨)", "success");
    } catch (err: any) {
      toast("직인 적용 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally {
      setSealApplying(null);
    }
  }

  

  // ── 조회 표준(2026-08-18 Wave 4). 상태 칩 + 검색조건(직원·부서·생성일·발송일) + 빠른검색 + 머리단 정렬·≡·너비 + 쪽 ──
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<CaCond>(CA_EMPTY);
  const [live, setLive] = useState<CaCond>(CA_EMPTY);
  const setD = <K extends keyof CaCond>(k: K) => (v: CaCond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  const [sort, setSort] = useState<SortState<CaSort>>({ key: "created", dir: "desc" });
  const onSort = (k: CaSort) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("hr-contract-packages-colw-v1", {
    title: 260, emp: 100, dept: 110, status: 110, created: 110, sent: 110, completed: 110, action: 220,
  });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const day = (v: any) => (v ? kstDateStr(new Date(v)) : "");
  const stLabel = (c: any) => (PACKAGE_STATUS[c.status as keyof typeof PACKAGE_STATUS] || PACKAGE_STATUS.draft).label;
  const statusHit = (c: any) => statusFilter === "all" || (statusFilter === "sent" ? (c.status === "sent" || c.status === "partially_signed") : c.status === statusFilter);
  const condHit = (c: any, k: CaCond) => {
    if (k.emp.length && !k.emp.includes(c.employees?.name || "")) return false;
    if (k.dept.length && !k.dept.includes(c.employees?.department || "")) return false;
    const cd = day(c.created_at), sd = day(c.sent_at);
    if (k.cFrom && cd < k.cFrom) return false;
    if (k.cTo && cd > k.cTo) return false;
    if ((k.sFrom || k.sTo) && !sd) return false;
    if (k.sFrom && sd < k.sFrom) return false;
    if (k.sTo && sd > k.sTo) return false;
    return true;
  };
  const colVal = (c: any) => ({ emp: c.employees?.name || "미지정", dept: c.employees?.department || "—", status: stLabel(c) });
  const empOpts: TokenItem[] = useMemo(() => [...new Set((contractList as any[]).map((c) => c.employees?.name).filter(Boolean))].map((v) => ({ value: v as string, label: v as string })), [contractList]);
  const deptOpts: TokenItem[] = useMemo(() => [...new Set((contractList as any[]).map((c) => c.employees?.department).filter(Boolean))].map((v) => ({ value: v as string, label: v as string })), [contractList]);
  const base = useMemo(() => (contractList as any[]).filter((c) => statusHit(c) && condHit(c, live)
    && quickSearchHit(q, [c.title, c.employees?.name, c.employees?.department, stLabel(c)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contractList, statusFilter, live, q]);
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, base.map((c) => colVal(c)[k]));
  const filteredContracts = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (c: any): string => {
      switch (sort.key) {
        case "title": return c.title || "";
        case "emp": return c.employees?.name || "";
        case "dept": return c.employees?.department || "";
        case "status": return stLabel(c);
        case "sent": return c.sent_at || "";
        case "completed": return c.completed_at || "";
        default: return c.created_at || "";
      }
    };
    return base.filter((c) => cf.hit(colVal(c))).sort((a, b) => cmp(val(a), val(b)) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, sort, cf.key]);
  const previewCount = (contractList as any[]).filter((c) => statusHit(c) && condHit(c, draft)).length;
  const pager = usePager(filteredContracts, live.rows, `${statusFilter}|${q}|${JSON.stringify(live)}|${cf.key}`);
  const drop = (patch: Partial<CaCond>) => { const n = { ...live, ...patch }; setLive(n); setDraft(n); };
  const clearAll = () => { setLive(CA_EMPTY); setDraft(CA_EMPTY); setQ(""); cf.clear(); setStatusFilter("all"); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.emp.map((v) => ({ group: "직원", label: v, onRemove: () => drop({ emp: live.emp.filter((x) => x !== v) }) })),
    ...live.dept.map((v) => ({ group: "부서", label: v, onRemove: () => drop({ dept: live.dept.filter((x) => x !== v) }) })),
    ...((live.cFrom || live.cTo) ? [{ group: "생성일", label: `${live.cFrom || "처음"} ~ ${live.cTo || "오늘"}`, onRemove: () => drop({ cFrom: "", cTo: "" }) }] : []),
    ...((live.sFrom || live.sTo) ? [{ group: "발송일", label: `${live.sFrom || "처음"} ~ ${live.sTo || "오늘"}`, onRemove: () => drop({ sFrom: "", sTo: "" }) }] : []),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${({ emp: "구성원", dept: "부서", status: "상태" } as Record<string, string>)[a.k] || a.k} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];
  const draftRows = filteredContracts.filter((c: any) => c.status === "draft");

  // 상태별 카운트
  const statusCounts = {
    all: contractList.length,
    draft: contractList.filter((c: any) => c.status === "draft").length,
    sent: contractList.filter((c: any) => c.status === "sent" || c.status === "partially_signed").length,
    completed: contractList.filter((c: any) => c.status === "completed").length,
    cancelled: contractList.filter((c: any) => c.status === "cancelled").length,
  };

  return (
    <QueryScreen>
      <QueryHead>
        {tabs}
        <QueryBar>
          <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={caCount(live)}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={caCount(draft) === 0}
                onClick={() => setDraft({ ...CA_EMPTY, rows: draft.rows })}>조건 지우기</button>
              <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}건</span>
              <RowsPerPage value={draft.rows} onChange={setD("rows")} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="직원" hint="여러 명">
              <TokenField items={empOpts} value={draft.emp} onChange={setD("emp")} placeholder="이름 일부" />
            </ConditionRow>
            <ConditionRow label="부서" hint="여러 개">
              <TokenField items={deptOpts} value={draft.dept} onChange={setD("dept")} placeholder="부서 이름 일부" />
            </ConditionRow>
            <ConditionRow label="생성일" hint="비우면 전체">
              <DateRangeField label={null} from={draft.cFrom} to={draft.cTo} onChange={(f, t) => setDraft((c) => ({ ...c, cFrom: f, cTo: t }))} onClear={() => setDraft((c) => ({ ...c, cFrom: "", cTo: "" }))} />
            </ConditionRow>
            <ConditionRow label="발송일" hint="발송된 것만 걸린다">
              <DateRangeField label={null} from={draft.sFrom} to={draft.sTo} onChange={(f, t) => setDraft((c) => ({ ...c, sFrom: f, sTo: t }))} onClear={() => setDraft((c) => ({ ...c, sFrom: "", sTo: "" }))} />
            </ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="계약 제목 · 직원 · 부서 · 상태 · 쉼표로 여러 개, Enter" />
          {/* 상태 칩 — 갈래를 바로 바꾸는 값 하나짜리라 조회 줄에 둔다 */}
          <ChipGroup value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelectedIds(new Set()); }}
            options={STATUS_CHIPS.map((c) => ({ value: c.value as string, label: (statusCounts as any)[c.value] > 0 ? `${c.label} ${(statusCounts as any)[c.value]}` : c.label }))} />
        </QueryBar>
        <AppliedChips chips={chips} onClearAll={clearAll} />
        <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{filteredContracts.length}</b>건</span>}>
          <Stat label="전체" value={`${statusCounts.all}건`} />
          <Stat label="임시저장" value={`${statusCounts.draft}건`} tone={statusCounts.draft > 0 ? "minus" : undefined} />
          <Stat label="진행 중" value={`${statusCounts.sent}건`} />
          <Stat label="완료" value={`${statusCounts.completed}건`} tone="plus" />
          <Stat label="취소" value={`${statusCounts.cancelled}건`} />
        </ResultStrip>
      </QueryHead>

      <QueryBody>
      <div className="ev-scroll ca-scroll">
      {/* 회사 문서(법인 서류)는 회사 설정 › 회사정보 › 회사 문서로 이관(2026-07-23). 여기선 발송/현황만. */}
      {contractSubTab === "contracts" && <>
      {/* 계약 내역 — 표 하나. 임시저장 줄만 고를 수 있고(발송 대상), 일괄 발송은 바닥 선택 바의 파란 버튼 */}
      {/*   불러오는 중·실패를 '계약 내역 없음'과 구별(2026-09-30) */}
      {listError ? (
        <div className="collect-empty">계약 내역을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</div>
      ) : listPending ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : filteredContracts.length === 0 ? (
        <div className="collect-empty">
          {contractList.length === 0
            ? <>아직 계약 내역이 없습니다. 구성원 상세에서 계약서를 발송해 보세요.</>
            : <>조건에 맞는 계약이 없습니다. 검색조건을 풀어 보세요.</>}
        </div>
      ) : (
        <table ref={tableRef} className="ev-table ev-lined ev-cols-fixed ca-table">
          <thead>
            <tr>
              <th className="w-10">
                {draftRows.length > 0 && (
                  <button type="button" aria-label="이 쪽 임시저장 전체 선택"
                    onClick={() => {
                      const ids = (pager.view as any[]).filter((c) => c.status === "draft").map((c) => c.id);
                      const all = ids.length > 0 && ids.every((id) => selectedIds.has(id));
                      const next = new Set(selectedIds);
                      if (all) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id));
                      setSelectedIds(next);
                    }}
                    className={(pager.view as any[]).some((c) => c.status === "draft") && (pager.view as any[]).filter((c) => c.status === "draft").every((c) => selectedIds.has(c.id)) ? "collect-chk collect-chk-on" : "collect-chk"}>
                    {(pager.view as any[]).some((c) => c.status === "draft") && (pager.view as any[]).filter((c) => c.status === "draft").every((c) => selectedIds.has(c.id)) ? "✓" : ""}
                  </button>
                )}
              </th>
              <SortableTh label="계약" sortKey="title" sort={sort} onSort={onSort} resize={thResize("title", 2)} />
              <SortableTh label="구성원" sortKey="emp" sort={sort} onSort={onSort} filter={cfSpec("emp")} resize={thResize("emp", 3)} />
              <SortableTh label="부서" sortKey="dept" sort={sort} onSort={onSort} filter={cfSpec("dept")} resize={thResize("dept", 4)} />
              <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} filter={cfSpec("status")} resize={thResize("status", 5)} />
              <SortableTh label="생성" sortKey="created" sort={sort} onSort={onSort} resize={thResize("created", 6)} />
              <SortableTh label="발송" sortKey="sent" sort={sort} onSort={onSort} resize={thResize("sent", 7)} />
              <SortableTh label="완료" sortKey="completed" sort={sort} onSort={onSort} resize={thResize("completed", 8)} />
              <SortableTh label="액션" resize={thResize("action", 9)} />
            </tr>
          </thead>
          <tbody>
          {(pager.view as any[]).map((p: any) => {
            const st = PACKAGE_STATUS[p.status as keyof typeof PACKAGE_STATUS] || PACKAGE_STATUS.draft;
            return (
              <tr key={p.id} className={selectedIds.has(p.id) ? "ca-row ca-row-on" : "ca-row"}>
                <td className="text-center">
                  {p.status === "draft" && (
                    <button type="button" aria-label="선택" onClick={() => toggleSelect(p.id)}
                      className={selectedIds.has(p.id) ? "collect-chk collect-chk-on" : "collect-chk"}>{selectedIds.has(p.id) ? "✓" : ""}</button>
                  )}
                </td>
                <td className="text-left font-semibold truncate" title={p.title}>{p.title}</td>
                <td className="text-center">{p.employees?.name || "미지정"}</td>
                <td className="text-center">{p.employees?.department || "—"}</td>
                <td className="text-center">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span>
                  {/* 만료·빈 패키지 표시 (2026-09-28) — 발송 상태 뒤에 왜 처리해야 하는지를 적는다 */}
                  {(p.status === "sent" || p.status === "partially_signed") && isExpired(p) && <em className="ca-flag ca-flag-warn" title={`서명 기한 ${day(p.expires_at)} · 14일`}>기한 {daysPast(p.expires_at)}일 지남</em>}
                  {(p.status === "sent" || p.status === "partially_signed") && docCount(p) === 0 && <em className="ca-flag" title="문서가 하나도 없이 발송된 패키지 · 서명할 것이 없습니다">문서 0건</em>}
                </td>
                <td className="text-center mono-number">{day(p.created_at) || "—"}</td>
                <td className="text-center mono-number">{day(p.sent_at) || "—"}</td>
                <td className="text-center mono-number">{day(p.completed_at) || "—"}</td>
                <td className="text-center">
                  <div className="flex gap-1 justify-center">
                    {p.status === "draft" && (
                      <>
                        <button
                          onClick={() => handleSendSignRequest(p.id)}
                          disabled={sending === p.id || docCount(p) === 0}
                          title={docCount(p) === 0 ? "문서가 없는 패키지는 보낼 수 없습니다 — 삭제하고 서식을 골라 다시 만드세요" : undefined}
                          className="btn-primary btn-sm"
                        >
                          {sending === p.id ? "발송 중..." : "서명 요청"}
                        </button>
                        <button
                          onClick={async () => { if (await appConfirm("이 계약을 취소하시겠습니까?", { danger: true, confirmLabel: "계약 취소" })) cancelContract.mutate(p.id); }}
                          className="px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                        >
                          삭제
                        </button>
                      </>
                    )}
                    {(p.status === "sent" || p.status === "partially_signed") && (
                      <>
                        <button
                          onClick={() => handleSendSignRequest(p.id)}
                          disabled={sending === p.id}
                          className="px-2 py-1 text-[11px] font-medium text-blue-400 rounded-lg hover:bg-blue-500/10 transition"
                        >
                          {sending === p.id ? "발송 중..." : "재발송"}
                        </button>
                        <button
                          onClick={() => handleCancelSent(p)}
                          className="px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                          title={isExpired(p) ? "기한이 지난 미서명 계약을 취소로 정리합니다" : "열람 전이면 발송을 취소합니다"}
                        >
                          {isExpired(p) ? "정리" : "취소"}
                        </button>
                      </>
                    )}
                    {p.status === "completed" && (
                      <>
                        <button
                          onClick={() => p.sign_token && window.open(`/sign?token=${p.sign_token}`, "_blank", "noopener")}
                          className="px-2 py-1 text-[11px] font-medium text-green-400 rounded-lg hover:bg-green-500/10 transition flex items-center gap-1"
                          title="서명된 계약서를 봅니다."
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          서명본 보기
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleApplySeal(p.id)}
                      disabled={sealApplying === p.id}
                      className="px-2 py-1 text-[11px] font-medium text-orange-500 rounded-lg hover:bg-orange-500/10 transition disabled:opacity-50 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                      {sealApplying === p.id ? "적용 중..." : "직인 적용"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      )}

      {/* 기존 계약 이력(유효 근로계약) — 같은 상자 안 두 번째 구역, 선으로 가른다 */}
      {contracts.length > 0 && (
        <div className="ca-history">
          <h3 className="ca-history-title">계약 이력 <small>{contracts.length}건</small></h3>
          <table className="ev-table ev-lined ca-hist-table">
            <thead><tr>
              <th>구성원</th>
              <th>계약유형</th>
              <th>기간</th>
              <th>급여</th>
              <th>상태</th>
            </tr></thead>
            <tbody>
              {contracts.map((c: any) => (
                <tr key={c.id}>
                  <td className="text-center font-medium">{c.employees?.name || "—"}</td>
                  <td className="text-center">{CONTRACT_TYPES.find(t => t.value === c.contract_type)?.label || c.contract_type}</td>
                  <td className="text-center mono-number">{c.start_date} ~ {c.end_date || "무기한"}</td>
                  <td className="text-right mono-number">{c.salary ? `₩${Number(c.salary).toLocaleString()}` : "—"}</td>
                  <td className="text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{c.status === 'active' ? '유효' : c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
      </div>

      {/* 일괄 발송 — 고른 순간에만 뜨는 바닥 바. 파란(확정) 버튼은 화면을 통틀어 여기 하나 */}
      <SelectionBar count={selectedIds.size} summary="임시저장 계약" onClear={() => setSelectedIds(new Set())}>
        <button type="button" onClick={handleBatchSend} disabled={batchSending} className="btn-primary btn-sm whitespace-nowrap">
          {batchSending ? "발송 중..." : `일괄 발송 (${selectedIds.size}건)`}
        </button>
      </SelectionBar>
      </QueryBody>

      <Pager page={pager.page} pages={pager.pages} total={filteredContracts.length} size={live.rows}
        from={pager.from} to={pager.to} onPage={pager.setPage} />

      {/* 개별 발송 동선 안내 — 구성원 상세 › 근로계약과 연결 */}
      <div className="collect-note">
        개별 직원 계약은 <Link href="/employees" className="text-[var(--primary)] font-semibold hover:underline no-underline">구성원 상세 › 근로계약</Link>에서 발송합니다.
      </div>
    </QueryScreen>
  );
}

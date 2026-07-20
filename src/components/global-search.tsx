"use client";

import { globalSearch, type GlobalSearchResult } from "@/lib/search";
import { getCurrentUser } from "@/lib/queries";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { useModalKeys } from "@/hooks/use-modal-keys";

const TYPE_LABELS: Record<string, string> = {
  deals: "프로젝트", documents: "문서", partners: "거래처", taxInvoices: "세금계산서",
  bankTransactions: "거래내역", chatMessages: "채팅", employees: "인력",
};
// 2026-07-20 QA: 결과 클릭이 엉뚱한 목록으로 가던 버그 수정 —
//   taxInvoices 가 /transactions(거래 자동화)로, deals 가 존재하지 않는 사이드바 경로(/projects)로 가던 것을
//   실제 화면(/tax-invoices, /projecthub)으로 정정. bankTransactions 는 통장 화면(/bank)으로.
const TYPE_ROUTES: Record<string, string> = {
  deals: "/projecthub", documents: "/documents", partners: "/partners",
  taxInvoices: "/tax-invoices", bankTransactions: "/bank",
  chatMessages: "/chat", employees: "/employees",
};
const ENTITY_TYPES = ["deals","documents","partners","taxInvoices","bankTransactions","chatMessages","employees"] as const;

function getDisplayText(type: string, item: any): { primary: string; secondary: string } {
  switch (type) {
    case "deals":
      return { primary: item.name, secondary: item.status ?? item.classification ?? "" };
    case "documents":
      return { primary: item.name, secondary: item.status ?? "" };
    case "partners":
      return { primary: item.name, secondary: item.contact_name ?? item.type ?? "" };
    case "taxInvoices":
      return { primary: item.counterparty_name, secondary: [item.type, item.issue_date].filter(Boolean).join(" · ") };
    case "bankTransactions":
      return { primary: item.counterparty, secondary: [item.type, item.transaction_date].filter(Boolean).join(" · ") };
    case "chatMessages": {
      const c = item.content ?? "";
      return { primary: c.length > 60 ? c.slice(0, 60) + "…" : c, secondary: item.created_at?.slice(0, 10) ?? "" };
    }
    case "employees":
      return { primary: item.name, secondary: item.status ?? "" };
    default:
      return { primary: String(item.name ?? item.id), secondary: "" };
  }
}

let externalOpen: (() => void) | null = null;
export function openGlobalSearch() { externalOpen?.(); }

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { externalOpen = () => setOpen(true); return () => { externalOpen = null; }; }, []);

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen((p) => !p); }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(""); setResults(null); }
  }, [open]);

  const doSearch = useCallback((q: string) => {
    if (!companyId || q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    globalSearch(companyId, q).then((r) => { setResults(r); setLoading(false); });
  }, [companyId]);

  const onInputChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(value), 300);
  };

  // 2026-07-20 QA: 목록 첫 화면으로만 던지던 것을 항목까지 연결 —
  //   partners/documents 는 ?id= 딥링크(상세 자동 오픈)를 이미 지원, deals 는 projecthub 검색어(?q=)로 필터.
  const navigate = (type: string, item?: any) => {
    setOpen(false);
    const base = TYPE_ROUTES[type] ?? "/";
    if (item?.id && (type === "partners" || type === "documents")) {
      router.push(`${base}?id=${encodeURIComponent(item.id)}`);
    } else if (type === "deals" && item?.name) {
      router.push(`${base}?q=${encodeURIComponent(item.name)}`);
    } else {
      router.push(base);
    }
  };

  // 첫 번째 결과 그룹으로 이동 — Enter 로 검색 결과 첫 항목 선택과 동일 효과
  const firstResultType = results && results.totalCount > 0
    ? ENTITY_TYPES.find((t) => (results[t]?.length ?? 0) > 0) ?? null
    : null;
  const firstResultItem = firstResultType ? results?.[firstResultType]?.[0] : undefined;
  useModalKeys(open, () => setOpen(false), firstResultType ? () => navigate(firstResultType, firstResultItem) : undefined);

  if (!open) return null;

  return (
    <div className="global-search-modal fixed inset-0"
      onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="global-search-panel"
        role="dialog" aria-modal="true" aria-label="전역 검색"
        onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="global-search-input-row">
          <svg className="w-5 h-5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input ref={inputRef} type="text" value={query}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="검색... (프로젝트, 문서, 거래처, 세금계산서...)"
            className="flex-1 bg-transparent text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none text-sm" />
          <kbd className="hidden sm:inline-block text-[10px] text-[var(--text-dim)] border border-[var(--border)] rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        {/* Results */}
        <div className="global-search-results">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && results && results.totalCount === 0 && query.length >= 2 && (
            <p className="text-center text-[var(--text-muted)] text-sm py-8">검색 결과 없음</p>
          )}
          {!loading && results && results.totalCount > 0 && ENTITY_TYPES.map((type) => {
            const items = results[type];
            if (!items || items.length === 0) return null;
            return (
              <div key={type} className="global-search-result-group">
                <p className="text-[var(--text-dim)] text-xs uppercase font-semibold px-3 py-1.5">{TYPE_LABELS[type]}</p>
                {items.map((item: any) => {
                  const { primary, secondary } = getDisplayText(type, item);
                  return (
                    <button key={item.id} onClick={() => navigate(type, item)}
                      className="global-search-result-item">
                      <span className="text-sm text-[var(--text)] truncate">{primary}</span>
                      {secondary && <span className="text-xs text-[var(--text-muted)] shrink-0">{secondary}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!loading && !results && query.length < 2 && (
            <p className="text-center text-[var(--text-muted)] text-sm py-8">2글자 이상 입력하세요</p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// 재사용 계약서 문서 관리 — "단체 일괄 발송"·"새 서명 요청"에서 실제로 골라 쓰는 documents
// 테이블 원본을 여기서 검색·확인하고 "열기"로 기존 문서 편집기(/documents?id=)로 이동해 수정한다.
// 온라인홍보사업 개별계약서·소상공인 포기신청서처럼 문서함(파일보관함, 순수 파일 저장소로 단순화됨)
// 에서는 찾을 수 없던 "재사용 양식" 문서들이 이 목록에 뜬다. 편집기는 기존 것 그대로 재사용(신규 구현 없음).

import { useMemo, useState } from "react";
import Link from "next/link";
import { DOC_STATUS } from "@/lib/documents";

const TYPE_LABELS: Record<string, string> = {
  contract: "계약서",
  invoice: "견적서",
  quote: "제안서",
  nda: "비밀유지계약(NDA)",
  mou: "양해각서(MOU)",
  agreement: "업무제휴계약서",
};

export function DocumentTemplatesPanel({ documents }: { companyId: string; documents: any[] }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = documents.filter((d: any) => !term || (d.name || "").toLowerCase().includes(term));
    return rows.sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [documents, search]);

  const visible = expanded ? filtered : filtered.slice(0, 8);

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">재사용 계약서 문서</h3>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            "단체 일괄 발송"·"새 서명 요청"에서 고르는 문서 원본을 여기서 검색하고 수정합니다. (예: 온라인홍보사업 개별계약서, 소상공인 포기신청서)
          </p>
        </div>
        <span className="text-xs text-[var(--text-dim)]">{documents.length}건</span>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="문서명으로 검색... (예: 온라인홍보사업)"
        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
      />

      {filtered.length === 0 ? (
        <div className="px-3 py-8 text-center text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)]/40 rounded-lg border border-dashed border-[var(--border)]">
          {search ? "검색 결과가 없습니다" : "등록된 문서가 없습니다"}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]/50">
          {visible.map((d: any) => {
            const contentType = d.content_json?.type || d.auto_classified_type || "contract";
            const typeLabel = TYPE_LABELS[contentType] || contentType;
            const sc = (DOC_STATUS as any)[d.status] || DOC_STATUS.draft;
            return (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text)] truncate">{d.name || "(제목 없음)"}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{typeLabel}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {d.created_at ? new Date(d.created_at).toLocaleDateString("ko") : "—"}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/documents?id=${d.id}`}
                  className="text-xs font-semibold text-[var(--primary)] hover:underline flex-shrink-0"
                >
                  열기 →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 8 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] font-medium"
        >
          {expanded ? "접기" : `전체 ${filtered.length}건 보기`}
        </button>
      )}
    </div>
  );
}

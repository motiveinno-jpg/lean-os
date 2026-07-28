"use client";
// 운영 콘솔 공통 킷 (2026-07-28 전면 정비) — 모든 운영자 페이지가 같은 헤더·검색·
//   CSV 내보내기를 쓰게 해서 "페이지마다 다르게 생긴" 문제를 없앤다.
import { ReactNode } from "react";

/** 페이지 공통 헤더 — 제목·부제 + 우측 액션(검색·내보내기 등) */
export function OpsPageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="ops-page-header">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">{title}</h1>
        {sub && <p className="text-xs text-[var(--text-dim)] mt-1">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

/** 공통 검색 인풋 */
export function OpsSearch({ value, onChange, placeholder = "검색..." }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="ops-search-input"
      />
    </div>
  );
}

/** CSV 내보내기 — 엑셀 한글 호환(BOM). rows 는 {헤더라벨: 값} 객체 배열. */
export function exportCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 내보내기 버튼 */
export function OpsExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="ops-export-btn" title="현재 목록을 엑셀(CSV)로 저장">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
      내보내기
    </button>
  );
}

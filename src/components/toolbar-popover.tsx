"use client";

// 툴바에서 늘 자리를 차지하던 것들을 **누를 때만** 열리게 접는 공통 팝오버 (2026-08-10 사장님 지시).
//
//   세금·증빙 화면은 조회기간(월 입력 2 + 빠른기간 4)과 액션 버튼 5개가 항상 펼쳐져 있어
//   줄 두 개를 먹고 있었다. 기간은 한 번 정하면 한참 안 건드리는 값이고, 가져오기·내보내기는
//   가끔 쓰는 일이다. 둘 다 칩 하나로 접고 눌렀을 때만 펼친다.
//
//   바깥 클릭·ESC 로 닫히고, 안에서 무언가를 고르면 close() 로 닫는다.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ToolbarPopover({
  label, title, align = "right", width = 240, primary = false, disabled = false, children,
}: {
  /** 접힌 상태에서 보이는 글자 — 지금 고른 값을 그대로 보여 준다(예: 2025-09 ~ 2026-08) */
  label: ReactNode;
  /** 펼쳤을 때 맨 위 작은 제목 */
  title?: string;
  align?: "left" | "right";
  width?: number;
  primary?: boolean;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="toolbar-pop" ref={wrapRef}>
      <button type="button" disabled={disabled} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={primary ? "toolbar-pop-btn toolbar-pop-btn-primary" : "toolbar-pop-btn"}>
        {label}
        <span className="toolbar-pop-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={align === "left" ? "toolbar-pop-panel toolbar-pop-panel-left" : "toolbar-pop-panel"}
          style={{ width }} role="dialog">
          {title && <div className="toolbar-pop-title">{title}</div>}
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** 팝오버 안의 한 줄짜리 실행 항목 */
export function ToolbarPopoverItem({
  onClick, disabled, danger, hint, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={hint}
      className={danger ? "toolbar-pop-item toolbar-pop-item-danger" : "toolbar-pop-item"}>
      {children}
    </button>
  );
}

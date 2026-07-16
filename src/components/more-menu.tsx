"use client";

// 「⋯ 더보기」 드롭다운 — 리스트 위 액션 버튼이 많아 좁은 화면에서 넘칠 때, 자주 안 쓰는 액션을 접는 용도(2026-07-14).
//   MoreMenu 안에 MoreMenuItem(버튼/링크) 또는 임의 자식(파일 label 등)을 넣는다. 바깥 클릭·Esc 로 닫힘.

import { useState, useRef, useEffect } from "react";

export function MoreMenu({ children, label = "더보기", className = "" }: { children: React.ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  return (
    <div ref={ref} className={`more-menu-root ${className}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="more-menu-trigger btn-secondary btn-sm" aria-haspopup="menu" aria-expanded={open} title="더 많은 작업">
        ⋯ {label}
      </button>
      {open && (
        <div className="more-menu-panel" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// 드롭다운 항목 공통 스타일 — 버튼/링크/파일 label 어디에나 붙일 수 있는 className 도 export.
export const MORE_ITEM_CLS = "more-menu-item";

export function MoreMenuItem({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={MORE_ITEM_CLS} role="menuitem">{children}</button>;
}

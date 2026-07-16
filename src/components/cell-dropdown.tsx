"use client";

// 표 셀 안 자동완성 드롭다운을 document.body 포털 + position:fixed 로 띄운다.
//   - 표/카드의 overflow·whitespace-nowrap·stacking 에 갇히지 않음(겹침/잘림 방지).
//   - 앵커(입력칸) 의 화면 좌표를 받아 그 바로 아래(공간 부족 시 위)로 위치.
import { ReactNode, CSSProperties } from "react";
import { createPortal } from "react-dom";

export type Anchor = { top: number; left: number; bottom: number; width: number };

export const anchorOf = (el: HTMLElement): Anchor => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, width: r.width };
};

export function CellDropdown({
  anchor,
  width = 240,
  maxHeight = 288,
  align = "left",
  children,
}: {
  anchor: Anchor;
  width?: number;
  maxHeight?: number;
  align?: "left" | "right";
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === "right" ? anchor.left + anchor.width - width : anchor.left;
  left = Math.max(8, Math.min(left, vw - width - 8));
  const spaceBelow = vh - anchor.bottom;
  const openUp = spaceBelow < Math.min(maxHeight, 220) && anchor.top > spaceBelow;
  const style: CSSProperties = openUp
    ? { position: "fixed", bottom: vh - anchor.top + 2, left, width, maxHeight, zIndex: 80 }
    : { position: "fixed", top: anchor.bottom + 2, left, width, maxHeight, zIndex: 80 };
  return createPortal(
    <div
      style={style}
      className="cell-dropdown-panel"
    >
      {children}
    </div>,
    document.body,
  );
}

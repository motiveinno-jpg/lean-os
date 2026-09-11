"use client";
//   표처럼 생긴 입력 격자의 키보드 규칙을 한 곳에 둔다.
//
//   재고 전표 편집기(inventory/_components/doc-editor.tsx)가 2026-08-26 에 정착시킨 규칙이
//   세금계산서 '여러 장 한꺼번에' 에는 없어서, 마우스 없이는 줄을 못 채웠다.
//   규칙이 두 벌이 되면 화면마다 엔터 동작이 달라지므로 여기 한 벌만 둔다.
//
//   ─ 규칙 ─────────────────────────────────────────────────────────────────
//   Enter        그 칸이 비어 있으면 윗줄 값을 내려받고, 다음 칸으로 간다.
//                마지막 칸이면 아랫줄 첫 칸으로 — 마지막 줄이면 새 줄을 만든다.
//   ↓ / ↑        같은 칸으로 아랫줄 / 윗줄. 마지막 줄에서 ↓ 면 새 줄.
//   → / ←        글자 커서가 칸 끝(맨 앞)이거나 값이 통째로 선택돼 있을 때 옆 칸으로.
//                글자 사이에 커서가 있으면 글자 이동 — 타이핑 중에 칸을 벗어나지 않는다.
//
//   칸은 `data-cell="<칸이름>-<줄번호>"` 로 찾는다. 그 안의 input·select·textarea 에
//   커서를 준다 — DateField 처럼 속을 감싼 부품도 그대로 잡힌다.

import { useCallback, type KeyboardEvent, type RefObject } from "react";

export type GridKeysOptions = {
  /** 좌→우 칸 순서. 읽기 전용 칸은 빼고 적는다. */
  cells: string[];
  /** 격자를 감싼 요소 — 이 안에서만 칸을 찾는다. */
  gridRef: RefObject<HTMLElement | null>;
  /** 현재 줄 수 */
  rowCount: number;
  /** 새 줄 만들기. 만든 뒤 커서를 옮기므로 상태 반영이 끝나야 한다. */
  addRow: () => void;
  /**
   *  그 칸이 '아직 사용자가 정하지 않은' 상태인가 — 그럴 때만 윗줄 값을 내려받는다.
   *  ⚠️ 기본값이 있는 칸(유형 "매출", 수량 "1")은 값이 비어 있지 않으므로,
   *     '빈 문자열' 이 아니라 '직접 손댔는지' 로 판단해야 Enter 복사가 실제로 동작한다.
   */
  isEmpty: (rowIndex: number, cell: string) => boolean;
  /** 윗줄 값을 이 줄로 내려받기. 거래처처럼 딸린 값(사업자번호 등)도 같이 옮긴다. */
  copyDown: (rowIndex: number, cell: string) => void;
  /** 참이면 이 칸에서는 ↑↓ 를 가로채지 않는다(예: select 는 ↑↓ 가 값 고르기다). */
  keepNativeUpDown?: (cell: string) => boolean;
  /** 참이면 키 처리를 통째로 건너뛴다(예: 거래처 후보 목록이 열려 있을 때). */
  skip?: (rowIndex: number, cell: string) => boolean;
};

export function useGridKeys(opts: GridKeysOptions) {
  const { cells, gridRef, rowCount, addRow, isEmpty, copyDown, keepNativeUpDown, skip } = opts;

  /** 그 칸으로 커서를 옮긴다. 줄이 막 생긴 직후면 다음 그림 뒤에 잡히도록 미룬다. */
  const focusCell = useCallback((rowIndex: number, cell: string) => {
    const run = () => {
      const box = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${cell}-${rowIndex}"]`);
      const el = box?.matches("input, select, textarea")
        ? (box as HTMLInputElement)
        : box?.querySelector<HTMLInputElement>("input, select, textarea");
      if (!el) return;
      el.focus();
      if (el.tagName === "INPUT") (el as HTMLInputElement).select?.();
    };
    //   두 번 미룬다 — 새 줄은 상태 반영 → 그림 순서라 한 번으로는 아직 없다
    setTimeout(run, 0);
    setTimeout(run, 30);
  }, [gridRef]);

  const onCellKey = useCallback((e: KeyboardEvent, rowIndex: number, cell: string) => {
    if (skip?.(rowIndex, cell)) return;
    const ci = cells.indexOf(cell);
    if (ci < 0) return;
    const el = e.currentTarget as HTMLInputElement;

    if (e.key === "ArrowDown" && !keepNativeUpDown?.(cell)) {
      e.preventDefault();
      if (rowIndex === rowCount - 1) addRow();
      focusCell(rowIndex + 1, cell);
      return;
    }
    if (e.key === "ArrowUp" && !keepNativeUpDown?.(cell)) {
      if (rowIndex > 0) { e.preventDefault(); focusCell(rowIndex - 1, cell); }
      return;
    }

    //   ←→ 는 글자 커서가 끝에 닿았을 때만 칸을 옮긴다 — 타이핑을 방해하지 않는다
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const isText = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
      const start = isText ? (el.selectionStart ?? 0) : 0;
      const end = isText ? (el.selectionEnd ?? 0) : 0;
      const len = isText ? String(el.value ?? "").length : 0;
      //   칸에 막 들어오면 값이 통째로 선택돼 있다(전체 선택). 그 상태에서도 옆 칸으로 넘어간다 —
      //   화살표로 칸 사이를 오가는 게 이 격자의 주 쓰임이라, 한 번 더 눌러야 하면 답답하다.
      const allSelected = isText && len > 0 && start === 0 && end === len;
      const atEnd = !isText || allSelected || (start === end && start >= len);
      const atStart = !isText || allSelected || (start === end && start === 0);
      if (e.key === "ArrowRight" && atEnd && ci < cells.length - 1) {
        e.preventDefault(); focusCell(rowIndex, cells[ci + 1]);
      } else if (e.key === "ArrowLeft" && atStart && ci > 0) {
        e.preventDefault(); focusCell(rowIndex, cells[ci - 1]);
      }
      return;
    }

    if (e.key !== "Enter") return;
    e.preventDefault();
    //   빈 칸이면 윗줄에서 내려받는다 — 유형·작성일자·품목명·수량이 대개 같은 줄의 반복이다
    if (rowIndex > 0 && isEmpty(rowIndex, cell)) copyDown(rowIndex, cell);

    if (ci < cells.length - 1) {
      focusCell(rowIndex, cells[ci + 1]);
      return;
    }
    //   마지막 칸 — 아랫줄 첫 칸으로. 마지막 줄이었으면 새 줄을 만든다.
    if (rowIndex === rowCount - 1) addRow();
    focusCell(rowIndex + 1, cells[0]);
  }, [cells, rowCount, addRow, isEmpty, copyDown, keepNativeUpDown, skip, focusCell]);

  return { focusCell, onCellKey };
}

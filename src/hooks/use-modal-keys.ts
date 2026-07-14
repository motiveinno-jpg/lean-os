"use client";

// 오너뷰 전역 모달 키보드 컨벤션: ESC=닫기, Enter=주 액션 확인.
//   textarea/select 포커스 중, IME(한글) 조합 중, 이미 버튼에 포커스된 상태의 Enter는
//   제외해 줄바꿈·한글 입력·중복 클릭을 건드리지 않는다.
import { useEffect } from "react";

export function useModalKeys(active: boolean, onClose?: () => void, onConfirm?: () => void) {
  useEffect(() => {
    if (!active) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Enter" || !onConfirm) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // textarea 줄바꿈, select 옵션 선택, 이미 버튼 클릭되는 Enter, 리치에디터(contenteditable) 줄바꿈,
      // 한글 등 IME 조합 중 Enter는 제외
      if (tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      if (target?.isContentEditable) return;
      if ((e as unknown as { isComposing?: boolean }).isComposing) return;
      onConfirm();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose, onConfirm]);
}

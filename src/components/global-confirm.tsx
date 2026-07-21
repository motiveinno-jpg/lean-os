"use client";

// 전역 확인 모달 브리지 — 2026-07-21 QA 스윕.
//   window.confirm()/confirm() 잔존 지점(브라우저 기본 다이얼로그 — 앱 톤·다크모드 이탈)의
//   일괄 대체용. useConfirm(훅)과 동일한 UI/클래스를 쓰되, 컴포넌트별 훅 배선 없이
//   어디서든 `await appConfirm("메시지")` 로 호출한다.
//   사용:
//     if (!(await appConfirm("이 글을 삭제하시겠습니까?", { danger: true }))) return;
//   GlobalConfirmHost 는 (app) 셸과 platform 레이아웃에 각 1회 마운트.
//   호스트 미마운트 환경(외부 공유 페이지 등)에서는 window.confirm 폴백.

import { useEffect, useState } from "react";
import { useModalKeys } from "@/hooks/use-modal-keys";

type AppConfirmOptions = {
  /** 확정 버튼이 빨간 솔리드 + 기본 라벨 "삭제" */
  danger?: boolean;
  /** 확정 버튼 라벨 (기본 "확인", danger 면 "삭제") */
  confirmLabel?: string;
  /** 모달 제목 (기본 "확인") */
  title?: string;
};

type Pending = AppConfirmOptions & { message: string; resolve: (ok: boolean) => void };

let enqueue: ((p: Pending) => void) | null = null;

export function appConfirm(message: string, opts?: AppConfirmOptions): Promise<boolean> {
  if (!enqueue) {
    // 호스트 미마운트(외부 페이지·SSR) 폴백 — 기능은 유지
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  }
  return new Promise((resolve) => enqueue!({ message, ...opts, resolve }));
}

export function GlobalConfirmHost() {
  const [state, setState] = useState<Pending | null>(null);

  useEffect(() => {
    enqueue = (p) => setState((prev) => {
      // 이미 열려 있으면 앞 요청은 취소 처리 (동시 confirm 은 실사용상 없음)
      prev?.resolve(false);
      return p;
    });
    return () => { enqueue = null; };
  }, []);

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  useModalKeys(!!state, () => close(false), () => close(true));

  if (!state) return null;
  return (
    <div className="confirm-dialog-backdrop fixed inset-0" onClick={() => close(false)}>
      <div className="confirm-dialog-panel glass-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h3 className="text-base font-bold text-[var(--text)]">{state.title || "확인"}</h3>
        <div className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed whitespace-pre-line">{state.message}</div>
        <div className="confirm-dialog-actions">
          <button className="btn-secondary" onClick={() => close(false)}>취소</button>
          <button className={state.danger ? "btn-danger-solid" : "btn-primary"} onClick={() => close(true)}>
            {state.confirmLabel || (state.danger ? "삭제" : "확인")}
          </button>
        </div>
      </div>
    </div>
  );
}

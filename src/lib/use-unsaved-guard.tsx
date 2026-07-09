"use client";

import { useCallback, useState } from "react";

// 모달 바깥(백드롭) 클릭 등으로 닫힐 때, 입력 중인 내용이 있으면 "작업을 취소하시겠습니까?" 확인.
//   사장님 요청(2026-07-09): 팝업 옆 공간을 실수로 누르면 바로 사라져 작성분이 날아가는 불편 방지.
//   사용법:
//     const { guard, confirmEl } = useUnsavedGuard();
//     <div className="fixed inset-0 ..." onClick={() => guard(onClose, isDirty)}>
//        ... {confirmEl}
//   isDirty=false 면 확인 없이 즉시 닫힘(빈 폼/보기 모드는 그대로).
export function useUnsavedGuard() {
  const [pending, setPending] = useState<null | (() => void)>(null);

  const guard = useCallback((onClose: () => void, dirty: boolean) => {
    if (dirty) setPending(() => onClose);
    else onClose();
  }, []);

  const confirmEl = pending ? (
    <div
      className="unsaved-guard fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { e.stopPropagation(); setPending(null); }}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xs p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-bold text-[var(--text)]">작업을 취소하시겠습니까?</div>
        <div className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">입력한 내용이 저장되지 않고 닫힙니다.</div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPending(null); }}
            className="px-3 py-1.5 text-xs rounded-lg text-[var(--text-muted)] hover:text-[var(--text)]"
          >계속 작성</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); const fn = pending; setPending(null); fn?.(); }}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--danger)] text-white hover:opacity-90"
          >취소하고 닫기</button>
        </div>
      </div>
    </div>
  ) : null;

  return { guard, confirmEl };
}

"use client";

// 공용 확인 모달 — 라운드7 파운데이션.
//   네이티브 window.confirm()/prompt() (브라우저 기본 다이얼로그 — 앱 톤·다크모드 이탈) 대체.
//   사용:
//     const { confirm, confirmElement } = useConfirm();
//     ...
//     if (!(await confirm({ title: "통장 삭제", desc: "연결된 거래는 유지됩니다.", danger: true }))) return;
//     ...JSX 마지막에 {confirmElement}
//   withInput 을 주면 사유 입력(textarea) 값을 함께 반환 (반려 사유 등 — window.prompt 대체).

import { useCallback, useState, type ReactNode } from "react";
import { useModalKeys } from "@/hooks/use-modal-keys";

export type ConfirmOptions = {
  title: string;
  desc?: ReactNode;
  /** 확정 버튼 라벨 (기본 "확인", danger 면 "삭제") */
  confirmLabel?: string;
  /** true 면 확정 버튼이 빨간 솔리드(.btn-danger-solid) */
  danger?: boolean;
  /** 사유 입력칸 표시 — placeholder 문자열. 입력값은 resolve 값의 input 으로 반환 */
  withInput?: string;
  /** withInput 일 때 빈 값 허용 여부 (기본 false = 필수) */
  inputOptional?: boolean;
};

type ConfirmResult = { ok: boolean; input?: string };

export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [input, setInput] = useState("");

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        setInput("");
        setState({ ...opts, resolve });
      }),
    [],
  );

  const close = (r: ConfirmResult) => {
    state?.resolve(r);
    setState(null);
  };

  const canConfirm = !!state && !(state.withInput != null && !state.inputOptional && !input.trim());
  useModalKeys(
    !!state,
    () => close({ ok: false }),
    canConfirm ? () => close({ ok: true, input: input.trim() || undefined }) : undefined,
  );

  const confirmElement = state ? (
    <div
      className="confirm-dialog-backdrop fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
      onClick={() => close({ ok: false })}
    >
      <div className="confirm-dialog-panel glass-card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h3 className="text-base font-bold text-[var(--text)]">{state.title}</h3>
        {state.desc && <div className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed">{state.desc}</div>}
        {state.withInput != null && (
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={state.withInput}
            className="field-input mt-3 w-full"
            rows={3}
          />
        )}
        <div className="confirm-dialog-actions mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => close({ ok: false })}>취소</button>
          <button
            className={state.danger ? "btn-danger-solid" : "btn-primary"}
            disabled={state.withInput != null && !state.inputOptional && !input.trim()}
            onClick={() => close({ ok: true, input: input.trim() || undefined })}
          >
            {state.confirmLabel || (state.danger ? "삭제" : "확인")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, confirmElement };
}

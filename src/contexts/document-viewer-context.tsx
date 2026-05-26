"use client";

// 공통 서류 뷰어 모달 — 내부 사용자가 사이트 안에서 서류(서명완료 계약서)를 클릭하면
//   새 페이지 이동 대신 팝업(모달)으로 표시. URL 비의존 state 단일 소스(깜빡임 방지).
//   외부 토큰 링크(/sign?token=, /quote/[token])는 이 모달 대상 아님 — 그대로 새 페이지 유지.
//
// 사용: const { open } = useDocumentViewer(); open({ type: 'contract', id });

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ContractViewer } from "@/components/contract-viewer";

// 현재 'contract'(서명완료 계약서, ContractViewer 가 quote_approval/signature_request dual-mode 자동 식별).
//   향후 'document'(일반문서 읽기전용) 등 확장 지점.
export type DocViewerTarget = { type: "contract"; id: string };

interface DocumentViewerCtx {
  open: (target: DocViewerTarget) => void;
  close: () => void;
}

const DocumentViewerContext = createContext<DocumentViewerCtx | null>(null);

export function useDocumentViewer(): DocumentViewerCtx {
  const ctx = useContext(DocumentViewerContext);
  if (!ctx) throw new Error("useDocumentViewer must be used within DocumentViewerProvider");
  return ctx;
}

export function DocumentViewerProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<DocViewerTarget | null>(null);

  const open = useCallback((t: DocViewerTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);

  // ESC 닫기 + body 스크롤 잠금 (모달 열린 동안)
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [target, close]);

  return (
    <DocumentViewerContext.Provider value={{ open, close }}>
      {children}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto sm:p-6 print:static print:overflow-visible print:bg-transparent print:p-0"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full min-h-screen bg-[var(--bg)] sm:my-auto sm:min-h-0 sm:max-w-4xl sm:rounded-2xl sm:shadow-2xl print:min-h-0 print:max-w-full print:bg-transparent print:shadow-none"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={close}
              aria-label="닫기"
              className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none print:hidden"
            >
              ✕
            </button>
            <div className="p-4 sm:p-6">
              {target.type === "contract" && <ContractViewer id={target.id} />}
            </div>
          </div>
        </div>
      )}
    </DocumentViewerContext.Provider>
  );
}

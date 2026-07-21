"use client";

// 전역 모달 가드 — 어떤 모달이든 바깥(백드롭) 클릭으로 닫힐 때, 그 모달 안에 '입력 중인 값'이
//   있으면 "작업을 취소하시겠습니까?" 를 물어본다. (사장님 요청: 팝업 옆 공간 실수 클릭으로 작성분 유실 방지)
//   구현: document 캡처단계에서 백드롭(fixed inset-0 요소 자체) 클릭을 가로채, 내부에 값이 채워진
//   input/textarea/contenteditable 가 있으면 닫힘을 막고 확인. '취소하고 닫기'면 bypass 로 재클릭해 원래
//   닫기 동작을 통과시킨다. 값이 없으면(빈 폼·정보 모달·드롭다운 오버레이) 즉시 통과 → 기존 동작 유지.
import { useEffect, useRef, useState } from "react";

function isBackdropEl(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const cls = el.getAttribute("class") || "";
  return /(^|\s)fixed(\s|$)/.test(cls) && /inset-0/.test(cls);
}

function hasDirtyInput(root: HTMLElement): boolean {
  const els = root.querySelectorAll("input, textarea, [contenteditable='true']");
  for (const el of Array.from(els)) {
    const he = el as HTMLInputElement;
    const type = (he.getAttribute("type") || "").toLowerCase();
    if (["checkbox", "radio", "hidden", "file", "submit", "button", "range", "color"].includes(type)) continue;
    // 2026-07-21 QA: DB에서 미리 채워진 값(온보딩 회사명 등)만 있어도 "작성분 유실" 경고가 뜨던 것 —
    //   input/textarea 는 초기값(defaultValue)과 달라진 경우(=사용자가 실제 수정)만 dirty 로 판정.
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const v = String(he.value ?? "");
      if (v.trim() !== "" && v !== String(he.defaultValue ?? "")) return true;
      continue;
    }
    const v = (el as HTMLElement).textContent || "";
    if (String(v).trim() !== "") return true;
  }
  return false;
}

export function GlobalModalGuard() {
  const [pending, setPending] = useState<HTMLElement | null>(null);
  const bypassRef = useRef(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bypassRef.current) { bypassRef.current = false; return; }
      const t = e.target as Element | null;
      // 백드롭 자체를 클릭했을 때만(내부 카드는 stopPropagation 이라 여기 안 옴). currentTarget 무관, target 판정.
      if (!isBackdropEl(t)) return;
      if (t.getAttribute("data-guard-skip") === "1") return; // 가드 자신의 오버레이 등 제외
      if (!hasDirtyInput(t)) return;                          // 입력값 없으면 그대로 닫힘
      e.preventDefault();
      e.stopPropagation();
      setPending(t);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const keepEditing = () => setPending(null);
  const closeAnyway = () => {
    const el = pending;
    setPending(null);
    if (el) { bypassRef.current = true; el.click(); } // 원래 백드롭 닫기 동작을 통과시켜 닫음
  };

  if (!pending) return null;
  return (
    <div
      data-guard-skip="1"
      className="global-modal-guard fixed inset-0"
      onClick={(e) => { e.stopPropagation(); keepEditing(); }}
    >
      <div className="modal-guard-dialog bg-[var(--bg-card)] rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-bold text-[var(--text)]">작업을 취소하시겠습니까?</div>
        <div className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">입력한 내용이 저장되지 않고 닫힙니다.</div>
        <div className="modal-guard-actions">
          <button type="button" onClick={keepEditing} className="px-3 py-1.5 text-xs rounded-lg text-[var(--text-muted)] hover:text-[var(--text)]">계속 작성</button>
          <button type="button" onClick={closeAnyway} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--danger)] text-white hover:opacity-90">취소하고 닫기</button>
        </div>
      </div>
    </div>
  );
}

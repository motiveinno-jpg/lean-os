"use client";

// 인쇄/PDF 저장 시 .print-area 만 남기고 나머지를 흐름에서 완전히 제거.
//   배경: globals 의 `body * { visibility:hidden }` 은 요소를 숨기되 "공간은 유지" → min-h-screen 등
//   본문 컨테이너가 화면높이만큼 빈 공간을 차지해 PDF 앞쪽에 빈 페이지(1~6p)가 생김.
//   해결: beforeprint 에 .print-area 의 조상 체인 형제들에 [data-print-hidden] 부여 →
//   @media print 에서 display:none → 빈 공간 자체가 사라짐. afterprint 에 원복.
//   (CSS 만으로는 조상 체인 식별이 불가해 JS 로 처리. React DOM 이동 없이 속성만 토글 → 안전.)

import { useEffect } from "react";

export function usePrintIsolation() {
  useEffect(() => {
    const marked: Element[] = [];

    const isolate = () => {
      const pa = document.querySelector(".print-area");
      if (!pa) return;
      let el: Element | null = pa;
      // print-area → body 까지 올라가며, 각 단계에서 "자신이 아닌 형제"를 숨김.
      //   print-area 경로(조상 체인)만 살아남아 빈 공간이 0 이 된다.
      while (el && el !== document.body && el.parentElement) {
        const parent: HTMLElement = el.parentElement;
        for (const sib of Array.from(parent.children)) {
          if (sib !== el && !sib.hasAttribute("data-print-hidden")) {
            sib.setAttribute("data-print-hidden", "");
            marked.push(sib);
          }
        }
        el = parent;
      }
    };

    const restore = () => {
      marked.forEach((e) => e.removeAttribute("data-print-hidden"));
      marked.length = 0;
    };

    window.addEventListener("beforeprint", isolate);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", isolate);
      window.removeEventListener("afterprint", restore);
      restore();
    };
  }, []);
}

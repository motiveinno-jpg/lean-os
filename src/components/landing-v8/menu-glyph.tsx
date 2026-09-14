// 공개 페이지 메뉴 아이콘 — 옛 components/landing/features-view.tsx 의 MenuGlyph 를 옮겼다 (2026-09-14).
//   /features(v8) · /demo 가 같이 쓴다. 이름은 landing-v8/catalog.ts 의 icon 값.
// 메뉴 아이콘 · 실제 사이드바(components/sidebar.tsx)가 쓰는 아이콘과 같은 모양.
export function MenuGlyph({ n }: { n: string }) {
  const p = { width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (n) {
    case "users": return <svg {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /></svg>;
    case "receipt": return <svg {...p}><path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5 4 2z" /><path d="M8 8h8M8 12h8" /></svg>;
    case "book": return <svg {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>;
    case "pen": return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
    case "chart": return <svg {...p}><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 5-9" /></svg>;
    case "calendar": return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
    case "briefcase": return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></svg>;
    case "check": return <svg {...p}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
    case "board": return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6" /></svg>;
    case "chat": return <svg {...p}><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 013 11.5a8.4 8.4 0 019-8.4 8.4 8.4 0 019 8.4z" /></svg>;
    case "sign": return <svg {...p}><path d="M3 17c3-6 5 3 8-2s4 1 7-3" /><path d="M4 21h16" /></svg>;
    case "user": return <svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "file": return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" /><path d="M14 2v6h6M9 14h6M9 18h4" /></svg>;
    case "folder": return <svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>;
    case "swap": return <svg {...p}><path d="M8 3L4 7l4 4" /><path d="M4 7h16" /><path d="M16 21l4-4-4-4" /><path d="M20 17H4" /></svg>;
    case "wallet": return <svg {...p}><path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 000 4h4v-4h-4z" /></svg>;
    case "repeat": return <svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>;
    case "trend": return <svg {...p}><path d="M22 7l-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></svg>;
    // 2026-08-20 CATALOG 재작성으로 새로 쓰이게 된 아이콘들 · 없으면 전부 같은 기본 도형으로 떨어져
    //   통장·카드·수집전표·매입매출전표가 구분되지 않았다(/features 와 /demo 양쪽에서).
    case "bank": return  <svg {...p}><path d="M3 10h18M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18" /><path d="M12 3L3 8h18l-9-5z" /></svg>;
    case "card": return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20M6 15h4" /></svg>;
    case "drive": return <svg {...p}><path d="M12 3v12" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>;
    case "sheet": return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>;
    // 재고 그룹(2026-08-25 신설). 품목(상자) · 재고(겹친 판) · 생산(공정)
    case "box": return  <svg {...p}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>;
    case "layers": return <svg {...p}><path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" /></svg>;
    case "factory": return <svg {...p}><path d="M3 21V10l6 4V10l6 4V7l6 3v11H3z" /><path d="M7 21v-4M13 21v-4M18 21v-4" /></svg>;
    case "doc": return <svg {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
    case "link": return <svg {...p}><path d="M10 13a5 5 0 007.5.5l2-2A5 5 0 0012.5 4.5l-1 1" /><path d="M14 11a5 5 0 00-7.5-.5l-2 2A5 5 0 0011.5 19.5l1-1" /></svg>;
    case "won": return <svg {...p}><path d="M4 7l3.2 10L12 9l4.8 8L20 7" /><path d="M3 12h18" /></svg>;
    case "mail": return <svg {...p}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M3 7l9 6 9-6" /></svg>;
    // 2026-09-14 지원사업추천(선물 상자) — 사이드바 gift 아이콘과 같은 뜻
    case "gift": return <svg {...p}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 010-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 010 5" /></svg>;
    default: return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
  }
}

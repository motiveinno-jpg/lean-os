//   결재 유형 아이콘·색 — 결재 허브(approvals/page)와 설정 › 결재선 관리(approval-policies-manager)가 같이 쓴다.
//   2026-10-06 결재선 관리를 설정으로 옮기며 페이지 파일에서 떼어 냈다(Next page 파일은 이름 붙은 export 를 못 낸다).

// 유형별 아이콘·컬러 아이덴티티 · 리스트를 훑을 때 유형이 한눈에 구분되게.
export const TYPE_META: Record<string, { icon: string; bg: string; text: string }> = {
  expense: { icon: "wallet", bg: "bg-violet-500/12", text: "text-violet-500" },
  expense_report: { icon: "wallet", bg: "bg-violet-500/12", text: "text-violet-500" },
  card_expense: { icon: "card", bg: "bg-fuchsia-500/12", text: "text-fuchsia-500" },
  payment: { icon: "banknote", bg: "bg-sky-500/12", text: "text-sky-500" },
  leave: { icon: "sun", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]" },
  purchase: { icon: "cart", bg: "bg-orange-500/12", text: "text-orange-500" },
  equipment: { icon: "monitor", bg: "bg-cyan-600/12", text: "text-cyan-600" },
  contract: { icon: "pen", bg: "bg-[var(--primary)]/12", text: "text-[var(--primary)]" },
  travel: { icon: "plane", bg: "bg-blue-500/12", text: "text-blue-500" },
  approval_doc: { icon: "doc", bg: "bg-rose-500/12", text: "text-rose-500" },
  certificate: { icon: "doc", bg: "bg-teal-500/12", text: "text-teal-600" },
};
export const TYPE_FALLBACK = { icon: "doc", bg: "bg-[var(--primary)]/12", text: "text-[var(--primary)]" };
export const typeMeta = (t: string) => TYPE_META[t] || TYPE_FALLBACK;

export function TypeIcon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const p = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "wallet": return <svg {...p}><path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2"/><path d="M16 12h5v4h-5a2 2 0 010-4z"/></svg>;
    case "card": return <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    case "banknote": return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>;
    case "sun": return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>;
    case "cart": return <svg {...p}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>;
    case "monitor": return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
    case "pen": return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "plane": return <svg {...p}><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>;
    default: return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
  }
}

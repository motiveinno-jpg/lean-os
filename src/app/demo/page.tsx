"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectFlow } from "./_components/project-flow";
import { WidgetBoard } from "./_components/widget-board";
import { FlowPanel, HrPanel, AccountPanel } from "./_components/pillar-panels";
import {
  PartnersPanel, VoucherPanel, SchedulePanel, ApprovalsPanel, BoardPanel, ChatPanel,
  TemplatesPanel, DocumentsPanel, BankPanel, CardsPanel, PaymentsPanel, LoansPanel, VaultPanel,
} from "./_components/menu-panels";
import {
  ProjectsPanel, EstimatePanel, ContractPanel, SettlementPanel, MembersPanel, LeavePanel, TaxPanel,
  EstimateBeforePanel, SettlementBeforePanel,
} from "./_components/pillar-frames";
import { CopilotPanel, BriefPanel, OcrPanel } from "./_components/ai-panels";
import {
  ProjectsBeforePanel, HrBeforePanel, MembersBeforePanel, LeaveBeforePanel,
  AcctBeforePanel, BankBeforePanel, TaxBeforePanel,
} from "./_components/before-frames";

// ── Constants ──

const DEMO_COMPANY = "데모 회사 (주)";
const DEMO_USER = "김대표";

const SIX_PACK = [
  { label: "통장 잔고", value: "₩2.3억", color: "var(--text)" },
  { label: "런웨이", value: "8.2개월", color: "var(--success)" },
  { label: "미수금 30일+", value: "₩1,200만", color: "var(--warning)" },
  { label: "월 매출", value: "₩4,500만", color: "var(--text)" },
  { label: "번레이트", value: "₩3,200만", color: "var(--text)" },
  { label: "진행중 프로젝트", value: "7건", color: "var(--primary)" },
];

const PULSE_FORECAST = [
  { label: "현재", balance: 23000, color: "var(--primary)" },
  { label: "D+7", balance: 21500, color: "var(--primary)" },
  { label: "D+30", balance: 19800, color: "var(--primary)" },
  { label: "D+60", balance: 16300, color: "var(--warning)" },
  { label: "D+90", balance: 14100, color: "var(--warning)" },
];

const TODAY_ACTIONS = [
  { priority: "critical" as const, text: "미수금 30일+ ₩1,200만 — (주)하늘건설 독촉 필요" },
  { priority: "high" as const, text: "승인대기 ₩850만 — 외주비 2건 검토/승인 필요" },
  { priority: "high" as const, text: "마감 임박 2건 — D-5 이내 납품 확인" },
  { priority: "normal" as const, text: "이번달 순현금 +₩1,300만 예상 — 안정적" },
];

const RISK_ITEMS = [
  { label: "마진 20% 이하", icon: "📉", count: 1, detail: "A사 웹개발 프로젝트 (마진 14%)" },
  { label: "D-7 이내 마감", icon: "⏰", count: 2, detail: "B사 디자인, C사 컨설팅" },
  { label: "미수금 30일+", icon: "💸", count: 1, detail: "(주)하늘건설 ₩1,200만" },
  { label: "외주비 마진잠식", icon: "🔥", count: 0, detail: "해당 없음" },
];

const DEALS = [
  { name: "B사 UI/UX 리뉴얼", stage: "진행중", amount: "₩2,800만", progress: 65 },
  { name: "C사 전략 컨설팅", stage: "계약완료", amount: "₩1,500만", progress: 30 },
  { name: "D사 앱 개발", stage: "견적발송", amount: "₩4,200만", progress: 10 },
  { name: "E사 유지보수", stage: "진행중", amount: "₩600만", progress: 80 },
  { name: "F사 브랜딩", stage: "협상중", amount: "₩900만", progress: 5 },
];

const QUICK_LINKS = [
  { href: "#", label: "프로젝트", icon: "📋", desc: "프로젝트 파이프라인" },
  { href: "#", label: "결제/승인", icon: "💳", desc: "결제 큐 관리" },
  { href: "#", label: "인사/급여", icon: "👤", desc: "직원 관리" },
  { href: "#", label: "전자계약", icon: "📄", desc: "문서 서명" },
  { href: "#", label: "고객 DB", icon: "🏢", desc: "거래처 관리" },
  { href: "#", label: "채팅", icon: "💬", desc: "팀 소통" },
];

const YESTERDAY_TX = [
  { type: "입금", desc: "A사 2차 기성금", amount: "+₩1,200만" },
  { type: "출금", desc: "사무실 월세", amount: "-₩180만" },
  { type: "출금", desc: "외주비 (디자이너)", amount: "-₩350만" },
  { type: "입금", desc: "E사 유지보수 월정액", amount: "+₩600만" },
];

// 사이드바 — 실제 앱(components/sidebar.tsx)의 그룹·라벨을 그대로 옮긴 정적 사본.
//   데모는 라우팅/권한이 없으므로 링크 없이 모양만 재현한다.
// 사이드바 — 실제 앱(components/sidebar.tsx)의 그룹·라벨을 그대로 옮긴 사본.
//   view 는 이 메뉴를 눌렀을 때 보여줄 화면 키다(가상 데이터). 없는 메뉴는 준비중으로 안내한다.
const NAV_GROUPS: { label: string; items: { label: string; icon: string; view?: string; badge?: string }[] }[] = [
  { label: "홈", items: [
    { label: "대시보드", icon: "grid", view: "dashboard" },
    { label: "AI 참모", icon: "sparkles", view: "copilot" },
    { label: "알림", icon: "bell", badge: "3" },
  ] },
  { label: "파이낸스", items: [
    { label: "거래처", icon: "users", view: "partners" },
    { label: "세금·증빙", icon: "receipt", view: "tax" },
    { label: "거래 장부", icon: "book", view: "ledger" },
    { label: "전표입력", icon: "pen", view: "voucher" },
    { label: "분석", icon: "chart", view: "flow" },
  ] },
  { label: "워크스페이스", items: [
    { label: "일정 / 할 일", icon: "calendar", view: "schedule" },
    { label: "프로젝트", icon: "briefcase", view: "projects" },
    { label: "결재 허브", icon: "check", badge: "5", view: "approvals" },
    { label: "게시판", icon: "board", view: "board" },
    { label: "메신저", icon: "chat", view: "chat" },
    { label: "전자계약", icon: "pen", view: "contract" },
  ] },
  { label: "인사관리", items: [
    { label: "구성원", icon: "user", view: "members" },
    { label: "근태 관리", icon: "calendar", view: "leave" },
    { label: "근로계약·서식", icon: "file", view: "templates" },
    { label: "파일보관함", icon: "folder", view: "documents" },
  ] },
  { label: "자산관리", items: [
    { label: "통장", icon: "swap", view: "bank" },
    { label: "카드", icon: "wallet", view: "cards" },
    { label: "정기 지출", icon: "repeat", view: "payments" },
    { label: "대출", icon: "trend", view: "loans" },
    { label: "자산", icon: "shield", view: "vault" },
  ] },
];

// 헤더에 뿌릴 위치 정보
const VIEW_META: Record<string, { crumb: string; title: string }> = {
  dashboard: { crumb: "홈", title: "대시보드" },
  copilot: { crumb: "홈", title: "AI 참모" },
  partners: { crumb: "파이낸스", title: "거래처" },
  tax: { crumb: "파이낸스", title: "세금·증빙" },
  ledger: { crumb: "파이낸스", title: "거래 장부" },
  voucher: { crumb: "파이낸스", title: "전표입력" },
  flow: { crumb: "파이낸스", title: "분석" },
  schedule: { crumb: "워크스페이스", title: "일정 / 할 일" },
  projects: { crumb: "워크스페이스", title: "프로젝트" },
  approvals: { crumb: "워크스페이스", title: "결재 허브" },
  board: { crumb: "워크스페이스", title: "게시판" },
  chat: { crumb: "워크스페이스", title: "메신저" },
  contract: { crumb: "워크스페이스", title: "전자계약" },
  members: { crumb: "인사관리", title: "구성원" },
  leave: { crumb: "인사관리", title: "근태 관리" },
  templates: { crumb: "인사관리", title: "근로계약·서식" },
  documents: { crumb: "인사관리", title: "파일보관함" },
  bank: { crumb: "자산관리", title: "통장" },
  cards: { crumb: "자산관리", title: "카드" },
  payments: { crumb: "자산관리", title: "정기 지출" },
  loans: { crumb: "자산관리", title: "대출" },
  vault: { crumb: "자산관리", title: "자산" },
};

// ── Glyphs ──

const gp = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function NavGlyph({ type }: { type: string }) {
  const p = { ...gp, className: "demo-nav-glyph" };
  switch (type) {
    case "grid": return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
    case "sparkles": return <svg {...p}><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9L18 15z"/></svg>;
    case "bell": return <svg {...p}><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>;
    case "users": return <svg {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/></svg>;
    case "receipt": return <svg {...p}><path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5 4 2z"/><path d="M8 8h8M8 12h8"/></svg>;
    case "book": return <svg {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>;
    case "chart": return <svg {...p}><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>;
    case "briefcase": return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>;
    case "check": return <svg {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>;
    case "pen": return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "chat": return <svg {...p}><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 013 11.5a8.4 8.4 0 019-8.4 8.4 8.4 0 019 8.4z"/></svg>;
    case "user": return <svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case "calendar": return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
    case "swap": return <svg {...p}><path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg>;
    case "wallet": return <svg {...p}><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4h-4z"/></svg>;
    default: return null;
  }
}

const OwnerViewMark = () => (
  <div className="demo-sidebar-mark">
    <svg width="20" height="20" viewBox="0 0 40 40" fill="none">
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.6" fill="none" />
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <polyline points="12,20 15,18 18,19 22,14" stroke="#fdba74" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  </div>
);

const SearchGlyph = () => (<svg {...gp} className="demo-header-glyph"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>);
const BellGlyph = () => (<svg {...gp} className="demo-header-glyph"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>);

// ── Helpers ──

function formatBrief(): string[] {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5
      ? "늦은 밤이네요"
      : hour < 12
        ? "좋은 아침입니다"
        : hour < 18
          ? "오후 브리핑입니다"
          : "저녁 브리핑입니다";

  const month = now.getMonth() + 1;
  const date = now.getDate();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const today = `${month}월 ${date}일 ${weekdays[now.getDay()]}요일`;

  return [
    `${greeting}, ${DEMO_USER}님. ${today} ${DEMO_COMPANY} 브리핑입니다.`,
    "통장 잔고 2억 3,000만원, 런웨이 8.2개월로 안정 구간입니다.",
    "미수금 1,200만원이 30일을 넘겼습니다. (주)하늘건설 담당자에게 연락이 필요합니다.",
    "이번 달 매출 4,500만원 중 미입금 1,800만원 — 예정대로면 D+7 내 입금됩니다.",
  ];
}

// ── Page Component ──

export default function DemoPage() {
  const [showDeals, setShowDeals] = useState(false);
  // 사이드바에서 고른 메뉴. ?all=1 은 랜딩 캡처용 — 모든 화면을 한 번에 렌더한다.
  const [view, setView] = useState("dashboard");
  const [soon, setSoon] = useState({ crumb: "홈", title: "알림" });   // 데모에 없는 메뉴의 헤더용
  const [capAll, setCapAll] = useState(false);
  useEffect(() => {
    setCapAll(new URLSearchParams(window.location.search).get("all") === "1");
  }, []);
  const show = (k: string) => capAll || view === k;
  const meta = VIEW_META[view] ?? soon;
  const briefLines = formatBrief();
  const maxForecast = Math.max(...PULSE_FORECAST.map((p) => p.balance));

  return (
    <div className="demo-root">
      {/* ═══ Demo Banner ═══ */}
      <div className="demo-banner">
        데모 모드입니다. 실제 데이터로 사용하려면{" "}
        <Link
          href="/auth"
          className="underline underline-offset-2 font-bold hover:opacity-90 transition"
        >
          무료로 시작하기
        </Link>{" "}
        를 눌러주세요.
      </div>

      {/* ═══ App Shell — 실제 앱과 동일한 인셋 플로팅 유리 셸 ═══ */}
      <div className="demo-shell">
        {/* Sidebar — sidebar-panel/chrome-glass: 앱 본체 사이드바와 같은 재질·폭 */}
        <aside className="demo-sidebar chrome-glass">
          <div className="demo-sidebar-brand">
            <OwnerViewMark />
            <div className="demo-sidebar-brand-text">
              <span className="demo-sidebar-brand-name">오너뷰</span>
              <span className="demo-sidebar-brand-sub">{DEMO_USER} <b className="demo-role">대표</b></span>
            </div>
          </div>

          <div className="demo-side-search"><SearchGlyph /><span>검색</span><kbd className="demo-side-kbd">⌘K</kbd></div>

          <nav className="demo-sidebar-nav">
            {NAV_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="demo-sidebar-group">{g.label}</div>
                {g.items.map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className={`demo-nav-item ${item.view === view ? "nav-active" : ""}`}
                    onClick={() => { setView(item.view ?? "soon"); if (!item.view) setSoon({ crumb: g.label, title: item.label }); window.scrollTo({ top: 0 }); }}
                  >
                    <NavGlyph type={item.icon} />
                    <span>{item.label}</span>
                    {item.badge ? <span className="demo-nav-badge">{item.badge}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="demo-sidebar-foot">
            <span className="demo-foot-item">« 접기</span>
            <span className="demo-foot-item">☾ 다크 모드</span>
            <span className="demo-foot-item">↪ 로그아웃</span>
          </div>
        </aside>

        {/* Main column — 앱과 동일하게 플로팅 헤더 + 본문 */}
        <div className="demo-main-col">
          <header className="demo-header chrome-glass">
            <div className="demo-header-titles">
              <div className="demo-header-crumb">{meta.crumb} ›</div>
              <div className="demo-header-title">{meta.title}</div>
            </div>
            <div className="demo-header-search">
              <SearchGlyph />
              <span>무엇이든 검색</span>
              <kbd className="demo-header-kbd">⌘K</kbd>
            </div>
            <div className="demo-header-chip">
              <BellGlyph />
              <span className="demo-header-badge">99+</span>
            </div>
            <div className="demo-header-profile"><span className="demo-header-avatar">김</span><span className="demo-header-me"><b>{DEMO_USER}</b><i>대표</i></span></div>
          </header>

          <main className="demo-main">
          {show("dashboard") && (<>
          {/* ═══ 위젯 대시보드 (실제 앱 최상단) ═══ */}
          <WidgetBoard />

          {/* ═══ Morning Brief ═══ */}
          <section
            className="morning-brief-card glass-card"
          >
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--success)" }}
              />
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}
              >
                Morning Brief
              </span>
            </div>
            <div className="space-y-2">
              {briefLines.map((line, i) => (
                <p
                  key={i}
                  className={`${i === 0 ? "text-base font-bold" : "text-sm"} leading-[1.7]`}
                  style={{
                    color:
                      i === 0 ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {line}
                </p>
              ))}
            </div>
          </section>

          {/* ═══ Cash Pulse Bar ═══ */}
          <div
            className="cash-pulse-bar glass-card"
          >
            <div
              className="grid grid-cols-2 md:grid-cols-4 divide-x"
              style={
                {
                  "--tw-divide-opacity": 1,
                  borderColor: "var(--border)",
                } as React.CSSProperties
              }
            >
              <div className="pulse-balance-stat">
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  통장 잔고
                </div>
                <div
                  className="text-base font-black"
                  style={{ color: "var(--text)" }}
                >
                  ₩2.3억
                </div>
              </div>
              <div className="pulse-forecast-stat">
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  현금 예측
                </div>
                <div className="text-sm font-black" style={{ color: "var(--text)" }}>
                  D+30 ₩1.98억
                </div>
                <div
                  className="text-[10px] font-semibold mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  D+90 ₩1.41억
                </div>
              </div>
              <div className="pulse-score-stat">
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  펄스 점수
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-lg font-black text-[#22c55e]"
                  >
                    72
                  </span>
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: "var(--text-dim)" }}
                  >
                    / 100
                  </span>
                </div>
              </div>
              <div className="pulse-risk-stat">
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  위험 . 대기
                </div>
                <div className="flex items-baseline gap-3">
                  <span
                    className="text-sm font-black"
                    style={{ color: "var(--danger, #ef4444)" }}
                  >
                    위험 3
                  </span>
                  <span
                    className="text-sm font-black"
                    style={{ color: "var(--warning, #f59e0b)" }}
                  >
                    대기 2
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ 6-Pack Metrics ═══ */}
          <div
            className="six-pack-metrics-card glass-card"
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-y md:divide-y-0"
              style={{ borderColor: "var(--border)" }}
            >
              {SIX_PACK.map((item) => (
                <div key={item.label} className="six-pack-metric-item">
                  <div
                    className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {item.label}
                  </div>
                  <div className="text-sm font-black" style={{ color: item.color }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ Cash Pulse Forecast Chart ═══ */}
          <div
            className="cash-pulse-forecast-card glass-card"
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--primary)" }}
              />
              <h2
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}
              >
                현금 펄스
              </h2>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  background: "rgba(34,197,94,0.1)",
                  color: "#22c55e",
                }}
              >
                72/100
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {PULSE_FORECAST.map((pt) => {
                const pct =
                  maxForecast > 0
                    ? (Math.abs(pt.balance) / maxForecast) * 100
                    : 0;
                return (
                  <div key={pt.label} className="forecast-bar-item">
                    <div
                      className="text-[9px] font-semibold mb-1"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {pt.label}
                    </div>
                    <div className="h-12 flex items-end justify-center mb-1">
                      <div
                        className="w-full max-w-[32px] rounded-t opacity-80"
                        style={{
                          height: `${Math.max(pct, 8)}%`,
                          background: pt.color,
                        }}
                      />
                    </div>
                    <div
                      className="text-[10px] font-bold"
                      style={{ color: "var(--text)" }}
                    >
                      ₩{(pt.balance / 10000).toFixed(1)}만
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              className="text-[11px] leading-relaxed px-1 py-2 rounded"
              style={{
                color: "var(--text-muted)",
                background: "var(--bg-surface, var(--bg))",
              }}
            >
              현재 잔고 2.3억, D+30 1.98억 예측. 런웨이 8.2개월로 안정 구간.
              미수금 1,200만원 회수 시 D+90 예측이 1.53억으로 개선됩니다.
            </div>
          </div>

          {/* ═══ Today Actions ═══ */}
          <div className="today-actions-list">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--primary)" }}
              />
              <h2
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}
              >
                오늘의 액션
              </h2>
            </div>
            <div className="space-y-2">
              {TODAY_ACTIONS.map((a, i) => {
                const borderColor =
                  a.priority === "critical"
                    ? "var(--danger, #ef4444)"
                    : a.priority === "high"
                      ? "var(--warning, #f59e0b)"
                      : "var(--text-dim)";
                const dotColor =
                  a.priority === "critical"
                    ? "bg-red-500"
                    : a.priority === "high"
                      ? "bg-amber-500"
                      : "bg-slate-400";
                return (
                  <div
                    key={i}
                    className={`today-action-item glass-card today-action-${a.priority}`}
                    style={{ borderLeftColor: borderColor }}
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                    />
                    <span
                      className="text-xs flex-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {a.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ Yesterday Transactions ═══ */}
          <div
            className="yesterday-tx-card glass-card"
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--text-dim)" }}
              />
              <h2
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}
              >
                어제 거래 요약
              </h2>
            </div>
            <div className="space-y-2">
              {YESTERDAY_TX.map((tx, i) => (
                <div
                  key={i}
                  className="yesterday-tx-row"
                  style={{ background: "var(--bg-surface, var(--bg))" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          tx.type === "입금"
                            ? "rgba(34,197,94,0.1)"
                            : "rgba(239,68,68,0.1)",
                        color:
                          tx.type === "입금" ? "#22c55e" : "#ef4444",
                      }}
                    >
                      {tx.type}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--text)" }}
                    >
                      {tx.desc}
                    </span>
                  </div>
                  <span
                    className="text-xs font-bold"
                    style={{
                      color:
                        tx.amount.startsWith("+")
                          ? "#22c55e"
                          : "#ef4444",
                    }}
                  >
                    {tx.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ Risk Zone ═══ */}
          <div className="risk-zone-section">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <h2
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}
              >
                위험 구역
              </h2>
              <span
                className="text-[10px]"
                style={{ color: "var(--text-dim)" }}
              >
                3건
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {RISK_ITEMS.map((risk) => (
                <div
                  key={risk.label}
                  className={`risk-item-card glass-card ${risk.count > 0 ? "risk-item-card-hot" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{risk.icon}</span>
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: "var(--text)" }}
                    >
                      {risk.label}
                    </span>
                    <span
                      className="ml-auto text-xs font-black"
                      style={{
                        color:
                          risk.count > 0
                            ? "var(--danger, #ef4444)"
                            : "var(--text-dim)",
                      }}
                    >
                      {risk.count}
                    </span>
                  </div>
                  <div
                    className="text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {risk.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ Deal Pipeline (collapsible) ═══ */}
          <div
            className="deal-pipeline-card glass-card"
          >
            <button
              onClick={() => setShowDeals(!showDeals)}
              className="flex items-center gap-2 w-full text-left"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--primary)" }}
              />
              <h2
                className="text-xs font-bold uppercase tracking-wider flex-1"
                style={{ color: "var(--text-dim)" }}
              >
                프로젝트 파이프라인
              </h2>
              <span
                className="text-[10px] font-semibold"
                style={{ color: "var(--text-dim)" }}
              >
                {DEALS.length}건
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${showDeals ? "rotate-180" : ""}`}
                style={{ color: "var(--text-dim)" }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M19 9l-7 7-7-7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {showDeals && (
              <div className="mt-3 space-y-2">
                {DEALS.map((deal) => (
                  <div
                    key={deal.name}
                    className="deal-pipeline-row"
                    style={{ background: "var(--bg-surface, var(--bg))" }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-xs font-bold truncate"
                        style={{ color: "var(--text)" }}
                      >
                        {deal.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold opacity-90"
                          style={{
                            background: "var(--primary)",
                            color: "#fff",
                          }}
                        >
                          {deal.stage}
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {deal.amount}
                        </span>
                      </div>
                    </div>
                    <div className="w-16 flex-shrink-0">
                      <div
                        className="h-1.5 rounded-full overflow-hidden"
                        style={{ background: "var(--border)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${deal.progress}%`,
                            background: "var(--primary)",
                          }}
                        />
                      </div>
                      <div
                        className="text-[9px] text-right mt-0.5 font-semibold"
                        style={{ color: "var(--text-dim)" }}
                      >
                        {deal.progress}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 대시보드에서만 프로젝트 흐름을 같이 보여준다 */}
          <ProjectFlow />
          </>)}

          {/* ═══ 메뉴별 화면 — 사이드바에서 고른 메뉴 하나만 (?all=1 이면 전부) ═══ */}
          {show("flow") && <FlowPanel />}
          {show("leave") && <HrPanel />}
          {show("ledger") && <AccountPanel />}
          {show("partners") && <PartnersPanel />}
          {show("voucher") && <VoucherPanel />}
          {show("schedule") && <SchedulePanel />}
          {show("approvals") && <ApprovalsPanel />}
          {show("board") && <BoardPanel />}
          {show("chat") && <ChatPanel />}
          {show("templates") && <TemplatesPanel />}
          {show("documents") && <DocumentsPanel />}
          {show("bank") && <BankPanel />}
          {show("cards") && <CardsPanel />}
          {show("payments") && <PaymentsPanel />}
          {show("loans") && <LoansPanel />}
          {show("vault") && <VaultPanel />}
          {show("projects") && <ProjectsPanel />}
          {(show("projects") || capAll) && <EstimatePanel />}
          {show("contract") && <ContractPanel />}
          {(show("projects") || capAll) && <SettlementPanel />}
          {show("members") && <MembersPanel />}
          {(show("leave") || capAll) && <LeavePanel />}
          {show("tax") && <TaxPanel />}
          {/* 랜딩 "처리 전 → 처리 후" 크로스페이드용 앞 상태 — 캡처 모드에서만 렌더 */}
          {capAll && <EstimateBeforePanel />}
          {capAll && <SettlementBeforePanel />}
          {capAll && <ProjectsBeforePanel />}
          {capAll && <HrBeforePanel />}
          {capAll && <MembersBeforePanel />}
          {capAll && <LeaveBeforePanel />}
          {capAll && <AcctBeforePanel />}
          {capAll && <BankBeforePanel />}
          {capAll && <TaxBeforePanel />}
          {show("copilot") && <CopilotPanel />}
          {(show("copilot") || capAll) && <BriefPanel />}
          {(show("approvals") || capAll) && <OcrPanel />}

          {view === "soon" && !capAll && (
            <section className="pp glass-card">
              <div className="pp-head">
                <div className="pp-head-l">
                  <div className="pp-menu">데모</div>
                  <div className="pp-title">이 메뉴는 데모에 담지 않았어요</div>
                  <div className="pp-sub">가입하면 알림·설정까지 전부 쓸 수 있어요. 다른 메뉴를 눌러보세요.</div>
                </div>
              </div>
            </section>
          )}

          {/* ═══ Quick Links ═══ */}
          <div className="quick-links-section">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--text-dim)" }}
              />
              <h2
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}
              >
                빠른 이동
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {QUICK_LINKS.map((link) => (
                <div
                  key={link.label}
                  className="quick-link-card glass-card"
                >
                  <div className="text-xl mb-1.5">{link.icon}</div>
                  <div
                    className="text-xs font-bold"
                    style={{ color: "var(--text)" }}
                  >
                    {link.label}
                  </div>
                  <div
                    className="text-[10px] mt-0.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {link.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ CTA ═══ */}
          <div
            className="cta-card glass-card"
          >
            <h3
              className="text-lg font-bold mb-2"
              style={{ color: "var(--text)" }}
            >
              실제 데이터로 시작해보세요
            </h3>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--text-muted)" }}
            >
              기존 엑셀만 올리면 70% 즉시 완성. 가입 시 카드 등록 · 14일 무료.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/auth"
                className="px-8 py-3 rounded-xl text-sm font-bold text-white transition hover:opacity-90 active:scale-[0.98]"
                style={{ background: "var(--primary)" }}
              >
                무료로 시작하기
              </Link>
              <Link
                href="/"
                className="px-8 py-3 rounded-xl text-sm font-semibold border transition"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                  background: "var(--bg-surface, var(--bg))",
                }}
              >
                랜딩 페이지로 돌아가기
              </Link>
            </div>
          </div>
          </main>
        </div>
      </div>
    </div>
  );
}

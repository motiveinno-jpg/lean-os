"use client";

import Link from "next/link";
import { useState } from "react";

// ── Constants ──

const DEMO_COMPANY = "데모 회사 (주)";
const DEMO_USER = "김대표";

const SIX_PACK = [
  { label: "통장 잔고", value: "₩2.3억", color: "var(--text)" },
  { label: "런웨이", value: "8.2개월", color: "var(--success)" },
  { label: "미수금 30일+", value: "₩1,200만", color: "var(--warning)" },
  { label: "월 매출", value: "₩4,500만", color: "var(--text)" },
  { label: "번레이트", value: "₩3,200만", color: "var(--text)" },
  { label: "진행중 딜", value: "7건", color: "var(--primary)" },
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
  { href: "#", label: "프로젝트", icon: "📋", desc: "딜 파이프라인" },
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
  const briefLines = formatBrief();
  const maxForecast = Math.max(...PULSE_FORECAST.map((p) => p.balance));

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* ═══ Demo Banner ═══ */}
      <div
        className="sticky top-0 z-50 px-4 py-2.5 text-center text-sm font-semibold"
        style={{
          background: "linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)",
          color: "#fff",
        }}
      >
        데모 모드입니다. 실제 데이터로 사용하려면{" "}
        <Link
          href="/auth"
          className="underline underline-offset-2 font-bold hover:opacity-90 transition"
        >
          무료로 시작하기
        </Link>{" "}
        를 눌러주세요.
      </div>

      {/* ═══ App Shell ═══ */}
      <div className="flex">
        {/* Sidebar (desktop) */}
        <aside
          className="hidden md:flex flex-col w-[220px] min-h-screen border-r p-4 flex-shrink-0"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
          }}
        >
          <div className="flex items-center gap-2 mb-6">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: "var(--primary)" }}
            >
              O
            </div>
            <span
              className="text-sm font-bold"
              style={{ color: "var(--text)" }}
            >
              OwnerView
            </span>
          </div>

          <div className="space-y-1 flex-1">
            {[
              { label: "대시보드", active: true },
              { label: "프로젝트" },
              { label: "결제/승인" },
              { label: "재무분석" },
              { label: "인사/급여" },
              { label: "전자계약" },
              { label: "고객 DB" },
              { label: "서류관리" },
              { label: "채팅" },
            ].map((item) => (
              <div
                key={item.label}
                className="px-3 py-2 rounded-lg text-xs font-semibold cursor-default"
                style={{
                  background: item.active
                    ? "var(--primary)"
                    : "transparent",
                  color: item.active ? "#fff" : "var(--text-muted)",
                }}
              >
                {item.label}
              </div>
            ))}
          </div>

          <div
            className="mt-auto pt-4 border-t text-[11px]"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-dim)",
            }}
          >
            <div className="font-semibold" style={{ color: "var(--text)" }}>
              {DEMO_COMPANY}
            </div>
            <div>{DEMO_USER} (대표)</div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 px-4 md:px-8 py-6 max-w-[1100px]">
          {/* ═══ Morning Brief ═══ */}
          <section
            className="mb-6 rounded-2xl border p-6 md:p-8"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
            }}
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
                  className={i === 0 ? "text-base font-bold" : "text-sm"}
                  style={{
                    color:
                      i === 0 ? "var(--text)" : "var(--text-muted)",
                    lineHeight: 1.7,
                  }}
                >
                  {line}
                </p>
              ))}
            </div>
          </section>

          {/* ═══ Cash Pulse Bar ═══ */}
          <div
            className="rounded-2xl p-1 mb-4"
            style={{
              background: "var(--bg-card)",
              border: "1px solid rgba(34,197,94,0.15)",
            }}
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
              <div className="px-4 py-3">
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
              <div className="px-4 py-3">
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
              <div className="px-4 py-3">
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  펄스 점수
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-lg font-black"
                    style={{ color: "#22c55e" }}
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
              <div className="px-4 py-3">
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
            className="rounded-2xl border mb-5 overflow-hidden"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
            }}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-y md:divide-y-0"
              style={{ borderColor: "var(--border)" }}
            >
              {SIX_PACK.map((item) => (
                <div key={item.label} className="px-4 py-4">
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
            className="mb-5 rounded-xl border p-4"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
            }}
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
                  <div key={pt.label} className="text-center">
                    <div
                      className="text-[9px] font-semibold mb-1"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {pt.label}
                    </div>
                    <div className="h-12 flex items-end justify-center mb-1">
                      <div
                        className="w-full max-w-[32px] rounded-t"
                        style={{
                          height: `${Math.max(pct, 8)}%`,
                          background: pt.color,
                          opacity: 0.8,
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
          <div className="mb-5">
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
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border"
                    style={{
                      borderColor: "var(--border)",
                      borderLeftWidth: 2,
                      borderLeftColor: borderColor,
                      background:
                        a.priority === "critical"
                          ? "rgba(239,68,68,0.03)"
                          : a.priority === "high"
                            ? "rgba(245,158,11,0.02)"
                            : "var(--bg-card)",
                    }}
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
            className="mb-5 rounded-xl border p-4"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
            }}
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
                  className="flex items-center justify-between px-3 py-2 rounded-lg"
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
          <div className="mb-5">
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
                  className="rounded-xl border p-3"
                  style={{
                    background: "var(--bg-card)",
                    borderColor:
                      risk.count > 0
                        ? "rgba(239,68,68,0.2)"
                        : "var(--border)",
                  }}
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
            className="mb-5 rounded-xl border p-4"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
            }}
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
                딜 파이프라인
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
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
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
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: "var(--primary)",
                            color: "#fff",
                            opacity: 0.9,
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

          {/* ═══ Quick Links ═══ */}
          <div className="mb-5">
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
                  className="rounded-xl border p-4 opacity-60 cursor-default"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border)",
                  }}
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
            className="rounded-2xl border p-8 text-center mb-10"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--primary)",
              borderWidth: 2,
            }}
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
              기존 엑셀만 올리면 70% 즉시 완성. 카드 등록 없이 무료로 시작.
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
  );
}

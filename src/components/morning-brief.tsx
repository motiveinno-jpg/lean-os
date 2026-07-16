// src/components/morning-brief.tsx
//
// 대시보드 최상단 "아침 브리핑" 카드.
// 숫자 덩어리 대신 자연스러운 한국어 문장 2~4줄로 오늘의 경영 상황을 알려준다.
// 50대 CEO가 안경 없이도 읽을 수 있게 폰트를 크게, 색상은 차분하게.
//
// 디자인 방향:
//   - 이모지/그라데이션/네온 글로우 없음
//   - Pretendard 굵기 대비로 강약 조절
//   - 금액은 단위를 붙여 읽기 쉽게 ("1억 2,300만원")
//   - 데이터가 없으면 온보딩 문구, 있으면 요약 + 다음 액션 힌트
//
// Pure display component — 데이터는 부모가 넘겨준다.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getTodos } from "@/lib/schedule";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";
import type { CashPulseResult } from "@/lib/cash-pulse";
import type { FounderDashboardData } from "@/lib/engines";
import type { YesterdayTxSummary } from "@/lib/queries";

interface MorningBriefProps {
  userName: string;
  companyName: string;
  cashPulse: CashPulseResult | null;
  dashboard: FounderDashboardData | null;
  hasData: boolean;
  yesterdayTx?: YesterdayTxSummary | null;
  userId?: string;
  aiBriefingEnabled?: boolean;
}

// AI 브리핑 2.0 구조(액션 플랜) — 엣지가 json_schema 강제 출력으로 생성 (구버전 캐시는 평문 폴백)
interface AiBriefPlan {
  headline: string;
  summary: string;
  actions: Array<{ title: string; detail: string; priority: "긴급" | "중요" | "권장"; link: string }>;
  risks: string[];
  wins: string[];
}
function parseBriefPlan(content: string): AiBriefPlan | null {
  try {
    const p = JSON.parse(content);
    if (p && typeof p.headline === "string" && Array.isArray(p.actions)) return p as AiBriefPlan;
  } catch { /* 구버전 평문 브리핑 */ }
  return null;
}
// 액션 링크 키 → 실행 화면
const ACTION_HREF: Record<string, { href: string; label: string }> = {
  ar: { href: "/partners/ledger", label: "회수 관리" },
  approvals: { href: "/approvals", label: "결재 처리" },
  tax: { href: "/tax-invoices?tab=vat", label: "부가세 확인" },
  todo: { href: "/schedule", label: "할 일 보기" },
  bank: { href: "/bank", label: "통장 보기" },
  payments: { href: "/payments", label: "지급 관리" },
  pnl: { href: "/reports/pnl", label: "손익 보기" },
  invoices: { href: "/tax-invoices", label: "계산서 보기" },
};
const PRIORITY_STYLE: Record<string, string> = {
  긴급: "bg-[var(--danger-dim)] text-[var(--danger)]",
  중요: "bg-[var(--warning-dim)] text-[var(--warning)]",
  권장: "bg-[var(--bg-surface)] text-[var(--text-muted)]",
};

// AI 브리핑의 톤 태그(<neg>/<pos>/<key>)를 색상 강조 span 으로 변환 (예전 규칙 브리핑의 hl 색상 재사용)
function renderTagged(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /<(neg|pos|key)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const color = m[1] === "neg" ? "var(--danger)" : m[1] === "pos" ? "var(--success)" : "var(--primary)";
    parts.push(<strong key={i++} className="font-bold" style={{ color }}>{m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── 문구 헬퍼 ─────────────────────────────────────────
// (라운드6.5: 인사말은 고정 헤더바가 대체 — greetingForHour/인사 h2 제거, 브리핑 본문만 유지)

function formatKrwWords(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0원";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);

  if (eok > 0 && man > 0) {
    return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  }
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
}

function formatTodayKorean(d: Date): string {
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${month}월 ${date}일 ${weekdays[d.getDay()]}요일`;
}

// 금액·핵심 수치 강조 — 의미별 색(토큰). primary=중요/중립, success=긍정·증가, danger=주의·감소·위험.
//   다크/라이트 양쪽 토큰 사용 → 대비 자동 확보.
type HlTone = "primary" | "success" | "danger";
function hl(text: string, tone: HlTone = "primary") {
  const color =
    tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : "var(--primary)";
  return (
    <strong className="font-bold" style={{ color }}>
      {text}
    </strong>
  );
}

// ── 본문 ────────────────────────────────────────────

export function MorningBrief({
  companyName,
  cashPulse,
  dashboard,
  hasData,
  yesterdayTx,
  userId,
  aiBriefingEnabled = false,
}: MorningBriefProps) {
  const now = new Date();
  const today = formatTodayKorean(now);
  // KAIROS H2 fix: 모바일에서 카드가 80%+ 차지하던 문제 해결
  // 기본은 축약(line1, line2, line4만), 펼치면 전체
  const [expanded, setExpanded] = useState(false);

  // AI 브리핑 2.0 (액션 플랜) — 회사당 하루 1회 서버 캐시. 실패/미생성 시 아래 규칙 브리핑으로 폴백.
  //   훅 순서 보존을 위해 early return 앞에 선언, enabled 로 데이터 있을 때만 호출.
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const briefKey = ["ai-briefing", formatTodayKorean(now)];

  // 요청 페이로드 조립 — 최초 생성과 '다시 생성' 공용
  const buildBriefPayload = async () => {
    if (!cashPulse) return null;
    const nums = {
      balance: cashPulse.currentBalance,
      forecast30: cashPulse.forecast30d,
      forecast90: cashPulse.forecast90d,
      runwayMonths: dashboard?.sixPack.runwayMonths ?? 0,
      monthlyBurn: cashPulse.monthlyBurn,
      arOver30: dashboard?.sixPack.arOver30 ?? 0,
      pendingApprovals: cashPulse.pendingApprovalCount,
      riskCount: dashboard?.risks.length ?? 0,
      monthRevenue: dashboard?.growth.monthRevenue ?? 0,
      monthTarget: dashboard?.growth.monthTarget ?? 0,
    };
    const todayStr = new Date().toISOString().slice(0, 10);
    const taxDeadlines = getUpcomingTaxDeadlines(30).slice(0, 4).map((t) => ({ title: t.title, daysLeft: t.daysLeft }));
    let todos: Array<{ title: string; priority: number; dueDate: string | null; overdue: boolean }> = [];
    if (userId) {
      try {
        const rows = await getTodos(userId, { includeDone: false });
        todos = rows.slice(0, 8).map((t) => ({
          title: t.title,
          priority: t.priority,
          dueDate: t.due_date,
          overdue: !!t.due_date && t.due_date < todayStr,
        }));
      } catch { /* 할 일 조회 실패는 무시 — 브리핑은 재무만으로도 생성 */ }
    }
    return { nums, actions: { taxDeadlines, todos }, companyName };
  };

  const aiBrief = useQuery({
    queryKey: briefKey,
    enabled: hasData && !!cashPulse && aiBriefingEnabled,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const payload = await buildBriefPayload();
      if (!payload) return null;
      try {
        const { data, error } = await supabase.functions.invoke("ai-briefing", { body: payload });
        if (error) return null;
        return (data?.content as string) || null;
      } catch { return null; }
    },
  }).data ?? null;

  // '다시 생성' — 캐시 무시하고 최신 데이터로 재생성 (오후에 상황이 바뀌었을 때)
  const regenerateBrief = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const payload = await buildBriefPayload();
      if (!payload) return;
      const { data, error } = await supabase.functions.invoke("ai-briefing", { body: { ...payload, force: true } });
      if (!error && data?.content) queryClient.setQueryData(briefKey, data.content as string);
    } catch { /* 실패 시 기존 브리핑 유지 */ }
    finally { setRegenerating(false); }
  };

  const briefPlan = aiBrief ? parseBriefPlan(aiBrief) : null;

  // 데이터 없음 — 온보딩 톤
  if (!hasData || !cashPulse) {
    return (
      <section className="morning-brief-onboarding glass-card">
        <p className="text-xs sm:text-sm text-[var(--text-dim)] mb-2">{today}</p>
        <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed break-keep">
          아직 {companyName || "회사"} 데이터가 충분하지 않습니다.
          거래내역을 동기화하거나 엑셀 파일을 올리시면, 내일 아침부터
          매일의 경영 상황을 이 자리에서 정리해 드리겠습니다.
        </p>
      </section>
    );
  }

  // 데이터 기반 자연어 브리핑 조립
  const balance = cashPulse.currentBalance;
  const forecast30 = cashPulse.forecast30d;
  const forecast90 = cashPulse.forecast90d;
  const runwayMonths = dashboard?.sixPack.runwayMonths ?? 0;
  const riskCount = dashboard?.risks.length ?? 0;
  const pendingApprovals = cashPulse.pendingApprovalCount;
  const arOver30 = dashboard?.sixPack.arOver30 ?? 0;
  const monthRevenue = dashboard?.growth.monthRevenue ?? 0;
  const monthTarget = dashboard?.growth.monthTarget ?? 0;

  // 1문장: 현재 잔고 + 톤 — 잔고 강조
  const line1: ReactNode = <>오늘 아침 통장에는 {hl(formatKrwWords(balance))}이 있습니다.</>;

  // 2문장: 30일 전망 — 증감액(증가=초록/감소=빨강) + 전망잔고 강조
  let line2: ReactNode = "";
  const delta30 = forecast30 - balance;
  if (Math.abs(delta30) < balance * 0.02) {
    line2 = "이번 달은 수입과 지출이 비슷한 수준으로, 잔고 변동은 크지 않을 전망입니다.";
  } else if (delta30 > 0) {
    line2 = (
      <>
        30일 뒤에는 {hl(formatKrwWords(delta30), "success")} 정도 늘어나{" "}
        {hl(formatKrwWords(forecast30))}이 될 것으로 보입니다.
      </>
    );
  } else {
    line2 = (
      <>
        다만 30일 뒤에는 {hl(formatKrwWords(-delta30), "danger")} 정도 줄어{" "}
        {hl(formatKrwWords(forecast30))}이 남을 것으로 보입니다.
      </>
    );
  }

  // 3문장: 런웨이 / 장기 경고 — 기간·위험 강조
  let line3: ReactNode = "";
  if (forecast90 < 0) {
    line3 = (
      <>
        이 속도로는 {hl("90일 안에 현금이 바닥", "danger")}날 수 있으니, 지출을 조정하거나 수금을
        서두르는 판단이 필요합니다.
      </>
    );
  } else if (runwayMonths > 0 && runwayMonths < 3) {
    line3 = (
      <>
        현재 고정비 기준으로 {hl(`약 ${runwayMonths.toFixed(1)}개월`, "danger")} 버틸 수 있는
        수준이라 여유가 많지는 않습니다.
      </>
    );
  } else if (runwayMonths >= 6) {
    line3 = (
      <>
        현재 고정비 기준으로 {hl(`${Math.floor(runwayMonths)}개월 이상`, "success")} 버틸 수 있어
        자금 여력은 안정적입니다.
      </>
    );
  } else if (runwayMonths >= 3) {
    line3 = (
      <>
        현재 고정비 기준으로 {hl(`약 ${runwayMonths.toFixed(1)}개월분`)} 자금이 확보되어 있습니다.
      </>
    );
  }

  // 4문장: 해야 할 일 (최대 1개만) — 건수·미수금 강조
  const actionParts: ReactNode[] = [];
  if (pendingApprovals > 0) {
    actionParts.push(<>승인을 기다리는 건이 {hl(`${pendingApprovals}건`)} 있습니다</>);
  }
  if (riskCount > 0) {
    actionParts.push(<>주의가 필요한 프로젝트가 {hl(`${riskCount}건`, "danger")} 잡혀 있습니다</>);
  }
  if (arOver30 > 0) {
    actionParts.push(
      <>30일 넘게 밀린 미수금 {hl(`${formatKrwWords(arOver30)}원`, "danger")}이 남아 있습니다</>,
    );
  }
  const shownActions = actionParts.slice(0, 2);
  const line4: ReactNode =
    actionParts.length > 0 ? (
      <>
        오늘은{" "}
        {shownActions.map((p, i) => (
          <span key={i}>
            {i > 0 && ", 그리고 "}
            {p}
          </span>
        ))}
        . 먼저 살펴보시는 것을 권해 드립니다.
      </>
    ) : (
      "오늘은 긴급하게 결정해야 할 사안은 없습니다. 평소대로 진행하셔도 좋습니다."
    );

  // 부가 라인: 월 매출 진척 (있을 때만) — 달성률 강조(100%+=초록)
  let progressLine: ReactNode = "";
  if (monthTarget > 0) {
    const pct = Math.round((monthRevenue / monthTarget) * 100);
    if (pct >= 100) {
      progressLine = <>이번 달 목표 매출은 이미 {hl(`${pct}%`, "success")} 달성했습니다.</>;
    } else if (pct >= 70) {
      progressLine = <>이번 달 목표 매출의 {hl(`${pct}%`)}까지 올라왔습니다.</>;
    } else {
      progressLine = <>이번 달 목표 매출은 현재 {hl(`${pct}%`)} 진행 중입니다.</>;
    }
  }

  // 어제 거래 요약 섹션 (그랜터 AI 브리핑 스타일)
  const hasTx = yesterdayTx && (yesterdayTx.incomeCount > 0 || yesterdayTx.expenseCount > 0);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayLabel = formatTodayKorean(yesterdayDate);

  const hasExtra = Boolean(line3 || progressLine || hasTx);

  return (
    <section className="morning-brief-card mb-6 glass-card p-4 sm:p-6 md:p-8">
      <p className="text-xs sm:text-sm text-[var(--text-dim)] mb-2">
        {today} · {companyName}
      </p>

      <div className="space-y-1.5 sm:space-y-3 text-sm sm:text-base md:text-[17px] text-[var(--text)] leading-[1.6] sm:leading-[1.85] tracking-[-0.01em] break-keep">
        {briefPlan ? (
          /* ── AI 브리핑 2.0: 오늘의 액션 플랜 ── */
          <div className="brief-plan">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)]">✦ AI 액션 플랜</span>
              <button type="button" onClick={regenerateBrief} disabled={regenerating}
                className="text-[10px] text-[var(--text-dim)] hover:text-[var(--primary)] font-semibold disabled:opacity-50"
                title="지금 데이터로 브리핑을 다시 생성합니다">
                {regenerating ? "생성 중…" : "↻ 다시 생성"}
              </button>
            </div>
            <p className="text-base sm:text-lg font-extrabold leading-snug mb-1.5">{briefPlan.headline}</p>
            <p className="text-[13px] sm:text-[15px] text-[var(--text-muted)] leading-relaxed">{renderTagged(briefPlan.summary)}</p>

            {briefPlan.actions.length > 0 && (
              <ol className="brief-action-list">
                {briefPlan.actions.map((a, i) => {
                  const lk = ACTION_HREF[a.link];
                  return (
                    <li key={i} className="brief-action-item">
                      <span className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${PRIORITY_STYLE[a.priority] || PRIORITY_STYLE["권장"]}`}>{a.priority}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] sm:text-[14px] font-bold leading-snug">{i + 1}. {a.title}</span>
                        <span className="block text-[11px] sm:text-[12px] text-[var(--text-dim)] mt-0.5 leading-relaxed">{a.detail}</span>
                      </span>
                      {lk && (
                        <Link href={lk.href} className="shrink-0 self-center text-[11px] font-semibold text-[var(--primary)] hover:underline whitespace-nowrap">
                          {lk.label} →
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {(briefPlan.risks.length > 0 || briefPlan.wins.length > 0) && (
              <div className="mt-3 flex flex-col gap-1">
                {briefPlan.risks.slice(0, 3).map((r, i) => (
                  <p key={`r${i}`} className="text-[11px] sm:text-[12px] text-[var(--text-muted)] leading-relaxed">
                    <span className="font-bold text-[var(--danger)]">⚠ </span>{renderTagged(r)}
                  </p>
                ))}
                {briefPlan.wins.slice(0, 2).map((w, i) => (
                  <p key={`w${i}`} className="text-[11px] sm:text-[12px] text-[var(--text-muted)] leading-relaxed">
                    <span className="font-bold text-[var(--success)]">✓ </span>{renderTagged(w)}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : aiBrief ? (
          /* 구버전 캐시(평문 단락) 호환 */
          <>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)]">✦ AI 브리핑</span>
            {aiBrief.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((s, i) => (
              <p key={i}>{renderTagged(s)}</p>
            ))}
          </>
        ) : (
          <>
            <p>{line1}</p>
            <p>{line2}</p>
            {/* 모바일: 데스크톱처럼 항상 펼치지 않고, 펼치기 버튼으로 열기 (카드 과점유 방지) */}
            <div className={expanded ? "block" : "hidden sm:block"}>
              {line3 && <p className="mb-1.5 sm:mb-0">{line3}</p>}
              {progressLine && (
                <p className="text-[var(--text-muted)]">{progressLine}</p>
              )}
            </div>
          </>
        )}

        {/* 어제 거래 요약 — AI 브리핑 */}
        <div className={expanded ? "block" : "hidden sm:block"}>
        {hasTx && (
          <div
            className="brief-yesterday-tx"
          >
            <p className="text-sm font-semibold text-[var(--text-muted)] mb-3">
              {yesterdayLabel} 거래 요약
            </p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="rounded-xl p-3 text-center bg-[var(--bg-surface)]">
                <div className="text-xs text-[var(--text-muted)] mb-1">입금</div>
                <div className="text-sm font-bold text-[var(--success)]">
                  {yesterdayTx!.incomeCount}건
                </div>
                <div className="text-xs font-medium text-[var(--success)]">
                  +{formatKrwWords(yesterdayTx!.incomeTotal)}
                </div>
              </div>
              <div className="rounded-xl p-3 text-center bg-[var(--bg-surface)]">
                <div className="text-xs text-[var(--text-muted)] mb-1">출금</div>
                <div className="text-sm font-bold text-[var(--danger)]">
                  {yesterdayTx!.expenseCount}건
                </div>
                <div className="text-xs font-medium text-[var(--danger)]">
                  -{formatKrwWords(yesterdayTx!.expenseTotal)}
                </div>
              </div>
              <div className="rounded-xl p-3 text-center bg-[var(--bg-surface)]">
                <div className="text-xs text-[var(--text-muted)] mb-1">순유입</div>
                <div className={`text-sm font-bold`} style={{ color: yesterdayTx!.netFlow >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {yesterdayTx!.netFlow >= 0 ? "+" : ""}{formatKrwWords(yesterdayTx!.netFlow)}
                </div>
              </div>
            </div>

            {/* 주요 거래 목록 */}
            {yesterdayTx!.topItems.length > 0 && (
              <div className="brief-tx-item-list">
                {yesterdayTx!.topItems.map((item, i) => (
                  <div
                    key={i}
                    className="brief-tx-item"
                  >
                    <span className="text-[var(--text-muted)] truncate max-w-[60%]">
                      {item.counterparty || item.description || "미분류"}
                      {item.category && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--primary-light)] text-[var(--primary)]">
                          {item.category}
                        </span>
                      )}
                    </span>
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: item.type === 'income' ? "var(--success)" : "var(--danger)" }}
                    >
                      {item.type === 'income' ? '+' : '-'}{formatKrwWords(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        {/* 규칙 브리핑일 때만 액션 라인 노출 — AI 브리핑은 본문에 이미 행동 제안을 포함 */}
        {!aiBrief && (
          <p
            className="pt-3 mt-1 border-t"
            style={{
              borderColor: "var(--border)",
              color: actionParts.length > 0 ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {line4}
          </p>
        )}

        {!aiBrief && !aiBriefingEnabled && (
          <p className="morning-brief-upsell">
            ✦ 매일 아침 AI가 오늘의 우선순위를 액션 플랜으로 정리해 드리는 <b>AI 브리핑</b>은 울트라 요금제 전용입니다.{" "}
            <Link href="/billing" className="text-[var(--primary)] font-semibold hover:underline">업그레이드 →</Link>
          </p>
        )}

        {/* KAIROS H2: 모바일 전용 펼치기/접기 버튼 — 카드 과점유 방지. AI 모드는 어제 요약만 접힘 */}
        {((!aiBrief && hasExtra) || (aiBrief && hasTx)) && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="sm:hidden text-xs text-[var(--primary)] font-semibold mt-1 hover:underline"
          >
            {expanded ? "간단히 보기 ↑" : "자세히 보기 ↓"}
          </button>
        )}
      </div>
    </section>
  );
}

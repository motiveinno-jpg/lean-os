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
}

// ── 문구 헬퍼 ─────────────────────────────────────────

function greetingForHour(hour: number): string {
  if (hour < 5) return "늦은 밤이네요";
  if (hour < 12) return "좋은 아침입니다";
  if (hour < 18) return "오후 브리핑입니다";
  return "저녁 브리핑입니다";
}

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

// ── 본문 ────────────────────────────────────────────

export function MorningBrief({
  userName,
  companyName,
  cashPulse,
  dashboard,
  hasData,
  yesterdayTx,
}: MorningBriefProps) {
  const now = new Date();
  const greeting = greetingForHour(now.getHours());
  const today = formatTodayKorean(now);

  // 데이터 없음 — 온보딩 톤
  if (!hasData || !cashPulse) {
    return (
      <section
        className="mb-6 rounded-2xl border bg-[var(--bg-card)] p-6 md:p-8"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-sm text-[var(--text-dim)] mb-2">{today}</p>
        <h2 className="text-xl md:text-2xl font-bold text-[var(--text)] leading-snug mb-3">
          {greeting}, {userName || "대표"}님.
        </h2>
        <p className="text-base md:text-lg text-[var(--text-muted)] leading-relaxed">
          아직 {companyName || "회사"} 데이터가 충분하지 않습니다.
          <br />
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

  // 1문장: 현재 잔고 + 톤
  const line1 = `오늘 아침 통장에는 ${formatKrwWords(balance)}이 있습니다.`;

  // 2문장: 30일 전망
  let line2 = "";
  const delta30 = forecast30 - balance;
  if (Math.abs(delta30) < balance * 0.02) {
    line2 = "이번 한 달은 들어오는 돈과 나가는 돈이 비슷해서 잔고는 크게 변하지 않을 전망입니다.";
  } else if (delta30 > 0) {
    line2 = `30일 뒤에는 ${formatKrwWords(delta30)} 정도 늘어나 ${formatKrwWords(forecast30)}이 될 것으로 보입니다.`;
  } else {
    line2 = `다만 30일 뒤에는 ${formatKrwWords(-delta30)} 정도 줄어 ${formatKrwWords(forecast30)}이 남을 것으로 보입니다.`;
  }

  // 3문장: 런웨이 / 장기 경고
  let line3 = "";
  if (forecast90 < 0) {
    line3 = "이 속도로는 90일 안에 현금이 바닥날 수 있으니, 지출을 조정하거나 수금을 서두르는 판단이 필요합니다.";
  } else if (runwayMonths > 0 && runwayMonths < 3) {
    line3 = `현재 고정비 기준으로 약 ${runwayMonths.toFixed(1)}개월 버틸 수 있는 수준이라 여유가 많지는 않습니다.`;
  } else if (runwayMonths >= 6) {
    line3 = `현재 고정비 기준으로 ${Math.floor(runwayMonths)}개월 이상 버틸 수 있어 자금 여력은 안정적입니다.`;
  } else if (runwayMonths >= 3) {
    line3 = `현재 고정비 기준으로 약 ${runwayMonths.toFixed(1)}개월분 자금이 확보되어 있습니다.`;
  }

  // 4문장: 해야 할 일 (최대 1개만)
  const actionParts: string[] = [];
  if (pendingApprovals > 0) {
    actionParts.push(`승인을 기다리는 건이 ${pendingApprovals}건 있습니다`);
  }
  if (riskCount > 0) {
    actionParts.push(`주의가 필요한 딜이 ${riskCount}건 잡혀 있습니다`);
  }
  if (arOver30 > 0) {
    actionParts.push(`30일 넘게 밀린 미수금 ${formatKrwWords(arOver30)}원이 남아 있습니다`);
  }
  const line4 =
    actionParts.length > 0
      ? `오늘은 ${actionParts.slice(0, 2).join(", 그리고 ")}. 먼저 살펴보시는 것을 권해 드립니다.`
      : "오늘은 긴급하게 결정해야 할 사안은 없습니다. 평소대로 진행하셔도 좋습니다.";

  // 부가 라인: 월 매출 진척 (있을 때만)
  let progressLine = "";
  if (monthTarget > 0) {
    const pct = Math.round((monthRevenue / monthTarget) * 100);
    if (pct >= 100) {
      progressLine = `이번 달 목표 매출은 이미 ${pct}% 달성했습니다.`;
    } else if (pct >= 70) {
      progressLine = `이번 달 목표 매출의 ${pct}%까지 올라왔습니다.`;
    } else {
      progressLine = `이번 달 목표 매출은 현재 ${pct}% 진행 중입니다.`;
    }
  }

  // 어제 거래 요약 섹션 (그랜터 AI 브리핑 스타일)
  const hasTx = yesterdayTx && (yesterdayTx.incomeCount > 0 || yesterdayTx.expenseCount > 0);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayLabel = formatTodayKorean(yesterdayDate);

  return (
    <section
      className="mb-6 rounded-2xl border bg-[var(--bg-card)] p-6 md:p-8"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm text-[var(--text-dim)] mb-2">
        {today} · {companyName}
      </p>
      <h2 className="text-xl md:text-2xl font-bold text-[var(--text)] leading-snug mb-5">
        {greeting}, {userName || "대표"}님.
      </h2>

      <div className="space-y-3 text-base md:text-[17px] text-[var(--text)] leading-[1.85] tracking-[-0.01em]">
        <p>{line1}</p>
        <p>{line2}</p>
        {line3 && <p>{line3}</p>}
        {progressLine && (
          <p className="text-[var(--text-muted)]">{progressLine}</p>
        )}

        {/* 어제 거래 요약 — AI 브리핑 */}
        {hasTx && (
          <div
            className="mt-4 pt-4 border-t"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm font-semibold text-[var(--text-muted)] mb-3">
              {yesterdayLabel} 거래 요약
            </p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--bg-surface)" }}>
                <div className="text-xs text-[var(--text-muted)] mb-1">입금</div>
                <div className="text-sm font-bold" style={{ color: "var(--success)" }}>
                  {yesterdayTx!.incomeCount}건
                </div>
                <div className="text-xs font-medium" style={{ color: "var(--success)" }}>
                  +{formatKrwWords(yesterdayTx!.incomeTotal)}
                </div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--bg-surface)" }}>
                <div className="text-xs text-[var(--text-muted)] mb-1">출금</div>
                <div className="text-sm font-bold" style={{ color: "var(--danger)" }}>
                  {yesterdayTx!.expenseCount}건
                </div>
                <div className="text-xs font-medium" style={{ color: "var(--danger)" }}>
                  -{formatKrwWords(yesterdayTx!.expenseTotal)}
                </div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--bg-surface)" }}>
                <div className="text-xs text-[var(--text-muted)] mb-1">순유입</div>
                <div className={`text-sm font-bold`} style={{ color: yesterdayTx!.netFlow >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {yesterdayTx!.netFlow >= 0 ? "+" : ""}{formatKrwWords(yesterdayTx!.netFlow)}
                </div>
              </div>
            </div>

            {/* 주요 거래 목록 */}
            {yesterdayTx!.topItems.length > 0 && (
              <div className="space-y-1.5">
                {yesterdayTx!.topItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg"
                    style={{ background: "var(--bg-surface)" }}
                  >
                    <span className="text-[var(--text-muted)] truncate max-w-[60%]">
                      {item.counterparty || item.description || "미분류"}
                      {item.category && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
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

        <p
          className="pt-3 mt-1 border-t"
          style={{
            borderColor: "var(--border)",
            color: actionParts.length > 0 ? "var(--text)" : "var(--text-muted)",
          }}
        >
          {line4}
        </p>
      </div>
    </section>
  );
}

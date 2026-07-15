"use client";

// 경영흐름 월별표 — 지표(행) 클릭 설명 팝오버.
//   테이블은 overflow-x-auto + sticky 셀이고 .glass-card 의 backdrop-filter 가
//   position:fixed 자식의 containing block 을 만들어 클리핑되므로, 팝오버는
//   document.body 로 포털 렌더 + 버튼 rect 기준 뷰포트 좌표 배치로 클리핑을 회피한다.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 각 행 key → 사용자용 설명. cash-budget / 세금계산서 집계 소스와 동일한 정의를 평문으로 옮김.
export const ROW_TIPS: Record<string, { title: string; body: string }> = {
  incomeTotal: { title: "수입 총액", body: "그 달에 들어온 돈 전체입니다. 매출 + 보조금/지원금 + 대표 가수금 + 기타 수입을 모두 더한 값이에요." },
  salesRevenue: { title: "매출", body: "발행된 매출 세금계산서 기준 금액(공급가액 + 부가세)입니다. 실제 통장 입금이 아니라 '매출로 잡힌' 금액이라, 미수금이 있으면 통장 잔액과 차이가 날 수 있어요." },
  subsidies: { title: "보조금/지원금", body: "정부·기관 지원금 등 매출이 아닌 수입입니다. 수입 총액에는 포함되지만 매출·영업이익 판단에서는 분리해서 봐야 합니다." },
  ownerInjection: { title: "대표 가수금", body: "대표가 회사 통장에 넣은 돈(가수금)입니다. 실제 벌어들인 수입이 아니라 자금을 메운 것이라, 자금흐름에는 잡히지만 이익으로 오해하면 안 됩니다." },
  otherIncome: { title: "기타 수입", body: "이자·환급·잡수입 등 위 항목에 속하지 않는 수입입니다." },
  expenseTotal: { title: "지출 총액", body: "그 달에 나간 돈 전체입니다. 고정비 + 변동비를 더한 값이에요." },
  fixedCosts: { title: "고정비", body: "매달 비슷하게 나가는 정기 지출입니다. 등록된 정기지출(구독·임차료 등)과 고정비 항목에서 자동 집계됩니다. 매출이 0이어도 나가는 비용이에요." },
  variableCosts: { title: "변동비", body: "매출·활동에 따라 달라지는 지출입니다. 정기지출이 아닌 지급건과 카드 사용액에서 집계됩니다." },
  vat: { title: "부가세 (분기 신고)", body: "그 분기의 매출세액에서 매입세액을 뺀 실제 납부(또는 환급) 예상액입니다. 신고하는 달(1·4·7·10월)에 몰아서 표기됩니다. +면 납부, −면 환급이에요." },
  netProfit: { title: "순이익 (수입−지출)", body: "그 달 수입 총액에서 지출 총액을 뺀 금액입니다. 회계상 세밀한 손익이 아니라 자금 기준의 남은 돈이에요." },
  opMargin: { title: "영업이익률", body: "순이익 ÷ 수입 총액 × 100. 100원 벌어 몇 원이 남았는지 보는 비율입니다. 높을수록 수익성이 좋아요." },
  cumNet: { title: "자금수지 누적 (YTD)", body: "1월부터 그 달까지 매달 순이익(수입−지출)을 계속 더한 누계입니다. 올해 들어 지금까지 자금이 얼마나 쌓였는지(또는 빠졌는지) 보여줍니다." },
  bankBalance: { title: "통장 월말잔액", body: "그 달 말 실제 통장 잔액입니다. 연동된 계좌에서 자동으로 가져옵니다." },
  gap: { title: "누적순익 − 통장 차액", body: "장부상 쌓인 누적 순이익과 실제 통장 잔액의 차이입니다. 차이가 크면 대표 가수금·미반영 거래·인출 등 장부에 안 잡힌 자금 이동이 있다는 신호라 점검이 필요해요." },
  bep: { title: "손익분기점(BEP) 매출", body: "그 달 고정비를 회수해 본전이 되는 데 필요한 최소 매출입니다. 고정비 ÷ 공헌이익률(=(매출−변동비)/매출)로 계산됩니다." },
  bepRate: { title: "BEP 달성률", body: "실제 매출 ÷ 손익분기점 매출 × 100. 100%를 넘으면 그 달 고정비를 다 회수하고 이익이 났다는 뜻입니다." },
};

export function MetricInfo({ rowKey }: { rowKey: string }) {
  const tip = ROW_TIPS[rowKey];
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  if (!tip) return null;

  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 280;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
    const top = Math.min(r.bottom + 6, window.innerHeight - 8);
    setPos({ top, left });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={`${tip.title} 설명`}
        className="metric-info-trigger ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--border)] text-[9px] font-bold leading-none text-[var(--text-dim)] hover:text-[var(--primary)] hover:border-[var(--primary)] transition align-middle"
      >
        ?
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setPos(null)} />
          <div
            className="metric-info-popover fixed z-[999] w-[280px] max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-3 animate-[slide-in_0.12s_ease]"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[13px] font-bold text-[var(--text)] mb-1">{tip.title}</div>
            <div className="text-[12px] leading-relaxed text-[var(--text-muted)]">{tip.body}</div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

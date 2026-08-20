"use client";
import { Ico } from "@/components/ui-icon";

// /demo — 실화면 대조 후 재작성한 패널 (2026-07-28).
//   ⚠️ 아래 4개는 프로덕션 실화면(관리자 계정)을 직접 열어 구조를 대조하고 다시 만든 것이다.
//      하위 탭 / 내부 탭 / 요약 카드 라벨 / 표 컬럼 / 안내 배너 위치까지 실제와 같게 맞췄다.
//      값(거래처명·금액·직원명)만 데모용 가상 데이터로 바꿨다 — 실계정 값은 공개하면 안 된다.
//   ⚠️ 실화면이 바뀌면 여기도 같이 고칠 것. 근거 라우트:
//        분석      → src/app/(app)/reports          (경영 요약 | 손익 현황 | 자금 전망 | 회계 자료)
//        거래 장부 → src/app/(app)/transactions     (자동 분류 | 입금 매칭 → 미분류 정리 | 분류 규칙)
//        세금·증빙 → src/app/(app)/tax-invoices     (세금계산서 | 현금영수증 → 매출 | 매입 | 자동발행 | 기간별 집계)
//        정산      → src/app/(app)/partners/reconciliation

function Head({ crumb, title, sub, tabs }: { crumb: string; title: string; sub: string; tabs: string[] }) {
  return (
    <>
      <div className="pp-head">
        <div className="pp-head-l">
          <div className="pp-menu">{crumb}</div>
          <div className="pp-title">{title}</div>
        </div>
      </div>
      <div className="pp-subtabs">
        {tabs.map((t, i) => (
          <span key={t} className={`pp-subtab ${i === 0 ? "pp-subtab-on" : ""}`}>{t}</span>
        ))}
      </div>
      <div className="pp-sub pp-mt">{sub}</div>
    </>
  );
}

// ── 분석 › 경영 요약 (/reports) ───────────────────────────────
export function AnalyticsPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? "—" : x);
  return (
    <section className="pp glass-card" id={before ? "pp-analytics-b" : "pp-analytics"}>
      <Head
        crumb="파이낸스 › 분석"
        title="지금 회사가 괜찮은지 한 화면으로"
        sub="이번 달 손익·통장 잔액·운영 가능 기간과 다가오는 지출을 요약합니다."
        tabs={["경영 요약", "손익 현황", "자금 전망", "회계 자료"]}
      />

      <div className="pp-sub-card pp-mt">
        <div className="pp-menu">이번 달 상태</div>
        <div className="pp-state-line">
          {before
            ? "통장·세금계산서·예산 데이터를 모으는 중이에요."
            : "이번 달 1,300만원 흑자, 통장 잔액 2억 3,040만원 — 현재 지출 속도라면 약 8.2개월 운영 가능합니다."}
        </div>
        <div className="pp-sub">아래 지표는 통장·세금계산서·예산 데이터를 규칙 기반으로 재조합해 자동 계산됩니다.</div>
      </div>

      <div className="pp-grid4 pp-mt">
        <div className="pp-mini pp-mini-ok"><span>이번 달 손익</span><b>{v("+₩13,000,000")}</b><i>매출 − 비용 · 월별 표 →</i></div>
        <div className="pp-mini"><span>이번 달 매출</span><b>{v("₩45,000,000")}</b><i>세금계산서 기준 · 매출 현황 →</i></div>
        <div className="pp-mini"><span>이번 달 비용</span><b>{v("₩32,000,000")}</b><i>지출 합계 · 비용 현황 →</i></div>
        <div className="pp-mini"><span>통장 잔액</span><b>{v("₩230,400,000")}</b><i>월 평균 지출 3,200만원 · 자금 전망 →</i></div>
      </div>

      <div className="pp-grid2 pp-mt">
        <div className="pp-sub-card">
          <div className="pp-sub-t">이번 달 손익 요약</div>
          <div className="pp-grid3">
            <div className="pp-stat"><b>{v("₩45,000,000")}</b><span>매출</span></div>
            <div className="pp-stat"><b>{v("₩32,000,000")}</b><span>비용</span></div>
            <div className="pp-stat"><b>{v("+₩13,000,000")}</b><span>손익</span></div>
          </div>
        </div>
        <div className="pp-sub-card">
          <div className="pp-sub-t">주요 예정 항목</div>
          <div className="pp-payroll">
            <div className="pp-pay-row"><span>부가세 납부 <b className="pp-dim">D-4</b></span><b>{v("₩26,780,000")}</b></div>
            <div className="pp-pay-row"><span>월 고정비</span><b>{v("₩8,636,000")}</b></div>
            <div className="pp-pay-row"><span>30일+ 미수금</span><b>{v("₩12,000,000")}</b></div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 파이낸스 › 거래 장부 (/transactions) ──────────────────────
const LEDGER_ROWS = [
  { n: "(주)하늘건설", d: "2026-07-27", acc: "운영계좌", amt: "+₩12,000,000", io: "in" },
  { n: "블루윙 스튜디오", d: "2026-07-27", acc: "운영계좌", amt: "-₩3,500,000", io: "out" },
  { n: "네이버 광고", d: "2026-07-26", acc: "법인카드", amt: "-₩1,650,000", io: "out" },
  { n: "사무실 월세", d: "2026-07-25", acc: "운영계좌", amt: "-₩1,800,000", io: "out" },
];

export function LedgerPanel({ before = false }: { before?: boolean }) {
  return (
    <section className="pp glass-card" id={before ? "pp-ledger-b" : "pp-ledger"}>
      <Head
        crumb="파이낸스 › 수집·전표"
        title="받아온 자료를 전표로 만들고 계정을 추천합니다"
        sub="미분류 거래를 한 번에 정리하고, 반복되는 건은 규칙으로 남겨요."
        tabs={["자동 분류", "입금 매칭"]}
      />

      <div className="pp-inner-tabs pp-mt">
        <span className="pp-inner-tab pp-inner-tab-on">미분류 정리 ({before ? "128" : "0"})</span>
        <span className="pp-inner-tab">분류 규칙</span>
      </div>

      <div className="pp-notice">
        <span><Ico e="💡" /> 입금 건은 여기서 분류하기보다 <b>거래 매칭</b>에서 세금계산서와 정산하면 미수금 차감·회계 전표가 자동 처리됩니다.</span>
        <span className="pp-btn">거래 매칭에서 정산 →</span>
      </div>

      <div className="pp-filter">
        <span className="pp-chip-on">날짜순 ↓</span>
        <span className="pp-chip-off">거래처순</span>
        <span className="pp-chip-input">거래처 검색</span>
        <span className="pp-btn pp-btn-ai"><Ico e="✦" /> AI 추천 받기</span>
      </div>

      <div className="pp-txlist">
        {LEDGER_ROWS.map((t) => (
          <div key={t.n + t.d} className="pp-tx">
            <span className={`pp-tx-ico ${t.io === "in" ? "pp-tx-in" : "pp-tx-out"}`}>{t.io === "in" ? "↗" : "↘"}</span>
            <span className="pp-tx-body">
              <b>{t.n}</b>
              <i>
                {t.d} · {t.acc}
                {before
                  ? <span className="pp-tag pp-tag-w">미매핑</span>
                  : <span className="pp-tag pp-tag-s">{t.io === "in" ? "외상매출금" : "광고선전비"}<span className="pp-ai">AI</span></span>}
              </i>
            </span>
            <span className={`pp-tx-amt ${t.io === "in" ? "pp-in" : "pp-out"}`}>{t.amt}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 파이낸스 › 세금·증빙 (/tax-invoices) ──────────────────────
const TAX_ROWS = [
  { d: "2026-07-24", no: "20260724-1026072...", p: "(주)하늘건설", item: "사옥 리뉴얼 2차 기성", s: "252,000,000", t: "25,200,000", sum: "277,200,000", st: "발행" },
  { d: "2026-07-22", no: "20260722-1026072...", p: "블루윙 스튜디오", item: "외주 디자인 용역", s: "31,800,000", t: "3,180,000", sum: "34,980,000", st: "발행" },
];

export function TaxRealPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? "—" : x);
  return (
    <section className="pp glass-card" id={before ? "pp-taxr-b" : "pp-taxr"}>
      <Head
        crumb="파이낸스 › 세금·증빙"
        title="매출·매입 세금계산서 내역과 부가세를 관리합니다"
        sub="홈택스와 연동해 매출·매입을 자동으로 수집하고, 계약·입금과 대조해요."
        tabs={["세금계산서", "현금영수증"]}
      />

      <div className="pp-syncbar pp-mt">
        <span>↻ 홈택스 동기화 · {before ? "수집 중" : "연결됨"}</span>
        <span className="pp-btn">+ 세금계산서 등록</span>
      </div>

      <div className="pp-inner-tabs">
        <span className="pp-inner-tab pp-inner-tab-on">매출 ({before ? "…" : "62"})</span>
        <span className="pp-inner-tab">매입 ({before ? "…" : "48"})</span>
        <span className="pp-inner-tab">자동발행</span>
        <span className="pp-inner-tab">기간별 집계</span>
      </div>

      <div className="pp-grid4">
        <div className="pp-mini"><span>조회기간 매출</span><b>{v("₩343,200,000")}</b><i>{before ? "" : "62건 (공급가 ₩312,000,000)"}</i></div>
        <div className="pp-mini"><span>조회기간 매입</span><b>{v("₩48,620,000")}</b><i>{before ? "" : "48건 (공급가 ₩44,200,000)"}</i></div>
        <div className="pp-mini"><span>딜 미연결 건수</span><b>{v("2건")}</b><i>{before ? "" : "전체 110건 중 딜 자동연결 안 됨"}</i></div>
        <div className="pp-mini pp-mini-ok"><span>예상 부가세 납부액</span><b>{v("₩26,780,000")}</b><i>{before ? "" : "납부 예정 (매출세액 − 매입세액)"}</i></div>
      </div>

      <div className="pp-sub-card pp-mt">
        <div className="pp-sub-t"><Ico e="🔎" /> 점검 리포트</div>
        <div className="pp-payroll">
          <div className="pp-pay-row"><span>딜 미연결 <i className="pp-dim">거래/입금 매칭 필요</i></span><b>{v("2건")}</b></div>
        </div>
      </div>

      <div className="pp-section-t">총 {before ? "—" : "110건"} · 공급가액 {v("₩356,200,000")} · 세액 {v("₩35,620,000")}</div>
      <table className="pp-table">
        <thead><tr><th>작성일자</th><th>승인번호</th><th>상호(거래처)</th><th>공급가액</th><th>세액</th><th>상태</th></tr></thead>
        <tbody>
          {TAX_ROWS.map((r) => (
            <tr key={r.d + r.p}>
              <td>{before ? "—" : r.d}</td>
              <td>{before ? "—" : r.no}</td>
              <td className="pp-strong">{before ? "—" : r.p}</td>
              <td className="pp-num">{before ? "—" : "₩" + r.s}</td>
              <td className="pp-num">{before ? "—" : "₩" + r.t}</td>
              <td><span className={`pp-tag ${before ? "pp-tag-n" : r.st === "발행" ? "pp-tag-s" : "pp-tag-w"}`}>{before ? "수집 중" : r.st}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 파이낸스 › 거래 장부 › 입금 매칭 (/partners/reconciliation) ─
const REC_ROWS = [
  { d: "2026-07-24", k: "입금", p: "(주)하늘건설", amt: "₩277,200,000", id: "2026-07-24", ip: "(주)하늘건설", iamt: "₩277,200,000", set: "₩277,200,000", t: "완전 일치", c: "99%" },
  { d: "2026-07-22", k: "입금", p: "메이커스랩", amt: "₩66,000,000", id: "2026-07-20", ip: "메이커스랩", iamt: "₩66,000,000", set: "₩66,000,000", t: "완전 일치", c: "98%" },
  { d: "2026-07-21", k: "입금", p: "한빛 소재", amt: "₩4,200,000", id: "—", ip: "—", iamt: "—", set: "—", t: "계산서 없음", c: "42%" },
];

export function ReconPanel({ before = false }: { before?: boolean }) {
  return (
    <section className="pp glass-card" id={before ? "pp-recon-b" : "pp-recon"}>
      <Head
        crumb="파이낸스 › 수집·전표"
        title="입금과 세금계산서를 맞춰 수금을 확정합니다"
        sub="세 금액이 맞으면 미수금이 차감되고 회계 전표까지 자동으로 만들어져요."
        tabs={["자동 분류", "입금 매칭"]}
      />
      <div className="pp-grid3 pp-mt">
        <div className="pp-mini"><span>매칭 대기</span><b>{before ? "—" : "3건"}</b></div>
        <div className="pp-mini pp-mini-ok"><span>자동 매칭</span><b>{before ? "—" : "2건"}</b></div>
        <div className="pp-mini"><span>확인 필요</span><b>{before ? "—" : "1건"}</b></div>
      </div>
      <div className="pp-section-t">거래 / 계산서 대조 <span className="pp-ai">AI 매칭</span></div>
      <table className="pp-table">
        <thead>
          <tr><th>거래일자</th><th>입금자/거래처</th><th>거래금액</th><th>계산서 금액</th><th>유형</th><th>신뢰도</th></tr>
        </thead>
        <tbody>
          {REC_ROWS.map((r, i) => (
            <tr key={i}>
              <td>{r.d}</td>
              <td className="pp-strong">{r.p}</td>
              <td className="pp-num">{r.amt}</td>
              <td className="pp-num">{before ? "확인 중…" : r.iamt}</td>
              <td><span className={`pp-tag ${before ? "pp-tag-n" : r.t === "완전 일치" ? "pp-tag-s" : "pp-tag-w"}`}>{before ? "대조 중" : r.t}</span></td>
              <td>{before ? "—" : r.c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">
        {before ? "입금과 세금계산서를 맞춰보는 중이에요." : "2건이 완전 일치해 미수금이 차감되고 전표가 만들어졌어요. 1건은 계산서가 없어 확인이 필요해요."}
      </div>
    </section>
  );
}

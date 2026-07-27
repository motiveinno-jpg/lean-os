"use client";

// /demo — AI 자동화 화면 재현 (2026-07-27).
//   랜딩 "AI 자동화"가 텍스트만 나열돼 있어 실제 화면을 붙이기로 했는데, 이 3개는 캡처 소스가 없었다.
//   실제 라우트 대응: /copilot · /dashboard(MorningBrief + 오늘의 액션) · /approvals(경비 영수증 OCR)
//   ⚠️ 실제 화면 구조가 바뀌면 여기와 랜딩 캡처(public/product/f-ai*.png)를 함께 갱신할 것.
//   스타일은 다른 데모 패널과 같은 pp- 클래스 재사용(globals.css).

function PanelHead({ menu, title, sub, right }: { menu: string; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="pp-head">
      <div className="pp-head-l">
        <div className="pp-menu">{menu}</div>
        <div className="pp-title">{title}</div>
        <div className="pp-sub">{sub}</div>
      </div>
      {right}
    </div>
  );
}

// ── AI 참모 (/copilot) ───────────────────────────────────────
export function CopilotPanel() {
  const asks = ["미수금 회수 우선순위를 알려줘", "이번 달 매출·영업 파이프라인 흐름을 봐줘", "다음 달 자금이 버틸까?"];
  return (
    <section className="pp glass-card" id="pp-copilot">
      <PanelHead
        menu="홈 › AI 참모"
        title="물어보면 근거까지 같이 답해요"
        sub="회사 실데이터를 읽고 한 줄 결론과 다음 액션으로 정리해줘요"
        right={<span className="pp-badge pp-badge-p">경영 리스크 · 보통</span>}
      />
      <div className="pp-chatwrap">
        <div className="pp-chan">
          {asks.map((a) => (
            <div key={a} className="pp-chan-row"><span>{a}</span></div>
          ))}
        </div>
        <div className="pp-thread">
          <div className="pp-thread-h">오늘의 우선순위</div>
          <div className="pp-msg pp-msg-me">
            <span className="pp-msg-who">대표</span>
            <p>미수금 회수 우선순위를 알려줘</p>
          </div>
          <div className="pp-msg">
            <span className="pp-msg-who">AI 참모</span>
            <p>
              한빛 소재부터 연락하세요. 30일 넘은 미수금 ₩12,400,000 중 가장 오래됐고,
              직전 3건 모두 독촉 후 5일 안에 입금됐어요.
            </p>
          </div>
          <div className="pp-payroll">
            <div className="pp-pay-row"><span>1. 한빛 소재 · 62일 경과</span><b>₩12,400,000</b></div>
            <div className="pp-pay-row"><span>2. 메이커스랩 · 41일 경과</span><b>₩6,000,000</b></div>
            <div className="pp-pay-row"><span>3. 블루윙 스튜디오 · 33일 경과</span><b>₩3,500,000</b></div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── AI 브리핑 (/dashboard) ───────────────────────────────────
export function BriefPanel() {
  const acts = [
    { p: "긴급", t: "미수금 30일+ ₩1,200만 — 한빛 소재 독촉 필요", tag: "w" },
    { p: "높음", t: "승인대기 ₩850만 — 외주비 2건 검토·승인", tag: "w" },
    { p: "높음", t: "마감 임박 2건 — D-5 이내 납품 확인", tag: "n" },
    { p: "보통", t: "이번 달 순현금 +₩1,300만 예상 — 안정적", tag: "s" },
  ];
  return (
    <section className="pp glass-card" id="pp-brief">
      <PanelHead
        menu="홈 › 대시보드"
        title="아침마다 오늘 할 일을 정리해줘요"
        sub="잔고·미수금·마감을 읽고 챙길 순서대로 알려줘요"
        right={<span className="pp-badge pp-badge-s">07-27 08:00 생성</span>}
      />
      <div className="pp-alert" style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
        좋은 아침이에요, 김대표님. 통장 잔고는 ₩230,400,000, 이번 달 순현금은 +₩13,000,000 예상이에요.
        오늘은 미수금 회수부터 챙기시면 좋겠어요.
      </div>
      <div className="pp-section-t">오늘의 액션</div>
      <div className="pp-payroll">
        {acts.map((a) => (
          <div key={a.t} className="pp-pay-row">
            <span><span className={`pp-tag pp-tag-${a.tag}`}>{a.p}</span> {a.t}</span>
          </div>
        ))}
      </div>
      <div className="pp-grid3 pp-mt">
        <div className="pp-mini"><span>통장 잔고</span><b>₩2.3억</b></div>
        <div className="pp-mini pp-mini-ok"><span>런웨이</span><b>8.2개월</b></div>
        <div className="pp-mini"><span>미수금 30일+</span><b>₩1,200만</b></div>
      </div>
    </section>
  );
}

// ── 영수증 OCR (/approvals) ──────────────────────────────────
export function OcrPanel() {
  const fields = [
    { k: "상호", v: "스타벅스 역삼점", ok: true },
    { k: "사업자번호", v: "220-81-62517", ok: true },
    { k: "결제일시", v: "2026-07-23 14:12", ok: true },
    { k: "공급가액", v: "₩34,545", ok: true },
    { k: "부가세", v: "₩3,455", ok: true },
    { k: "합계", v: "₩38,000", ok: true },
  ];
  return (
    <section className="pp glass-card" id="pp-ocr">
      <PanelHead
        menu="워크스페이스 › 결재 허브 › 경비"
        title="영수증은 찍으면 알아서 읽어요"
        sub="금액·상호·날짜를 인식해 채우고 경비 정산으로 넘겨요"
        right={<span className="pp-badge pp-badge-s">인식률 98%</span>}
      />
      <div className="pp-grid2">
        <div className="pp-sub-card">
          <div className="pp-sub-t">인식한 항목 <span className="pp-ai">AI OCR</span></div>
          <div className="pp-payroll">
            {fields.map((f) => (
              <div key={f.k} className="pp-pay-row"><span>{f.k}</span><b>{f.v}</b></div>
            ))}
          </div>
        </div>
        <div className="pp-sub-card">
          <div className="pp-sub-t">자동으로 채워진 경비 정산서</div>
          <div className="pp-stats">
            <div className="pp-stat"><b>복리후생비</b><span>계정과목 추천</span></div>
            <div className="pp-stat"><b>최민아</b><span>사용자</span></div>
            <div className="pp-stat"><b>₩38,000</b><span>청구 금액</span></div>
            <div className="pp-stat"><b>자동승인</b><span>₩100만 미만</span></div>
          </div>
          <div className="pp-pay-cta">
            <span className="pp-chip-ok">확인만 하면 결재가 올라가요</span>
            <span className="pp-btn">정산 요청</span>
          </div>
        </div>
      </div>
      <div className="pp-alert">사람이 손으로 옮겨 적던 6개 항목을 전부 인식했어요. 틀린 값만 고치면 돼요.</div>
    </section>
  );
}

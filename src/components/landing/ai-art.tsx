// AI 섹션 일러스트 (2026-07-29)
//   사장님: "AI 기능이기 때문에 실제 이미지 사용보다는 이런 식으로 표현하는 게 어때?
//   네가 정확한 좌표를 찍기 어렵다고 해서, 이런 느낌으로 기능 설명하는 게 좋을 것 같아."
//
//   ⚠️ 이건 "설명 그림"이지 앱 화면이 아니다. 실제 화면인 척 브라우저 크롬·사이드바를 씌우지 말 것.
//      대신 쓰는 값(계정과목·금액·메뉴명)은 전부 제품에 실재하는 것만 쓴다 — 지어낸 기능을 그리면
//      그림이 거짓말이 된다.
//   ⚠️ 실제 캡처를 확대해 잘라 쓰던 방식은 버렸다. 기능이 있는 자리가 화면마다 달라
//      어디를 잘라도 설명과 어긋났다(사장님 지적). 그림은 그 기능만 정확히 보여준다.

type Kind =
  | "radar" | "pipeline" | "payroll" | "crm"
  | "copilot" | "classify" | "brief" | "match" | "ocr" | "renew" | "dormant";

export function AiArt({ kind }: { kind: Kind }) {
  return <div className={`lp5-art lp5-art-${kind}`}>{body(kind)}</div>;
}

function body(k: Kind) {
  switch (k) {
    // ── 엔진 ──
    case "radar":
      return (
        <>
          <ArtHead t={"현금이 언제 마르는지"} s={"통장·카드를 연결하면 90일 뒤까지 예측해요."} />
          <div className="lp5-art-card lp5-art-chart">
            <div className="lp5-art-row"><span>운영 가능 기간</span><b>8.2개월</b></div>
            <svg viewBox="0 0 240 72" preserveAspectRatio="none" className="lp5-art-line">
              <defs><linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4F46E5" stopOpacity=".18" />
                <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
              </linearGradient></defs>
              <path d="M0 14 L60 26 L120 38 L180 52 L240 62 L240 72 L0 72 Z" fill="url(#ag1)" />
              <path d="M0 14 L60 26 L120 38 L180 52 L240 62" fill="none" stroke="#4F46E5" strokeWidth="2" />
              <circle cx="180" cy="52" r="3.5" fill="#fff" stroke="#4F46E5" strokeWidth="2" />
            </svg>
            <span className="lp5-art-flag lp5-art-flag-warn">D+60 · 자금 부족 주의</span>
          </div>
        </>
      );
    case "pipeline":
      return (
        <>
          <ArtHead t={"견적이 승인되면\n계약서가 따라와요"} s={"입금 매칭까지 한 흐름으로 이어져요."} />
          <div className="lp5-art-steps">
            {[["견적서", "승인"], ["계약서", "자동 생성"], ["입금", "자동 매칭"]].map(([a, b], i) => (
              <div key={a} className={`lp5-art-step ${i === 1 ? "lp5-art-step-on" : ""}`}>
                <b>{a}</b><span>{b}</span>
              </div>
            ))}
          </div>
        </>
      );
    case "payroll":
      return (
        <>
          <ArtHead t={"4대보험·원천세는\n알아서 계산돼요"} s={"승인하면 명세서가 전 직원에게 나가요."} />
          <div className="lp5-art-card">
            {[["국민연금", "4.5%"], ["건강보험", "3.545%"], ["고용보험", "0.9%"]].map(([a, b]) => (
              <div key={a} className="lp5-art-row"><span>{a}</span><b>{b}</b></div>
            ))}
            <div className="lp5-art-row lp5-art-row-total"><span>실지급액</span><b>₩49,900,000</b></div>
          </div>
        </>
      );
    case "crm":
      return (
        <>
          <ArtHead t={"거래처마다 기록이\n저절로 쌓여요"} s={"프로젝트·계약·매출 이력이 자동으로 연결돼요."} />
          <div className="lp5-art-stack">
            <span className="lp5-art-chip">프로젝트 3건</span>
            <span className="lp5-art-chip">계약 2건</span>
            <div className="lp5-art-card lp5-art-front">
              <div className="lp5-art-row"><span>(주)하늘건설</span><b>누적 ₩277,200,000</b></div>
            </div>
          </div>
        </>
      );

    // ── 자동화 ──
    case "copilot":
      return (
        <>
          <ArtHead t={"물어보면 근거까지\n같이 답해요"} s={"회사 실데이터를 읽고 지금 할 일을 알려줘요."} />
          <div className="lp5-art-ask">지금 뭐부터 챙겨야 해?</div>
          <div className="lp5-art-card lp5-art-answer">
            <b>미수금 회수가 먼저예요.</b>
            <p>30일 넘은 건이 1건, ₩12,000,000 이에요.</p>
            <span className="lp5-art-flag">거래 장부로 이동 →</span>
          </div>
        </>
      );
    case "classify":
      return (
        <>
          <ArtHead t={"계정과목을 대신\n골라줘요"} s={"통장·카드 거래를 읽고 부가세 구분까지 지정해요."} />
          <div className="lp5-art-stack">
            <span className="lp5-art-band lp5-art-band-a">복리후생비</span>
            <span className="lp5-art-band lp5-art-band-b">지급수수료</span>
            <div className="lp5-art-card lp5-art-front">
              <div className="lp5-art-row"><span>AWS 클라우드</span><b>-₩1,240,000</b></div>
              <span className="lp5-art-flag">통신비 · 매입세액 공제</span>
            </div>
          </div>
        </>
      );
    case "brief":
      return (
        <>
          <ArtHead t={"오늘 뭐부터 할지\n순서대로 정리해요"} s={"아침마다 잔고·미수금·마감을 읽어요."} />
          <div className="lp5-art-card">
            {[["1", "미수금 30일+ 1건 독촉"], ["2", "승인 대기 결재 5건"], ["3", "부가세 예정신고 D-4"]].map(([n, t]) => (
              <div key={n} className="lp5-art-rank"><i>{n}</i><span>{t}</span></div>
            ))}
          </div>
        </>
      );
    case "match":
      return (
        <>
          <ArtHead t={"세 금액이 맞는지\n대신 맞춰봐요"} s={"맞으면 전표까지 만들어 둬요."} />
          <div className="lp5-art-three">
            {["계약", "세금계산서", "입금"].map((t) => (
              <div key={t} className="lp5-art-mini"><span>{t}</span><b>₩277,200,000</b></div>
            ))}
          </div>
          <span className="lp5-art-flag lp5-art-flag-ok">세 금액이 모두 일치해요</span>
        </>
      );
    case "ocr":
      return (
        <>
          <ArtHead t={"영수증은 찍으면\n알아서 읽어요"} s={"금액·상호·날짜를 채워 경비 정산으로 넘겨요."} />
          <div className="lp5-art-card">
            {[["상호", "스타벅스"], ["사업자번호", "220-81-62517"], ["결제일시", "2026-07-23"]].map(([a, b]) => (
              <div key={a} className="lp5-art-row"><span>{a}</span><b>{b}</b></div>
            ))}
            <span className="lp5-art-flag lp5-art-flag-ok">6개 항목 자동 인식</span>
          </div>
        </>
      );
    case "dormant":
      return (
        <>
          <ArtHead t={"조용해진 거래처를\n찾아줘요"} s={"한동안 움직임이 없는 프로젝트·거래처를 골라 알려줘요."} />
          <div className="lp5-art-card">
            <div className="lp5-art-row lp5-art-row-mute"><span>(주)미래테크</span><b>최근 거래 92일 전</b></div>
            <div className="lp5-art-row lp5-art-row-mute"><span>C사 전략 컨설팅</span><b>활동 없음 41일</b></div>
            <span className="lp5-art-flag">리마인더 보내기</span>
          </div>
        </>
      );
    case "renew":
      return (
        <>
          <ArtHead t={"만료 전에 먼저\n알려줘요"} s={"계약 갱신을 놓치지 않게 담당자에게 알림이 가요."} />
          <div className="lp5-art-card">
            <div className="lp5-art-row"><span>유지보수 계약</span><b className="lp5-art-dday">D-14</b></div>
            <div className="lp5-art-row"><span>연봉계약서</span><b className="lp5-art-dday">D-30</b></div>
            <span className="lp5-art-flag">담당자에게 알림 예약됨</span>
          </div>
        </>
      );
  }
}

function ArtHead({ t, s }: { t: string; s: string }) {
  return (
    <div className="lp5-art-head">
      <b>{t.split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}</b>
      <p>{s}</p>
    </div>
  );
}

/** 항목 이름 → 그림 종류. content.ts 를 건드리지 않고 여기서만 잇는다. */
export const AI_ART: Record<string, Kind> = {
  "생존 레이더": "radar",
  "원클릭 파이프라인": "pipeline",
  "AI 인사/총무팀": "payroll",
  "거래처 자산화": "crm",
  "AI 참모": "copilot",
  "AI 거래 분류": "classify",
  "AI 브리핑": "brief",
  "3-Way 자동 매칭": "match",
  "영수증 OCR": "ocr",
  "휴면 감지": "dormant",
  "계약 갱신 알림": "renew",
};

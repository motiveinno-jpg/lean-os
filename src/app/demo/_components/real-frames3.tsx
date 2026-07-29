"use client";

// /demo — 실화면 대조 후 재작성한 패널 3차 (2026-07-28). 이걸로 랜딩에 쓰는 화면은 전부 실물 기준이 된다.
//   ⚠️ 프로덕션 실계정으로 라우트를 직접 열어 탭·필터·요약 카드·표 컬럼을 옮겼다.
//      값(거래처명·금액·직원명)만 데모용 가상 데이터다 — 실계정 값은 공개하면 안 된다.
//   근거 라우트:
//     자금 전망 → /reports/outlook (경영 요약|손익 현황|자금 전망|회계 자료 → 예정 지출|운영 가능·시나리오)
//     급여      → /employees (인력관리|급여|증명서 발급)
//     거래처    → /partners     전표입력 → /partners/reconciliation/voucher-entry
//     일정      → /schedule     게시판   → /board      메신저 → /chat
//     서식      → /hr-templates 보관함  → /documents
//     AI 브리핑 → /dashboard (AI 액션 플랜)  영수증 OCR → /approvals

import { AreaTrend } from "@/app/(app)/reports/flow/_components/AreaTrend";
import { Ico } from "@/components/ui-icon";

function Head({ crumb, title, sub, tabs, active = 0 }: { crumb: string; title: string; sub: string; tabs: string[]; active?: number }) {
  return (
    <>
      <div className="pp-head">
        <div className="pp-head-l">
          <div className="pp-menu">{crumb}</div>
          <div className="pp-title">{title}</div>
        </div>
      </div>
      {tabs.length > 0 && (
        <div className="pp-subtabs">
          {tabs.map((t, i) => (
            <span key={t} className={`pp-subtab ${i === active ? "pp-subtab-on" : ""}`}>{t}</span>
          ))}
        </div>
      )}
      <div className="pp-sub pp-mt">{sub}</div>
    </>
  );
}
const D = "—";

// 실제 자금 전망 화면이 쓰는 차트 컴포넌트를 그대로 가져다 쓴다 — 재현이 아니라 같은 컴포넌트다.
//   ⚠️ 막대 그래프로 흉내 내지 말 것. 실제는 얇은 라인 + 옅은 그라데이션 면적 + 점선 오늘 마커다.

// ── 분석 › 자금 전망 (/reports/outlook) ───────────────────────
export function OutlookPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const pts = [
    { label: "오늘", value: 230_400_000 },
    { label: "D+7", value: 214_000_000 },
    { label: "D+30", value: 192_000_000 },
    { label: "D+60", value: 163_000_000 },
    { label: "D+90", value: 141_000_000 },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-outlook-b" : "pp-outlook"}>
      <Head
        crumb="파이낸스 › 분석"
        title="현재 지출 속도라면 얼마나 버티는지"
        sub="오늘부터 90일까지 통장 잔액을 예측하고, 지출이 바뀌면 어떻게 달라지는지 같이 봐요."
        tabs={["경영 요약", "손익 현황", "자금 전망", "회계 자료"]}
        active={2}
      />
      <div className="pp-inner-tabs pp-mt">
        <span className="pp-inner-tab">예정 지출</span>
        <span className="pp-inner-tab pp-inner-tab-on">운영 가능·시나리오</span>
      </div>

      <div className="pp-sub-card">
        <div className="pp-state-line">
          {before ? "통장·지출 데이터를 모으는 중이에요." : "현재 지출 속도(월 약 3,200만원)라면 약 8.2개월 운영할 수 있어요."}
        </div>
        <div className="pp-sub">{before ? "" : "가용 현금 ₩230,400,000 기준 · 90일 내 자금 부족 없음 🟢"}</div>
      </div>

      <div className="pp-section-t">현금 잔액 전망 <i className="pp-dim">오늘부터 90일</i></div>
      {before ? (
        <div className="pp-chart-empty">잔액을 예측하는 중이에요…</div>
      ) : (
        <AreaTrend points={pts} height={150} markerIndex={0} showValues />
      )}

      <div className="pp-grid3">
        <div className="pp-mini pp-mini-ok"><span>현 수준 유지</span><b>{v("8.2개월")}</b></div>
        <div className="pp-mini"><span>지출 10% 증가</span><b>{v("7.5개월")}</b></div>
        <div className="pp-mini"><span>지출 10% 감소</span><b>{v("9.1개월")}</b></div>
      </div>
    </section>
  );
}

// ── 인사관리 › 급여 (/employees › 급여) ───────────────────────
export function PayrollPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const rows = [
    { n: "김대표", base: "₩6,000,000", ins: "₩540,000", tax: "₩380,000", net: "₩5,080,000" },
    { n: "박서연", base: "₩4,200,000", ins: "₩378,000", tax: "₩190,000", net: "₩3,632,000" },
    { n: "이준호", base: "₩3,800,000", ins: "₩342,000", tax: "₩160,000", net: "₩3,298,000" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-payroll-b" : "pp-payroll"}>
      <Head
        crumb="인사관리 › 급여"
        title="4대보험·원천세는 알아서 계산돼요"
        sub="요율이 자동으로 적용되고, 승인하면 명세서가 전 직원에게 나가요."
        tabs={["인력관리 12", "급여", "증명서 발급"]}
        active={1}
      />
      <div className="pp-grid4 pp-mt">
        <div className="pp-mini"><span>지급 총액</span><b>{v("₩58,400,000")}</b></div>
        <div className="pp-mini"><span>4대보험 (회사부담)</span><b>{v("₩5,320,000")}</b></div>
        <div className="pp-mini"><span>원천징수</span><b>{v("₩3,180,000")}</b></div>
        <div className="pp-mini pp-mini-ok"><span>실지급액</span><b>{v("₩49,900,000")}</b></div>
      </div>
      <div className="pp-section-t">7월 급여 배치</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>기본급</th><th>4대보험</th><th>원천세</th><th>실지급</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td className="pp-num">{v(r.base)}</td>
              <td className="pp-num">{v(r.ins)}</td>
              <td className="pp-num">{v(r.tax)}</td>
              <td className="pp-num">{v(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-pay-cta">
        <span className="pp-chip-ok">{before ? "요율 적용 중" : "자동 계산 완료 · 국민연금 4.5% · 건보 3.545% · 고용 0.9%"}</span>
        <span className="pp-btn">명세서 12명 발송</span>
      </div>
    </section>
  );
}

// ── 파이낸스 › 거래처 (/partners) ─────────────────────────────
//   실제 표 컬럼: 코드 · 이름 · 구분 · 사업자번호 · 담당자 · 연락처 · 태그 · 상태
export function PartnersRealPanel({ before = false }: { before?: boolean }) {
  const rows = [
    { c: "P-0001", n: "(주)하늘건설", k: "고객사", b: "123-81-45678", m: "김상무", tel: "02-555-1234", tag: "VIP" },
    { c: "P-0002", n: "블루윙 스튜디오", k: "공급업체", b: "220-88-10293", m: "박대표", tel: "02-777-3311", tag: "외주" },
    { c: "P-0003", n: "정우 엔지니어링", k: "고객사", b: "514-86-77120", m: "이부장", tel: "031-220-8800", tag: "-" },
    { c: "P-0004", n: "한빛 소재", k: "공급업체", b: "301-81-55014", m: "최과장", tel: "032-410-2200", tag: "휴면" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-partr-b" : "pp-partr"}>
      <Head
        crumb="파이낸스 › 거래처"
        title="거래처마다 기록이 쌓여요"
        sub="프로젝트·계약·매출 이력이 거래처에 자동으로 연결돼요."
        tabs={["거래처 관리", "거래처 원장"]}
      />
      <div className="pp-grid3 pp-mt">
        <div className="pp-mini"><span>고객사</span><b>{before ? D : "412"}</b></div>
        <div className="pp-mini"><span>공급업체</span><b>{before ? D : "272"}</b></div>
        <div className="pp-mini"><span>90일 무거래</span><b>{before ? D : "38"}</b></div>
      </div>
      <table className="pp-table">
        <thead><tr><th>코드</th><th>이름</th><th>구분</th><th>사업자번호</th><th>담당자</th><th>연락처</th><th>태그</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c}>
              <td>{r.c}</td>
              <td className="pp-strong">{r.n}</td>
              <td><span className={`pp-tag ${r.k === "고객사" ? "pp-tag-s" : "pp-tag-n"}`}>{r.k}</span></td>
              <td>{r.b}</td>
              <td>{before ? D : r.m}</td>
              <td>{before ? D : r.tel}</td>
              <td>{before ? D : <span className={`pp-tag ${r.tag === "휴면" ? "pp-tag-w" : "pp-tag-n"}`}>{r.tag}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">90일 넘게 거래가 없는 거래처 38곳을 찾았어요. 담당자에게 리마인더를 보낼 수 있어요.</div>
    </section>
  );
}

// ── 파이낸스 › 전표입력 (/partners/reconciliation/voucher-entry) ─
//   실제 표 컬럼: No · 구분 · 계정과목 · 거래처 · 적요 · 차변 · 대변
export function VoucherRealPanel({ before = false }: { before?: boolean }) {
  const rows = [
    { no: 1, k: "차변", ac: "108 외상매출금", p: "(주)하늘건설", memo: "2차 기성 청구", d: "12,000,000", c: "" },
    { no: 2, k: "대변", ac: "401 상품매출", p: "(주)하늘건설", memo: "2차 기성 청구", d: "", c: "10,909,091" },
    { no: 3, k: "대변", ac: "255 부가세예수금", p: "(주)하늘건설", memo: "부가세", d: "", c: "1,090,909" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-vouchr-b" : "pp-vouchr"}>
      <Head
        crumb="파이낸스 › 전표입력"
        title="필요할 땐 직접 입력해요"
        sub="계정과목 사전을 회사에 맞게 관리하고, 수기 전표도 그대로 기장돼요."
        tabs={[]}
      />
      <div className="pp-grid3 pp-mt">
        <div className="pp-mini"><span>전표일자</span><b style={{ fontSize: 14 }}>2026-07-24</b></div>
        <div className="pp-mini"><span>유형</span><b style={{ fontSize: 14 }}>매출 (대체)</b></div>
        <div className="pp-mini pp-mini-ok"><span>차변 = 대변</span><b>{before ? D : "₩12,000,000"}</b></div>
      </div>
      <table className="pp-table">
        <thead><tr><th>No</th><th>구분</th><th>계정과목</th><th>거래처</th><th>적요</th><th>차변</th><th>대변</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no}>
              <td>{r.no}</td>
              <td><span className="pp-tag pp-tag-n">{r.k}</span></td>
              <td className="pp-strong">{r.ac}</td>
              <td>{r.p}</td>
              <td>{r.memo}</td>
              <td className="pp-num">{before ? D : r.d ? "₩" + r.d : ""}</td>
              <td className="pp-num">{before ? D : r.c ? "₩" + r.c : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-pay-cta">
        <span className="pp-chip-ok">계정과목 사전 92개 등록됨</span>
        <span className="pp-btn">전표 저장</span>
      </div>
    </section>
  );
}

// ── 워크스페이스 › 일정 / 할 일 (/schedule) ───────────────────
//   실제: 📅 캘린더 | ✓ 할 일 · 월 네비 · 🏢 전체공유 | 🙋 개인 | 🪟 통합 · + 일정 추가 · 월간 그리드
export function ScheduleRealPanel({ before = false }: { before?: boolean }) {
  const dow = ["일", "월", "화", "수", "목", "금", "토"];
  const ev: Record<number, string[]> = { 21: ["주간 회의"], 22: ["하늘건설 납품"], 24: ["부가세 D-4"], 27: ["급여 이체"] };
  return (
    <section className="pp glass-card" id={before ? "pp-schedr-b" : "pp-schedr"}>
      <Head
        crumb="워크스페이스 › 일정 / 할 일"
        title="회사 일정과 내 할 일을 한 화면에서"
        sub="전체공유 일정은 회사 모든 구성원에게 보이고, 개인 일정은 나만 봐요."
        tabs={["캘린더", "✓ 할 일"]}
      />
      <div className="pp-filter pp-mt">
        <span className="pp-chip-off">‹</span>
        <span className="pp-chip-on">2026년 7월</span>
        <span className="pp-chip-off">›</span>
        <span className="pp-chip-off"><Ico e="🏢" /> 전체공유</span>
        <span className="pp-chip-off"><Ico e="🙋" /> 개인</span>
        <span className="pp-btn pp-btn-ai">+ 일정 추가</span>
      </div>
      <div className="pp-cal7">
        {dow.map((d) => <div key={d} className="pp-cal7-h">{d}</div>)}
        {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`pp-cal7-d ${n === 28 ? "pp-cal7-today" : ""}`}>
            <span>{n}</span>
            {!before && (ev[n] || []).map((e) => <i key={e}>{e}</i>)}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 워크스페이스 › 게시판 (/board) ────────────────────────────
//   실제 필터: 전체 N | 📌 고정 | 📅 일정 | 🗳️ 투표 | 📎 첨부 | 내 글 · + 글쓰기
export function BoardRealPanel({ before = false }: { before?: boolean }) {
  const rows = [
    { t: "7월 급여 지급일 안내", by: "김대표", d: "2026. 7. 24.", att: "1", pin: true },
    { t: "하계 휴가 신청 받습니다", by: "최민아", d: "2026. 7. 22.", att: "투표", pin: true },
    { t: "사무실 정기 방역 (7/27 토)", by: "최민아", d: "2026. 7. 20.", att: "2", pin: false },
    { t: "2분기 실적 공유", by: "김대표", d: "2026. 7. 8.", att: "4", pin: false },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-boardr-b" : "pp-boardr"}>
      <Head
        crumb="워크스페이스 › 게시판"
        title="공지를 한곳에 남겨요"
        sub="고정·일정·투표·첨부로 걸러 볼 수 있고, 누가 읽었는지도 남아요."
        tabs={[]}
      />
      <div className="pp-filter pp-mt">
        <span className="pp-chip-on">전체 {before ? "…" : "11"}</span>
        <span className="pp-chip-off"><Ico e="📌" /> 고정</span>
        <span className="pp-chip-off"><Ico e="📅" /> 일정</span>
        <span className="pp-chip-off"><Ico e="🗳" /> 투표</span>
        <span className="pp-chip-off"><Ico e="📎" /> 첨부</span>
        <span className="pp-chip-off">내 글</span>
        <span className="pp-btn pp-btn-ai">+ 글쓰기</span>
      </div>
      <table className="pp-table">
        <thead><tr><th>제목</th><th>작성자</th><th>첨부</th><th>작성일</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <td className="pp-strong">{r.pin && <span className="pp-tag pp-tag-s"><Ico e="📌" /> 고정</span>} {r.t}</td>
              <td>{before ? D : r.by}</td>
              <td>{before ? D : r.att}</td>
              <td>{before ? D : r.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 워크스페이스 › 메신저 (/chat) ─────────────────────────────
//   실제 좌측: 채널 / 팀 채널 / 프로젝트 / 다이렉트 메시지 (+ 버튼), 우측 대화
export function ChatRealPanel({ before = false }: { before?: boolean }) {
  const groups = [
    { g: "팀 채널", items: ["# 전사 공지", "# 디자인팀"] },
    { g: "프로젝트", items: ["# 하늘건설 리뉴얼", "# 정우 엔지니어링"] },
    { g: "다이렉트 메시지", items: ["@ 박서연"] },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-chatr-b" : "pp-chatr"}>
      <Head
        crumb="워크스페이스 › 메신저"
        title="일하는 자리에서 바로 이야기해요"
        sub="프로젝트마다 전용 채널이 열리고, 외부 파트너도 초대할 수 있어요."
        tabs={[]}
      />
      <div className="pp-chatwrap pp-mt">
        <div className="pp-chan">
          {groups.map((g) => (
            <div key={g.g}>
              <div className="pp-chan-g">{g.g} <b>{before ? 0 : g.items.length}</b></div>
              {(before ? [] : g.items).map((c) => (
                <div key={c} className="pp-chan-row"><span>{c}</span></div>
              ))}
              {before && <div className="pp-chan-row"><span className="pp-dim">불러오는 중…</span></div>}
            </div>
          ))}
        </div>
        <div className="pp-thread">
          <div className="pp-thread-h">＃ 하늘건설 리뉴얼 · 멤버 4명 (파트너 1)</div>
          {before ? (
            <div className="pp-msg"><p className="pp-dim">대화를 불러오는 중이에요…</p></div>
          ) : (
            <>
              <div className="pp-msg"><span className="pp-msg-who">박서연</span><p>하늘건설 2차 시안 올렸어요. 확인 부탁드립니다!</p></div>
              <div className="pp-msg pp-msg-me"><span className="pp-msg-who">김대표</span><p>확인했어요. 계약서 초안까지 바로 넘기죠.</p></div>
            </>
          )}
          <div className="pp-msg-input">메시지를 입력하세요…</div>
        </div>
      </div>
    </section>
  );
}

// ── 인사관리 › 근로계약·서식 (/hr-templates) ──────────────────
//   실제: 서식 | 계약 발송·현황 · + 새 양식 · 서식 목록(미리보기·수정·삭제)
export function TemplatesRealPanel({ before = false }: { before?: boolean }) {
  const tpl = ["표준근로계약서", "포괄임금 근로계약서", "연봉계약서", "비밀유지서약서", "개인정보 수집·이용 동의서"];
  return (
    <section className="pp glass-card" id={before ? "pp-tplr-b" : "pp-tplr"}>
      <Head
        crumb="인사관리 › 근로계약·서식"
        title="근로·연봉계약 등 인사 서식을 만들어 두는 곳"
        sub="한 번 만든 서식을 재사용하고, 직인은 자동으로 합성돼요."
        tabs={["서식", "계약 발송·현황"]}
      />
      <div className="pp-filter pp-mt">
        <span className="pp-chip-on">보유 서식 {before ? "…" : "7"}</span>
        <span className="pp-btn pp-btn-ai">+ 새 양식 ▾</span>
      </div>
      <table className="pp-table">
        <thead><tr><th>서식명</th><th>사용</th><th>수정일</th><th>관리</th></tr></thead>
        <tbody>
          {tpl.map((t, i) => (
            <tr key={t}>
              <td className="pp-strong">{t}</td>
              <td>{before ? D : `${12 - i * 2}회`}</td>
              <td>{before ? D : "2026-07-0" + (i + 1)}</td>
              <td>{before ? D : "미리보기 · 수정 · 삭제"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">계약 만료 30일 전 자동 알림이 켜져 있어요. 다음 갱신 대상은 2건이에요.</div>
    </section>
  );
}

// ── 인사관리 › 파일보관함 (/documents) ────────────────────────
//   실제: 좌 폴더(+ 새 폴더 / 전체 파일) + 카테고리 탭(전체·계약서·세금계산서·보고서·인증서·일반) + 업로드 드롭존
export function DocumentsRealPanel({ before = false }: { before?: boolean }) {
  const files = [
    { n: "하늘건설_리뉴얼_계약서_v3.pdf", by: "김대표", d: "2026-07-24", s: "2.1MB" },
    { n: "2026_정우성_근로계약서.pdf", by: "최민아", d: "2026-07-01", s: "0.8MB" },
    { n: "6월_결산자료.xlsx", by: "김대표", d: "2026-07-05", s: "1.4MB" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-docr-b" : "pp-docr"}>
      <Head
        crumb="인사관리 › 파일보관함"
        title="회사 서류를 안전하게 보관해요"
        sub="폴더별로 열람 권한을 나누고, 바뀐 파일은 버전으로 남아요."
        tabs={["전체", "계약서", "세금계산서", "보고서", "인증서", "일반"]}
      />
      <div className="pp-filter pp-mt">
        <span className="pp-chip-on">전체 파일</span>
        <span className="pp-chip-off">계약서</span>
        <span className="pp-chip-off">인사기록</span>
        <span className="pp-btn pp-btn-ai">+ 새 폴더</span>
      </div>
      <div className="pp-drop">파일을 드래그하거나 클릭하여 업로드 <i>최대 50MB, 10개 파일 · 이미지, PDF, Word, Excel, PPT, CSV, ZIP</i></div>
      <table className="pp-table">
        <thead><tr><th>파일명</th><th>올린 사람</th><th>크기</th><th>날짜</th></tr></thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.n}>
              <td className="pp-strong">{before ? D : f.n}</td>
              <td>{before ? D : f.by}</td>
              <td>{before ? D : f.s}</td>
              <td>{before ? D : f.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 홈 › 대시보드 › AI 액션 플랜 (/dashboard) ─────────────────
//   실제: ✦ AI 액션 플랜 · ↻ 다시 생성 → 한 줄 제목 → 요약 문단 → 긴급/중요/권장 번호 액션 + 바로가기
export function BriefRealPanel({ before = false }: { before?: boolean }) {
  const acts = [
    { p: "긴급", t: "1. 한빛 소재 1,240만원 회수 연락 (62일 경과)", go: "회수 관리 →" },
    { p: "긴급", t: "2. 메이커스랩 600만원 회수 독촉 (41일 경과)", go: "회수 관리 →" },
    { p: "중요", t: "3. 승인 대기 결재 3건 처리 (외주비 350만원 등)", go: "결재 처리 →" },
    { p: "권장", t: "4. 이번 달 매출 목표 점검 (현재 4,500만원)", go: "손익 보기 →" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-briefr-b" : "pp-briefr"}>
      <Head
        crumb="홈 › 대시보드"
        title="✦ AI 액션 플랜"
        sub={before ? "회사 데이터를 읽는 중이에요…" : "7월 28일 화요일 · 데모 회사 (주)"}
        tabs={[]}
      />
      <div className="pp-sub-card pp-mt">
        <div className="pp-state-line">{before ? "오늘의 우선순위를 정리하고 있어요." : "장기 미수금 회수 집중"}</div>
        <div className="pp-sub">
          {before
            ? "통장·미수금·결재·세금 마감을 함께 보고 있어요."
            : "통장 잔고는 2억 3,040만원이고 90일 후에도 1억 4,100만원이 예상돼 현금 흐름은 안정적이에요. 다만 30일 넘게 밀린 미수금이 1,200만원이라 회수 관리가 최우선이에요."}
        </div>
      </div>
      <div className="pp-section-t">지금 해야 할 일</div>
      <div className="pp-payroll">
        {acts.map((a) => (
          <div key={a.t} className="pp-pay-row">
            <span><span className={`pp-tag ${a.p === "긴급" ? "pp-tag-w" : "pp-tag-n"}`}>{a.p}</span> {before ? D : a.t}</span>
            <b className="pp-dim">{before ? "" : a.go}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

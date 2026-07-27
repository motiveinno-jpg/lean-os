"use client";

// /demo — 프로젝트 흐름(견적서 → 계약서 → 진척 보고서 → 완료 확인서 → 정산 확인) 재현 (2026-07-27).
//   단계 이름과 진행 안내 문구는 실제 앱(src/lib/quote-approvals.ts, components/project-quote-stages.tsx)의
//   STAGE_LABEL / STAGE_NEXT_HINT 를 그대로 옮긴 정적 사본이다. 임의로 지어낸 단계가 아니다.
//   랜딩의 "견적부터 입금까지" 모션 섹션이 이 화면을 캡처해 쓰므로, 여기를 고치면
//   public/product/flow-*.png 도 함께 재캡처해야 한다.

import { useState } from "react";

export const FLOW_STAGES = [
  { key: "estimate", label: "견적서", hint: "거래처가 승인하면 자동으로 계약 단계로 진행됩니다" },
  { key: "contract", label: "계약서", hint: "거래처가 승인하면 자동으로 진행 중 단계로 전환됩니다" },
  { key: "progress_report", label: "진척 보고서", hint: "거래처 확인 후 완료 단계로 안내됩니다" },
  { key: "completion", label: "완료 확인서", hint: "거래처가 확인하면 정산 단계로 진행됩니다" },
  { key: "settlement", label: "정산 확인", hint: "거래처가 정산을 확인하면 프로젝트가 완료됩니다" },
] as const;

const ITEMS = [
  { name: "UX 리서치 · 정보구조 설계", qty: 1, price: 6_000_000 },
  { name: "UI 디자인 (12개 화면)", qty: 12, price: 800_000 },
  { name: "디자인 시스템 구축", qty: 1, price: 4_000_000 },
  { name: "퍼블리싱 · QA", qty: 1, price: 3_400_000 },
];
const PAY_STAGES = [
  { label: "선금", ratio: 30 },
  { label: "중도금", ratio: 40 },
  { label: "잔금", ratio: 30 },
];

const won = (n: number) => "₩" + n.toLocaleString("ko-KR");
const supply = ITEMS.reduce((s, i) => s + i.qty * i.price, 0);
const vat = Math.round(supply * 0.1);
const total = supply + vat;

function StatusBadge({ tone, children }: { tone: "wait" | "ok" | "run"; children: React.ReactNode }) {
  return <span className={`flow-badge flow-badge-${tone}`}>{children}</span>;
}

export function ProjectFlow({ initial = 0 }: { initial?: number }) {
  const [idx, setIdx] = useState(initial);
  const stage = FLOW_STAGES[idx];

  return (
    <section className="flow-panel glass-card" id="project-flow">
      <div className="flow-head">
        <div>
          <div className="flow-eyebrow">프로젝트</div>
          <div className="flow-title">B사 UI/UX 리뉴얼</div>
          <div className="flow-sub">거래처 (주)비컴퍼니 · 담당 김대표 · 계약금액 {won(total)}</div>
        </div>
        <StatusBadge tone={idx === 4 ? "ok" : "run"}>{idx === 4 ? "완료" : "진행중"}</StatusBadge>
      </div>

      {/* 단계 레일 — 실제 앱의 5단계 승인 흐름 */}
      <div className="flow-rail">
        {FLOW_STAGES.map((s, i) => (
          <button
            key={s.key}
            className={`flow-step ${i < idx ? "flow-step-done" : ""} ${i === idx ? "flow-step-on" : ""}`}
            onClick={() => setIdx(i)}
          >
            <span className="flow-step-dot">{i < idx ? "✓" : i + 1}</span>
            <span className="flow-step-label">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="flow-hint">{stage.hint}</div>

      {/* 단계별 본문 */}
      {idx === 0 && (
        <div className="flow-body">
          <div className="flow-section-title">견적 품목</div>
          <table className="flow-table">
            <thead><tr><th>품목</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
            <tbody>
              {ITEMS.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td><td>{i.qty}</td><td>{won(i.price)}</td><td className="flow-num">{won(i.qty * i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flow-totals">
            <div><span>공급가액</span><b>{won(supply)}</b></div>
            <div><span>부가세</span><b>{won(vat)}</b></div>
            <div className="flow-total-final"><span>합계</span><b>{won(total)}</b></div>
          </div>
          <div className="flow-section-title flow-mt">결제 단계</div>
          <div className="flow-paybar">
            {PAY_STAGES.map((p, i) => (
              <div key={p.label} className={`flow-payseg flow-payseg-${i}`} style={{ width: `${p.ratio}%` }}>
                {p.label} {p.ratio}%
              </div>
            ))}
          </div>
          <div className="flow-send">
            <span className="flow-send-to">받는 사람 <b>partner@bcompany.co.kr</b></span>
            <span className="flow-send-btn">견적서 발송</span>
          </div>
        </div>
      )}

      {idx === 1 && (
        <div className="flow-body">
          <div className="flow-row-between">
            <div className="flow-section-title">계약서 초안 — 견적 승인분에서 자동 생성됨</div>
            <StatusBadge tone="wait">서명 대기</StatusBadge>
          </div>
          <div className="flow-doc">
            <div className="flow-doc-title">용역 계약서</div>
            <div className="flow-doc-line"><span>계약명</span><b>B사 UI/UX 리뉴얼</b></div>
            <div className="flow-doc-line"><span>계약금액</span><b>{won(total)} (VAT 포함)</b></div>
            <div className="flow-doc-line"><span>계약기간</span><b>2026-08-01 ~ 2026-10-31</b></div>
            <div className="flow-doc-line"><span>대금지급</span><b>선금 30% · 중도금 40% · 잔금 30%</b></div>
            <div className="flow-doc-seal">
              <div className="flow-seal">직인<br />자동합성</div>
              <div className="flow-sign-slot">거래처 서명란</div>
            </div>
          </div>
          <div className="flow-send">
            <span className="flow-send-to">전자서명 요청 <b>partner@bcompany.co.kr</b></span>
            <span className="flow-send-btn">서명 요청 발송</span>
          </div>
        </div>
      )}

      {idx === 2 && (
        <div className="flow-body">
          <div className="flow-row-between">
            <div className="flow-section-title">진척 보고서</div>
            <StatusBadge tone="run">진행률 65%</StatusBadge>
          </div>
          <div className="flow-progress"><div className="flow-progress-fill" /></div>
          <div className="flow-milestones">
            {[
              { t: "UX 리서치 · IA 설계", d: "완료 · 8/14", done: true },
              { t: "UI 디자인 12개 화면", d: "완료 · 9/06", done: true },
              { t: "디자인 시스템 구축", d: "진행중 · D-9", done: false },
              { t: "퍼블리싱 · QA", d: "예정 · 10/20", done: false },
            ].map((m) => (
              <div key={m.t} className={`flow-ms ${m.done ? "flow-ms-done" : ""}`}>
                <span className="flow-ms-dot">{m.done ? "✓" : ""}</span>
                <span className="flow-ms-t">{m.t}</span>
                <span className="flow-ms-d">{m.d}</span>
              </div>
            ))}
          </div>
          <div className="flow-note">중도금 청구 조건(진행률 50% 이상)이 충족되어 청구서 발행이 가능합니다.</div>
        </div>
      )}

      {idx === 3 && (
        <div className="flow-body">
          <div className="flow-row-between">
            <div className="flow-section-title">완료 확인서</div>
            <StatusBadge tone="ok">거래처 확인 완료</StatusBadge>
          </div>
          <div className="flow-checklist">
            {["최종 산출물 전달 (Figma · 소스코드)", "디자인 시스템 문서 인수인계", "QA 이슈 24건 전량 처리", "하자보수 기간 3개월 명시"].map((t) => (
              <div key={t} className="flow-check"><span className="flow-check-mark">✓</span>{t}</div>
            ))}
          </div>
          <div className="flow-doc-line flow-mt"><span>확인일</span><b>2026-10-31 · (주)비컴퍼니 담당자 전자서명</b></div>
          <div className="flow-note">완료 확인과 동시에 잔금 청구서가 자동으로 준비됩니다.</div>
        </div>
      )}

      {idx === 4 && (
        <div className="flow-body">
          <div className="flow-row-between">
            <div className="flow-section-title">정산 확인 — 세금계산서 · 계약 · 입금 3-Way 매칭</div>
            <StatusBadge tone="ok">매칭 완료</StatusBadge>
          </div>
          <div className="flow-match">
            <div className="flow-match-col">
              <div className="flow-match-cap">계약</div>
              <div className="flow-match-val">{won(total)}</div>
              <div className="flow-match-sub">B사 UI/UX 리뉴얼</div>
            </div>
            <div className="flow-match-link">↔</div>
            <div className="flow-match-col">
              <div className="flow-match-cap">세금계산서</div>
              <div className="flow-match-val">{won(total)}</div>
              <div className="flow-match-sub">국세청 승인 · 2026-11-01</div>
            </div>
            <div className="flow-match-link">↔</div>
            <div className="flow-match-col flow-match-ok">
              <div className="flow-match-cap">입금</div>
              <div className="flow-match-val">{won(total)}</div>
              <div className="flow-match-sub">기업은행 · 2026-11-05</div>
            </div>
          </div>
          <div className="flow-ledger">
            <div className="flow-ledger-title">자동 생성된 전표</div>
            <div className="flow-ledger-row"><span>(차) 보통예금</span><b className="flow-num">{won(total)}</b></div>
            <div className="flow-ledger-row"><span>(대) 매출 / 부가세예수금</span><b className="flow-num">{won(supply)} / {won(vat)}</b></div>
          </div>
        </div>
      )}
    </section>
  );
}

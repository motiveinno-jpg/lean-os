"use client";

// 디자인 시스템 갤러리 — 오너뷰가 쓰는 부품을 한 화면에 모아 둔다 (2026-08-05).
//
//   왜 만드나: 화면을 고칠 때마다 globals.css 6,000줄을 뒤지거나 임시 HTML 을 손으로
//   만들어 근사치를 확인해 왔다. 그래서 "실제로 어떻게 보이나"를 못 보고 만들었고,
//   사장님이 직접 결함을 찾는 일이 반복됐다.
//   → 부품을 한 곳에 세워 두면 ① 사람이 기준을 눈으로 보고 ② AI 가 로그인 후 이 화면만
//     열어 확인하며 ③ 부품 하나를 고쳤을 때 전체가 어떻게 바뀌는지 즉시 드러난다.
//
//   원칙: **조회 없음**. 데이터에 의존하지 않아 누가 열어도 같은 화면이 나온다.
//   새 부품을 만들면 여기에 같이 추가한다 — 여기에 없는 부품은 표준이 아니다.

import { useState } from "react";

const COLORS: { token: string; name: string; note?: string }[] = [
  { token: "--bg", name: "바탕", note: "페이지 캔버스" },
  { token: "--bg-card", name: "카드", note: "떠 있는 면" },
  { token: "--bg-surface", name: "서피스", note: "입력칸·hover" },
  { token: "--border", name: "테두리" },
  { token: "--text", name: "본문" },
  { token: "--text-muted", name: "보조" },
  { token: "--text-dim", name: "흐림", note: "캡션" },
  { token: "--primary", name: "브랜드", note: "주 액션" },
  { token: "--success", name: "좋음" },
  { token: "--warning", name: "주의" },
  { token: "--danger", name: "위험" },
];

const STATUS_COLORS = [
  { hex: "#C4C4C4", label: "대기·검토" },
  { hex: "#579BFC", label: "낮음·고정비" },
  { hex: "#5559DF", label: "진행 단계" },
  { hex: "#A25DDC", label: "검수·발행" },
  { hex: "#FDAB3D", label: "진행 중" },
  { hex: "#00C875", label: "완료·입금" },
  { hex: "#E2445C", label: "높음·보류" },
];

export default function DesignSystemPage() {
  const [seg, setSeg] = useState("a");

  return (
    <div className="ds-page">
      <header className="ds-head">
        <h1>디자인 시스템</h1>
        <p>오너뷰가 쓰는 부품 전부. 새 화면은 여기 있는 것으로만 조립한다 — 여기 없으면 표준이 아니다.</p>
      </header>

      {/* ── 색 ─────────────────────────────────────────────── */}
      <Section title="색" desc="라이트·다크가 같은 토큰 이름을 쓴다. 값을 직접 쓰지 말고 var(--토큰) 으로.">
        <div className="ds-swatches">
          {COLORS.map((c) => (
            <div key={c.token} className="ds-swatch">
              <i style={{ background: `var(${c.token})` }} />
              <b>{c.name}</b>
              <code>{c.token}</code>
              {c.note && <em>{c.note}</em>}
            </div>
          ))}
        </div>
        <p className="ds-note">상태 색(프로젝트 템플릿·보드 공용) — 회사 안에서 색 뜻이 갈리지 않게 이 7개만 쓴다.</p>
        <div className="ds-statuscolors">
          {STATUS_COLORS.map((s) => (
            <span key={s.hex} className="ds-statuscolor"><i style={{ background: s.hex }} />{s.label}<code>{s.hex}</code></span>
          ))}
        </div>
      </Section>

      {/* ── 타이포 ─────────────────────────────────────────── */}
      <Section title="글자" desc="한 화면에서 크기를 4단계 넘게 쓰지 않는다.">
        <div className="ds-type">
          <p className="ds-type-row"><span>페이지 제목</span><b className="ds-t1">이번 달 경영 요약</b><code>18~20px / 800</code></p>
          <p className="ds-type-row"><span>구획 제목</span><b className="ds-t2">지금 챙길 것</b><code>14px / 700</code></p>
          <p className="ds-type-row"><span>본문</span><b className="ds-t3">거래처에 보낸 견적서가 아직 회신되지 않았습니다.</b><code>13px / 400</code></p>
          <p className="ds-type-row"><span>보조·캡션</span><b className="ds-t4">2026-08-05 · 최송이</b><code>11~12px / dim</code></p>
          <p className="ds-type-row"><span>숫자</span><b className="ds-t5">1,234,567원</b><code>tabular-nums · 우측정렬</code></p>
        </div>
      </Section>

      {/* ── 버튼 ─────────────────────────────────────────────── */}
      <Section title="버튼" desc="주 동작은 화면에 하나. 나머지는 보조로 둔다. 버튼 이름과 결과 문구를 같게 쓴다(발송 → 발송했습니다).">
        <div className="ds-row">
          <button className="btn-primary">저장</button>
          <button className="btn-secondary">취소</button>
          <button className="btn-primary btn-sm">작은 주 버튼</button>
          <button className="btn-secondary btn-sm">작은 보조</button>
          <button className="btn-primary" disabled>비활성</button>
        </div>
        <div className="ds-codes"><code>.btn-primary</code><code>.btn-secondary</code><code>.btn-sm</code></div>
      </Section>

      {/* ── 입력 ─────────────────────────────────────────────── */}
      <Section title="입력" desc="버튼과 같은 높이(40px). 작은 자리는 32px.">
        <div className="ds-grid2">
          <label className="ds-field"><span>표준 입력</span><input className="field-input" placeholder="프로젝트명" /></label>
          <label className="ds-field"><span>작은 입력</span><input className="field-input-sm" placeholder="검색" /></label>
          <label className="ds-field"><span>선택</span>
            <select className="field-input"><option>B2B</option><option>B2C</option></select>
          </label>
          <label className="ds-field"><span>여러 줄</span><textarea className="field-input" rows={2} placeholder="메모" /></label>
        </div>
        <div className="ds-row">
          <span className="seg-bar">
            {(["a", "b", "c"] as const).map((k) => (
              <button key={k} onClick={() => setSeg(k)} className={`seg-item ${seg === k ? "seg-item-active" : ""}`}>
                {{ a: "목록", b: "칸반", c: "달력" }[k]}
              </button>
            ))}
          </span>
        </div>
        <div className="ds-codes"><code>.field-input</code><code>.field-input-sm</code><code>.seg-bar</code><code>.seg-item</code></div>
      </Section>

      {/* ── 배지 ─────────────────────────────────────────────── */}
      <Section title="배지 · 상태" desc="판정('정상')이 아니라 사실('기한 지남')을 적는다. 셀 게 0이면 배지를 그리지 않는다.">
        <div className="ds-row">
          <span className="ph-st ph-st-late">기한 지남</span>
          <span className="ph-st ph-st-warn">이번 주</span>
          <span className="ph-st ph-st-empty">입력 전</span>
          <span className="badge badge-primary">브랜드</span>
          <span className="badge badge-primary">진행</span>
        </div>
        <div className="ds-codes"><code>.ph-st-late</code><code>.ph-st-warn</code><code>.ph-st-empty</code><code>.badge</code><code>.badge-primary</code></div>
      </Section>

      {/* ── 카드 · 타일 ────────────────────────────────────── */}
      <Section title="카드 · 지표 타일" desc="지표는 제목 → 값 → 근거 한 줄 순서. 근거 없는 숫자는 올리지 않는다.">
        <div className="ds-tiles">
          <div className="stat-tile"><span className="stat-tile-label">이번 달 매출</span><span className="stat-tile-value">48,200,000원</span><span className="ds-tile-note">계산서 발행 기준 · 12건</span></div>
          <div className="stat-tile"><span className="stat-tile-label">미수금</span><span className="stat-tile-value ds-bad">6,400,000원</span><span className="ds-tile-note">60일 넘은 것 2건</span></div>
          <div className="stat-tile"><span className="stat-tile-label">진행 프로젝트</span><span className="stat-tile-value">7건</span><span className="ds-tile-note">기한 지난 것 1건</span></div>
        </div>
        <div className="glass-card ds-cardsample">
          <b>글래스 카드</b>
          <p>구획을 감싸는 기본 면. 카드 안에 카드를 또 넣지 않는다.</p>
        </div>
        <div className="ds-codes"><code>.stat-tile</code><code>.stat-tile-label</code><code>.stat-tile-value</code><code>.glass-card</code></div>
      </Section>

      {/* ── 표 ─────────────────────────────────────────────── */}
      <Section title="표" desc="금액은 우측정렬 + 고정폭 숫자. 행 전체가 눌리는 표는 커서를 바꿔 준다.">
        <div className="ds-tablewrap">
          <table className="ds-table">
            <thead><tr><th>항목</th><th>거래처</th><th className="num-cell">금액</th><th>상태</th></tr></thead>
            <tbody>
              <tr><td>인테리어 공사</td><td>포블럭스</td><td className="num-cell">26,400,000</td><td><span className="pb-status" style={{ background: "#FDAB3D" }}><i>진행 중</i></span></td></tr>
              <tr><td>간판 제작</td><td>우슴</td><td className="num-cell">2,400,000</td><td><span className="pb-status" style={{ background: "#E2445C" }}><i>보류</i></span></td></tr>
            </tbody>
          </table>
        </div>
        <div className="ds-codes"><code>.num-cell</code><code>.pb-status</code></div>
      </Section>

      {/* ── 빈 상태 · 로딩 ────────────────────────────────── */}
      <Section title="빈 화면 · 불러오는 중" desc="빈 화면은 행동으로의 초대다. '없음'만 적고 끝내지 않는다.">
        <div className="ds-grid2">
          <div className="glass-card">
            <div className="empty-state">
              <span className="empty-state-icon">＋</span>
              <span className="empty-state-title">아직 템플릿이 없어요</span>
              <span className="empty-state-desc">하는 일에 맞는 템플릿을 고르면 표가 만들어집니다.</span>
              <button className="btn-primary">템플릿 고르기</button>
            </div>
          </div>
          <div className="glass-card ds-skelbox">
            <div className="skeleton ds-skel1">불러오는 중</div>
            <div className="skeleton ds-skel2">불러오는 중</div>
            <div className="skeleton ds-skel3">불러오는 중</div>
          </div>
        </div>
        <div className="ds-codes"><code>.empty-state</code><code>.skeleton</code></div>
      </Section>

      {/* ── 프로젝트 템플릿 부품 ──────────────────────────── */}
      <Section title="프로젝트 템플릿 부품" desc="입력(표·칸반)과 보기(타임라인·캘린더·정리)를 라벨로 가른다. 기본은 항상 입력 화면.">
        <div className="ds-bar2sample">
          <div className="pb-views" role="group" aria-label="보는 방식">
            <span className="pb-views-sec">
              <b>입력</b>
              <button className="pb-viewbtn pb-viewbtn-on">표</button>
              <button className="pb-viewbtn">칸반</button>
            </span>
            <span className="pb-views-sep" aria-hidden="true" />
            <span className="pb-views-sec">
              <b>보기</b>
              <button className="pb-viewbtn">타임라인</button>
              <button className="pb-viewbtn">캘린더</button>
              <button className="pb-viewbtn">정리</button>
            </span>
          </div>
          <span className="pb-filters">
            <button className="pb-filter">내 담당</button>
            <button className="pb-filter pb-filter-on">이번 주</button>
          </span>
        </div>
        <div className="ds-grid2">
          <article className="pb-card">
            <input className="pb-card-name" defaultValue="결제 모듈 연동" />
            <div className="pb-card-fields">
              <span className="pb-card-field"><label>담당</label><input className="pb-in" defaultValue="남기원" /></span>
              <span className="pb-card-field"><label>마감</label><input className="pb-in pb-in-date" defaultValue="2026-08-06" /></span>
            </div>
          </article>
          <div className="pb-propose">
            <b>계약서 결제조건대로 청구 줄을 만들까요?</b>
            <span>선금 40% 1,200만 · 잔금 60% 1,800만</span>
            <button type="button">2줄 만들기</button>
          </div>
        </div>
        <div className="ds-row">
          <span className="pb-ratio"><span className="pb-ratio-track"><i style={{ width: "94%" }} /></span><em>94%</em></span>
          <span className="pb-ratio"><span className="pb-ratio-track"><i className="pb-ratio-over" style={{ width: "100%" }} /></span><em className="pb-ratio-bad">115%</em></span>
          <span className="pb-doc-sendst">보냄</span>
          <span className="pb-doc-sendst pb-doc-sendst-bad">발송 실패</span>
        </div>
        <div className="ds-codes"><code>.pb-views</code><code>.pb-card</code><code>.pb-propose</code><code>.pb-ratio</code></div>
      </Section>

      {/* ── 알림 줄 ───────────────────────────────────────── */}
      <Section title="되돌리기 · 일괄" desc="지우는 동작에는 항상 되돌리기가 붙는다. 고른 줄이 있으면 할 수 있는 일을 아래에 모은다.">
        <div className="ds-floats">
          <div className="pb-undo"><span>행 &apos;간판 제작&apos; 을 지웠어요.</span><button>되돌리기</button><button className="pb-undo-x">✕</button></div>
          <div className="pb-bulk">
            <b>3건 선택</b>
            <select><option>단계 바꾸기</option></select>
            <button className="pb-bulk-x">삭제</button>
            <button className="pb-bulk-off">선택 해제</button>
          </div>
        </div>
        <div className="ds-codes"><code>.pb-undo</code><code>.pb-bulk</code></div>
      </Section>

      <p className="ds-foot">
        부품을 새로 만들면 이 화면에도 함께 추가한다. 클래스명 규칙은 CLAUDE.md 참고 —
        className 에는 시맨틱 마커만 두고 스타일은 globals.css 에 <code>@apply</code> 로 정의한다.
      </p>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="ds-sec">
      <div className="ds-sec-head">
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      {children}
    </section>
  );
}

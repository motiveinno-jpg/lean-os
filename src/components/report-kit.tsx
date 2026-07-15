"use client";

// 리포트형 UI 킷 — "하나의 보고서" 정보구조(표준 헤더/KPI/섹션)를 오너뷰 글래스 비주얼로.
//   구조는 리포트형, 비주얼은 글래스 유지 + 풀폭(중앙 여백 없음). 사장님 피드백 반영(2026-07-13).

import Link from "next/link";
import type { ReactNode } from "react";

// 공용 카드 — 오너뷰 글래스 카드 유지(반투명). 리포트 구조만 표준화.
export const REPORT_CARD = "glass-card";

const toneColor = (tone?: string) =>
  tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : tone === "primary" ? "var(--primary)" : "var(--text)";
const soft = (c: string, pct = 12) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

// 리포트 컬럼 — 풀폭(중앙 여백 없음). 여백 때문에 붕 뜨는 느낌 제거.
export function ReportShell({ children }: { children: ReactNode }) {
  return <div className="report-shell w-full">{children}</div>;
}

// 페이지 헤더 — 제목 + 한 줄 설명 + 출처 칩
export function PageHeader({ title, desc, tags }: { title: string; desc?: string; tags?: string[] }) {
  return (
    <header className="report-header">
      <h1 className="text-[26px] leading-8 font-extrabold text-[var(--text)] tracking-tight">{title}</h1>
      {desc && <p className="text-sm text-[var(--text-muted)] mt-1.5 max-w-3xl leading-relaxed">{desc}</p>}
      {tags && tags.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {tags.map((t, i) => <span key={i} className="text-[11px] font-medium px-2.5 py-1 rounded-full text-[var(--primary)] border" style={{ background: soft("var(--primary)", 8), borderColor: soft("var(--primary)", 18) }}>{t}</span>)}
        </div>
      )}
    </header>
  );
}

// 인트로 카드 — 요지 문단(좌) + 핵심 콜아웃(우)
export function IntroCard({ eyebrow, title, desc, tags, callout, box }: {
  eyebrow?: string; title: string; desc?: string; tags?: string[];
  callout?: { label: string; value: string; sub?: string; tone?: string };
  box?: { label: string; value: string; sub?: string; tone?: string };
}) {
  return (
    <div className={`report-intro-card ${REPORT_CARD} p-6`}>
      <div className="report-intro-grid grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="report-intro-text min-w-0">
          {eyebrow && <div className="text-[11px] font-bold tracking-wider uppercase mb-2" style={{ color: "var(--primary)" }}>{eyebrow}</div>}
          <h2 className="text-xl font-extrabold text-[var(--text)] tracking-tight">{title}</h2>
          {desc && <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{desc}</p>}
          {tags && tags.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              {tags.map((t, i) => <span key={i} className="text-[11px] font-medium px-2 py-0.5 rounded-full text-[var(--primary)]" style={{ background: soft("var(--primary)", 8) }}>{t}</span>)}
            </div>
          )}
        </div>
        {(callout || box) && (
          <div className="report-intro-side md:border-l md:border-[var(--border)] md:pl-6 space-y-3">
            {callout && (
              <div className="report-intro-callout">
                <div className="text-[11px] text-[var(--text-dim)]">{callout.label}</div>
                <div className="text-2xl font-extrabold mono-number mt-0.5" style={{ color: toneColor(callout.tone) }}>{callout.value}</div>
                {callout.sub && <div className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">{callout.sub}</div>}
              </div>
            )}
            {box && (
              <div className="report-intro-box rounded-xl p-3" style={{ background: soft(toneColor(box.tone), 10) }}>
                <div className="text-[11px] font-semibold" style={{ color: toneColor(box.tone) }}>{box.label}</div>
                <div className="text-lg font-extrabold mono-number" style={{ color: toneColor(box.tone) }}>{box.value}</div>
                {box.sub && <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{box.sub}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// KPI 카드 — 라벨 / 큰 숫자 / 캡션 / 아이콘칩
export function StatCard({ label, value, caption, icon, tone, href }: {
  label: string; value: string; caption?: string; icon?: ReactNode; tone?: string; href?: string;
}) {
  const color = toneColor(tone);
  const inner = (
    <>
      <div className="report-stat-head flex items-start justify-between gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
        {icon != null && <span className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0" style={{ background: soft(color === "var(--text)" ? "var(--primary)" : color, 12) }}>{icon}</span>}
      </div>
      <div className="text-[26px] leading-8 font-extrabold mono-number mt-2" style={{ color }}>{value}</div>
      {caption && <div className="text-[11px] text-[var(--text-dim)] mt-1">{caption}</div>}
    </>
  );
  return href
    ? <Link href={href} className={`report-stat-card ${REPORT_CARD} p-5 block no-underline hover:border-[var(--primary)] transition`}>{inner}</Link>
    : <div className={`report-stat-card ${REPORT_CARD} p-5`}>{inner}</div>;
}

// 섹션 — 헤딩 + 부제(+우측 컨트롤)
export function Section({ title, desc, right, children, className }: { title: string; desc?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`report-section ${REPORT_CARD} p-5 ${className || ""}`}>
      <div className="report-section-header flex items-start justify-between gap-2 mb-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--text)]">{title}</h3>
          {desc && <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

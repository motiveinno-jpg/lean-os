"use client";

// 운영자 페이지 v2 공용 부품 (2026-09-03 사장님: "최신스럽고 현대적이고 세련되게")
//   · PfPage / PfPageHead — 화면 머리(아이브로우·제목·설명·액션)
//   · PfCard — 유리 카드(호버 리프트·상단 하이라이트), PfCardHead/Body
//   · PfKpi — 숫자가 굴러가며 바뀌는 KPI(NumberFlow), 증감 배지
//   · PfIn — 등장 스태거(카드마다 순번), PfSkeleton, PfEmpty, PfBadge, PfRows/PfRow
//   스타일은 globals.css 의 .pf-* 만 쓴다(운영자 페이지 전용, 고객 화면과 분리).

import React from "react";
import Link from "next/link";
import NumberFlow, { type Format as NumberFlowFormat } from "@number-flow/react";

type Cls = { className?: string };

export function PfPage({ children, className = "" }: React.PropsWithChildren<Cls>) {
  return <div className={`pf-page ${className}`}>{children}</div>;
}

export function PfPageHead({ eyebrow, title, desc, actions }: { eyebrow?: string; title: React.ReactNode; desc?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="pf-page-head pf-in" style={{ ["--pf-i" as string]: 0 }}>
      <div className="min-w-0">
        {eyebrow && <div className="pf-page-eyebrow">{eyebrow}</div>}
        <h1 className="pf-page-title">{title}</h1>
        {desc && <p className="pf-page-desc">{desc}</p>}
      </div>
      {actions && <div className="pf-page-actions">{actions}</div>}
    </div>
  );
}

/** 등장 애니메이션 래퍼 — i 는 스태거 순번(0부터). */
export function PfIn({ i = 0, children, className = "", as: Tag = "div" }: React.PropsWithChildren<{ i?: number; className?: string; as?: "div" | "section" | "li" }>) {
  return <Tag className={`pf-in ${className}`} style={{ ["--pf-i" as string]: i }}>{children}</Tag>;
}

export function PfCard({ children, className = "", hover = true, dark = false, i, pad = false }: React.PropsWithChildren<{ className?: string; hover?: boolean; dark?: boolean; i?: number; pad?: boolean }>) {
  const cls = `pf-card ${hover ? "pf-card-hover" : ""} ${dark ? "pf-card-dark" : ""} ${pad ? "pf-card-pad" : ""} ${i != null ? "pf-in" : ""} ${className}`;
  return <div className={cls} style={i != null ? { ["--pf-i" as string]: i } : undefined}>{children}</div>;
}

export function PfCardHead({ title, sub, action, href, tight = false, right }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; href?: string; tight?: boolean; right?: React.ReactNode }) {
  return (
    <div className={`pf-card-head ${tight ? "pf-card-head-tight" : ""}`}>
      <div className="min-w-0">
        <div className="pf-card-title">{title}</div>
        {sub && <div className="pf-card-sub">{sub}</div>}
      </div>
      {right}
      {href ? <Link href={href} className="pf-card-action">{action ?? "상세 →"}</Link> : action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PfCardBody({ children, className = "" }: React.PropsWithChildren<Cls>) {
  return <div className={`pf-card-body ${className}`}>{children}</div>;
}

const KRW = new Intl.NumberFormat("ko-KR");

/** 원화 축약 — ₩1.2억 / ₩350만 / ₩12,000 */
export function fmtKrwShort(n: number): string {
  const abs = Math.abs(n); const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}₩${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}억`;
  if (abs >= 1e4) return `${sign}₩${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  return `${sign}₩${KRW.format(Math.round(abs))}`;
}

/**
 * KPI — 값이 바뀌면 숫자가 굴러간다(NumberFlow). 큰 금액은 단위를 나눠 애니메이션(억/만).
 *   value 가 문자열이면 그대로 표시(포맷을 호출측이 정한 경우).
 */
export function PfKpi({ label, value, unit, prefix, delta, deltaLabel, accent = false, large = false, live = false, className = "", format }: {
  label: React.ReactNode;
  value: number | string;
  unit?: string;
  prefix?: string;
  delta?: number | null;         // 증감(양수/음수). null 이면 표시 안 함
  deltaLabel?: string;           // "전월 대비" 등
  accent?: boolean;
  large?: boolean;
  live?: boolean;
  className?: string;
  format?: NumberFlowFormat;
}) {
  const deltaCls = delta == null ? "" : delta > 0 ? "pf-kpi-delta-up" : delta < 0 ? "pf-kpi-delta-down" : "pf-kpi-delta-flat";
  return (
    <div className={`pf-kpi ${className}`}>
      <span className="pf-kpi-label">{live && <span className="pf-live mr-1.5 align-middle" />}{label}</span>
      <span className={`pf-kpi-value mono-number ${large ? "pf-kpi-value-lg" : ""} ${accent ? "pf-kpi-accent" : ""}`}>
        {typeof value === "number"
          ? <NumberFlow value={value} prefix={prefix} suffix={unit} format={format ?? { maximumFractionDigits: 0 }} locales="ko-KR" />
          : <>{prefix}{value}{unit}</>}
      </span>
      {delta != null && (
        <span className={`pf-kpi-delta ${deltaCls}`}>
          {deltaLabel ? `${deltaLabel} ` : ""}{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta).toLocaleString("ko-KR")}
        </span>
      )}
    </div>
  );
}

/** 금액 KPI — 억/만 단위로 나눠 굴린다. */
export function PfKpiKrw({ label, value, ...rest }: Omit<React.ComponentProps<typeof PfKpi>, "value" | "unit" | "prefix" | "format"> & { value: number }) {
  const abs = Math.abs(value);
  if (abs >= 1e8) return <PfKpi label={label} value={Math.round((value / 1e8) * 10) / 10} prefix="₩" unit="억" format={{ maximumFractionDigits: 1 }} {...rest} />;
  if (abs >= 1e4) return <PfKpi label={label} value={Math.round(value / 1e4)} prefix="₩" unit="만" {...rest} />;
  return <PfKpi label={label} value={Math.round(value)} prefix="₩" {...rest} />;
}

export function PfBadge({ tone = "muted", children, className = "" }: React.PropsWithChildren<{ tone?: "ok" | "warn" | "danger" | "info" | "muted"; className?: string }>) {
  return <span className={`pf-badge pf-badge-${tone} ${className}`}>{children}</span>;
}

export function PfSkeleton({ h = 14, w = "100%", className = "", rows = 1 }: { h?: number; w?: string | number; className?: string; rows?: number }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, k) => (
        <div key={k} className="pf-skel" style={{ height: h, width: typeof w === "number" ? w : k === rows - 1 && rows > 1 ? "70%" : w }} />
      ))}
    </div>
  );
}

export function PfEmpty({ children, ok = false }: React.PropsWithChildren<{ ok?: boolean }>) {
  return <div className={`pf-empty ${ok ? "pf-empty-ok" : ""}`}>{children}</div>;
}

export function PfRows({ children }: React.PropsWithChildren) {
  return <div className="pf-rows">{children}</div>;
}

export function PfRow({ href, onClick, children, className = "" }: React.PropsWithChildren<{ href?: string; onClick?: () => void; className?: string }>) {
  if (href) return <Link href={href} className={`pf-row ${className}`}>{children}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`pf-row w-full text-left ${className}`}>{children}</button>;
  return <div className={`pf-row ${className}`}>{children}</div>;
}

/** 진행 막대 — 등장 시 왼쪽에서 자란다. tone 은 상태색. */
export function PfBar({ pct, tone = "info", className = "" }: { pct: number; tone?: "ok" | "warn" | "danger" | "info"; className?: string }) {
  const color = tone === "ok" ? "var(--success)" : tone === "warn" ? "#D97706" : tone === "danger" ? "var(--danger)" : "var(--primary)";
  return (
    <div className={`pf-bar-track ${className}`}>
      <div className="pf-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function PfSeg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="pf-seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)} className={`pf-seg-item ${o.value === value ? "pf-seg-item-on" : ""}`}>{o.label}</button>
      ))}
    </div>
  );
}

"use client";

// granter 스타일 카드 개요 (2026-05-27): 상단 전체 지출 + 카드사별 그룹 + 3열 카드 그리드.
//   - 우측 담당자/인물 이미지 없음 (사장님 명시 제외)
//   - 사용액 = card_transactions 기간 합산(getCardSpendByCompany)
//   - 카드 클릭 → onSelectCard(cardId | `codef:cardName`) 로 부모의 기존 상세 흐름 연결

import { useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery } from "@tanstack/react-query";
import { TileIcon } from "@/components/ui/icon-tile";
import { getCardSpendByCompany, type CardSpendCard } from "@/lib/card-transactions";

// 카드사 브랜드색 매핑 상수 (하드코딩 금지 규칙 — 브랜드색은 매핑 상수 허용)
//   logo: public/card-logos/{logo} 파일이 있으면 로고 이미지 표시, 없으면(404) 색상 이니셜로 자동 폴백.
const COMPANY_STYLE: Record<string, { color: string; initial: string; fg?: string; logo?: string }> = {
  국민카드: { color: "#FFBC00", initial: "KB", fg: "#1a1a1a", logo: "kb.svg" },
  현대카드: { color: "#111111", initial: "현대", logo: "hyundai.svg" },
  삼성카드: { color: "#1428A0", initial: "삼성", logo: "samsung.svg" },
  신한카드: { color: "#0046FF", initial: "신한", logo: "shinhan.svg" },
  BC카드: { color: "#EA002C", initial: "BC", logo: "bc.svg" },
  롯데카드: { color: "#DA291C", initial: "롯데", logo: "lotte.svg" },
  하나카드: { color: "#008485", initial: "하나", logo: "hana.svg" },
  우리카드: { color: "#0067AC", initial: "우리", logo: "woori.svg" },
  농협카드: { color: "#00A64F", initial: "NH", logo: "nh.svg" },
  카카오뱅크: { color: "#FEE500", initial: "kakao", fg: "#1a1a1a", logo: "kakao.svg" },
  토스: { color: "#0064FF", initial: "toss", logo: "toss.svg" },
  씨티카드: { color: "#0560B0", initial: "씨티", logo: "citi.svg" },
  기타: { color: "var(--text-muted)", initial: "카드" },
};

const TYPE_LABEL: Record<string, string> = { credit: "신용", check: "체크", debit: "직불", other: "기타" };

function styleFor(company: string) {
  return COMPANY_STYLE[company] || COMPANY_STYLE["기타"];
}

// 카드사 아이콘: 로고 이미지 우선, 로드 실패 시 색상 이니셜로 폴백.
function CardCompanyIcon({ company, size = 40 }: { company: string; size?: number }) {
  const st = styleFor(company);
  const [imgFailed, setImgFailed] = useState(false);
  if (st.logo && !imgFailed) {
    return (
      <span
        className="rounded-lg shrink-0 flex items-center justify-center overflow-hidden bg-white border border-[var(--border)]"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/card-logos/${st.logo}`}
          alt={company}
          className="object-contain"
          style={{ width: size * 0.7, height: size * 0.7 }}
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }
  return (
    <span
      className="rounded-lg shrink-0 flex items-center justify-center text-[10px] font-extrabold"
      style={{ width: size, height: size, background: st.color, color: st.fg || "#fff" }}
    >
      {st.initial}
    </span>
  );
}

function fmtWon(n: number): string {
  const abs = Math.abs(Math.round(n));
  const sign = n > 0 ? "-" : n < 0 ? "+" : "";
  return `${sign}₩${abs.toLocaleString("ko-KR")}`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 월 이동(일자 보존, 말일 오버플로 방지)
function addMonths(d: Date, delta: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), dim));
}

// 기본: 이번 달(1일~말일)
function defaultRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from, to };
}

// TeamHub KPI 카드 — 상단 통계 (지출 기준: 증가=danger 빨강, 감소=success 초록)
function StatCard({ tone, icon, label, value, trend }: {
  tone: "danger" | "brand" | "info" | "warning";
  icon: string;
  label: string;
  value: string;
  trend: number | null;
}) {
  return (
    <div className="card-stat-tile glass-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[var(--text-muted)]">{label}</span>
        <span className={`kpi-icon ${tone === "brand" ? "" : tone}`}><TileIcon name={icon} className="w-5 h-5" /></span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-[26px] leading-8 font-extrabold text-[var(--text)] mono-number">{value}</span>
        {trend != null ? (
          <span className={`delta-chip ${trend >= 0 ? "delta-down" : "delta-up"} mb-1`} title="전월 대비">
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
          </span>
        ) : (
          <span className="text-[11px] text-[var(--text-dim)] mb-1.5">기간 합계</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  companyId: string;
  onSelectCard: (payload: string) => void;
}

export function CardsOverview({ companyId, onSelectCard }: Props) {
  const [range, setRange] = useState(defaultRange);
  const [sortBy, setSortBy] = useState<"amount" | "name">("amount");
  const [search, setSearch] = useState("");

  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["card-spend-by-company", companyId, fromStr, toStr],
    queryFn: () => getCardSpendByCompany(companyId, fromStr, toStr),
    enabled: !!companyId,
  });

  // 1개월 단위 이동 (현재 기간 폭 유지)
  const shiftMonths = (delta: number) => {
    setRange((r) => ({ from: addMonths(r.from, delta), to: addMonths(r.to, delta) }));
  };

  // 검색·정렬 적용 후 그룹
  const groups = useMemo(() => {
    const raw = data?.groups || [];
    const q = search.trim().toLowerCase();
    return raw
      .map((g) => {
        let cards = g.cards;
        if (q) {
          cards = cards.filter(
            (c) =>
              c.displayName.toLowerCase().includes(q) ||
              c.cardName.toLowerCase().includes(q) ||
              (c.last4 || "").includes(q) ||
              c.company.toLowerCase().includes(q),
          );
        }
        cards = [...cards].sort((a, b) =>
          sortBy === "amount" ? Math.abs(b.spend) - Math.abs(a.spend) : a.displayName.localeCompare(b.displayName, "ko"),
        );
        return { ...g, cards };
      })
      .filter((g) => g.cards.length > 0);
  }, [data, search, sortBy]);

  const total = data?.total ?? 0;

  const handleDownload = () => {
    const rows: string[] = ["카드사,카드명,끝4자리,종류,사용액,건수"];
    for (const g of groups) {
      for (const c of g.cards) {
        rows.push(
          [g.company, `"${c.displayName.replace(/"/g, "'")}"`, c.last4 || "", TYPE_LABEL[c.cardType || ""] || "", Math.round(c.spend), c.count].join(","),
        );
      }
    }
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cards_${fromStr}_${toStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardClickPayload = (c: CardSpendCard) => (c.cardId ? c.cardId : `codef:${c.cardName}`);

  // ── 시안 표시 전용(기존 쿼리·로직 무관, 레이아웃/표시만) ──
  const [activeTab, setActiveTab] = useState<"all" | "credit" | "check" | "debit">("all");

  // 전월(직전 동일 길이) 사용액 — 카드별/전체 증감 표시용
  const prevRange = useMemo(() => ({ from: addMonths(range.from, -1), to: addMonths(range.to, -1) }), [range]);
  const { data: prevData } = useQuery({
    queryKey: ["card-spend-prev", companyId, ymd(prevRange.from), ymd(prevRange.to)],
    queryFn: () => getCardSpendByCompany(companyId, ymd(prevRange.from), ymd(prevRange.to)),
    enabled: !!companyId,
  });
  const prevByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of prevData?.groups || []) for (const c of g.cards) m.set(c.key, c.spend);
    return m;
  }, [prevData]);
  const trendOf = (key: string, cur: number): number | null => {
    const p = prevByKey.get(key);
    if (p == null || p === 0) return null;
    return ((cur - p) / p) * 100;
  };

  // 탭(카드 종류) 필터 + 평탄화 — 기존 groups(검색·정렬 반영) 재사용
  const flatCards = useMemo(() => {
    const out: CardSpendCard[] = [];
    for (const g of groups) for (const c of g.cards) {
      if (activeTab !== "all" && (c.cardType || "other") !== activeTab) continue;
      out.push(c);
    }
    return out;
  }, [groups, activeTab]);

  // 통계 4개(표시용 집계)
  const stats = useMemo(() => {
    let cardCount = 0, txCount = 0, unreg = 0;
    for (const g of data?.groups || []) for (const c of g.cards) { cardCount++; txCount += c.count; if (!c.registered) unreg++; }
    const prevTotal = prevData?.total ?? 0;
    const trend = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    return { total, cardCount, txCount, unreg, trend };
  }, [data, prevData, total]);

  return (
    <div className="cards-overview space-y-6">
      {/* 상단 통계 4개 (시안) */}
      <div className="cards-stat-grid grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard tone="danger" icon="card" label="기간 카드 사용액" value={fmtWon(stats.total)} trend={stats.trend} />
        <StatCard tone="brand" icon="wallet" label="등록 카드" value={`${stats.cardCount}개`} trend={null} />
        <StatCard tone="info" icon="trendingUp" label="거래 건수" value={`${stats.txCount.toLocaleString("ko-KR")}건`} trend={null} />
        <StatCard tone="warning" icon="card" label="미등록 카드" value={`${stats.unreg}개`} trend={null} />
      </div>

      {/* 컨트롤 바 — 탭(카드 종류) + 기간/새로고침/다운로드 + 검색/정렬 */}
      <div className="cards-control-bar glass-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="seg-bar overflow-x-auto scrollbar-hide">
            {([["all", "전체"], ["credit", "신용"], ["check", "체크"], ["debit", "직불"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`seg-item ${activeTab === id ? "seg-item-active" : ""}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 기간 네비게이션 — 1개월 단위 이동 + 날짜 직접 선택 */}
            <div className="cards-date-range-nav flex items-center gap-1 bg-[var(--bg-surface)] rounded-xl px-1 py-1 border border-[var(--border)]">
              <button onClick={() => shiftMonths(-1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="이전 달">◀</button>
              <DateField
                value={fromStr}
                max={toStr}
                onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, from: d })); }}
                className="bg-transparent text-xs font-semibold text-[var(--text)] mono-number px-1 outline-none"
                aria-label="시작일"
              />
              <span className="text-[var(--text-dim)] text-xs">~</span>
              <DateField
                value={toStr}
                min={fromStr}
                onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, to: d })); }}
                className="bg-transparent text-xs font-semibold text-[var(--text)] mono-number px-1 outline-none"
                aria-label="종료일"
              />
              <button onClick={() => shiftMonths(1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="다음 달">▶</button>
            </div>
            <button onClick={() => refetch()} disabled={isFetching}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]/50 transition disabled:opacity-50">
              {isFetching ? "..." : "↻ 새로고침"}
            </button>
            <button onClick={handleDownload}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]/50 transition">
              다운로드
            </button>
          </div>
        </div>

        {/* 검색 + 정렬 */}
        <div className="cards-search-sort flex items-center gap-2 mt-4 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="카드명·끝번호·카드사 검색"
            className="flex-1 min-w-[180px] px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm"
          />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "amount" | "name")}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
            <option value="amount">사용금액순</option>
            <option value="name">이름순</option>
          </select>
        </div>
      </div>

      {/* 카드 그리드 (시안) */}
      {isLoading ? (
        <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : flatCards.length === 0 ? (
        <div className="cards-empty flex items-center justify-center py-16 glass-card">
          <div className="text-center">
            <svg className="w-12 h-12 text-[var(--text-dim)] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M21 21l-4.3-4.3" />
            </svg>
            <p className="text-[var(--text)] font-medium">{search || activeTab !== "all" ? "조건에 맞는 카드가 없습니다" : "이 기간에 카드 사용 내역이 없습니다"}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{search || activeTab !== "all" ? "검색어·필터를 조정해보세요" : "카드를 등록하거나 기간을 바꿔보세요"}</p>
          </div>
        </div>
      ) : (
        <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {flatCards.map((c) => {
            const zero = Math.round(c.spend) === 0;
            const tr = trendOf(c.key, c.spend);
            return (
              <button
                key={c.key}
                onClick={() => onSelectCard(cardClickPayload(c))}
                className="card-tile group glass-card p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <CardCompanyIcon company={c.company} size={44} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--text)] truncate" title={c.cardName}>{c.displayName}</h3>
                      <p className="text-xs text-[var(--text-dim)] truncate">{c.company}{c.last4 ? ` ·${c.last4}` : ""}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium ${c.registered ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--text-muted)]/10 text-[var(--text-muted)]"}`}>
                    {c.registered ? (TYPE_LABEL[c.cardType || ""] || "활성") : "미등록"}
                  </span>
                </div>
                <div className="mb-4">
                  <p className={`text-2xl font-bold mono-number mb-1 ${zero ? "text-[var(--text-dim)]" : "text-[var(--text)]"}`}>{fmtWon(c.spend)}</p>
                  <div className="flex items-center gap-1.5">
                    {tr != null ? (
                      <>
                        <span className={`delta-chip ${tr >= 0 ? "delta-down" : "delta-up"}`}>
                          {tr >= 0 ? "▲" : "▼"} {Math.abs(tr).toFixed(1)}%
                        </span>
                        <span className="text-xs text-[var(--text-dim)]">전월 대비</span>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--text-dim)]">{c.count}건 사용</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
                  <span className="text-xs text-[var(--text-dim)]">{c.count}건</span>
                  <svg className="w-4 h-4 text-[var(--text-dim)] group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

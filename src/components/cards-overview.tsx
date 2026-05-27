"use client";

// granter 스타일 카드 개요 (2026-05-27): 상단 전체 지출 + 카드사별 그룹 + 3열 카드 그리드.
//   - 우측 담당자/인물 이미지 없음 (사장님 명시 제외)
//   - 사용액 = card_transactions 기간 합산(getCardSpendByCompany)
//   - 카드 클릭 → onSelectCard(cardId | `codef:cardName`) 로 부모의 기존 상세 흐름 연결

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

  return (
    <div className="space-y-4">
      {/* 상단 요약 바 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-[var(--text-dim)] mb-1">기간 내 카드 지출</div>
            <div className={`text-2xl sm:text-3xl font-extrabold mono-number ${total > 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
              {fmtWon(total)}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 기간 네비게이션 — 1개월 단위 이동 + 날짜 직접 선택 */}
            <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-xl px-1 py-1 border border-[var(--border)]">
              <button onClick={() => shiftMonths(-1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="이전 달">◀</button>
              <input
                type="date"
                value={fromStr}
                max={toStr}
                onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, from: d })); }}
                className="bg-transparent text-xs font-semibold text-[var(--text)] mono-number px-1 outline-none"
                aria-label="시작일"
              />
              <span className="text-[var(--text-dim)] text-xs">~</span>
              <input
                type="date"
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
        <div className="flex items-center gap-2 mt-4 flex-wrap">
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

      {/* 카드사별 그룹 */}
      {isLoading ? (
        <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : groups.length === 0 ? (
        <div className="p-12 text-center bg-[var(--bg-card)] rounded-2xl border border-[var(--border)]">
          <div className="text-4xl mb-3">💳</div>
          <div className="text-sm text-[var(--text-muted)]">{search ? "검색 결과가 없습니다." : "이 기간에 카드 사용 내역이 없습니다."}</div>
        </div>
      ) : (
        groups.map((g) => {
          const st = styleFor(g.company);
          return (
            <div key={g.company}>
              {/* 그룹 헤더 */}
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.color }} />
                <span className="text-sm font-bold text-[var(--text)]">{g.company}</span>
                <span className="text-xs text-[var(--text-dim)]">{g.cards.length}개</span>
                <span className="ml-auto text-xs font-semibold mono-number text-[var(--danger)]">{fmtWon(g.total)}</span>
              </div>
              {/* 3열 그리드 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {g.cards.map((c) => {
                  const zero = Math.round(c.spend) === 0;
                  return (
                    <button
                      key={c.key}
                      onClick={() => onSelectCard(cardClickPayload(c))}
                      className="flex items-center gap-3 p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)]/60 hover:bg-[var(--bg-surface)] transition text-left"
                    >
                      {/* 카드사 아이콘 (로고 이미지 우선, 없으면 색상 이니셜) */}
                      <CardCompanyIcon company={g.company} />

                      {/* 카드명 + 사용액 */}
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-[var(--text)] truncate" title={c.cardName}>
                            {c.displayName}
                          </span>
                          {c.cardType && (
                            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)]">
                              {TYPE_LABEL[c.cardType] || c.cardType}
                            </span>
                          )}
                          {!c.registered && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded text-[var(--text-dim)] border border-[var(--border)]">미등록</span>
                          )}
                        </span>
                        <span className={`block text-sm font-bold mono-number mt-0.5 ${zero ? "text-[var(--text-dim)]" : "text-[var(--danger)]"}`}>
                          {fmtWon(c.spend)}
                          <span className="ml-1.5 text-[10px] font-normal text-[var(--text-dim)]">{c.count}건</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

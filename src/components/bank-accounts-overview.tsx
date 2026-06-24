"use client";

// granter 계좌 화면 스타일 통장 개요 (2026-05-27): 전체 잔액 + 기간 증감 + 은행별 그룹 + 3열 그리드.
//   - 담당자/인물 이미지 없음 (사장님 명시 제외) · 카드(/cards) 재설계와 디자인 통일
//   - 잔액 = getDistinctBankAccountNos (bank_accounts 정합분) · 증감 = getBankAccountChanges(기간 입금−출금)
//   - 잔액 계산(syncBankBalances) 무변경, 표시만.

import { useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { IconTile, TileIcon } from "@/components/ui/icon-tile";
import { getDistinctBankAccountNos, getBankAccountChanges, setBankAccountAlias } from "@/lib/queries";

// 은행 브랜드색 매핑 상수 (브랜드색은 매핑 상수 허용). logo: public/bank-logos/{logo} 있으면 표시, 없으면 이니셜.
const BANK_STYLE: { re: RegExp; label: string; color: string; initial: string; fg?: string; logo?: string }[] = [
  { re: /신한/, label: "신한은행", color: "#0046FF", initial: "신한", logo: "shinhan.svg" },
  { re: /국민|kb/i, label: "국민은행", color: "#FFBC00", initial: "KB", fg: "#1a1a1a", logo: "kb.svg" },
  { re: /기업|ibk/i, label: "IBK기업", color: "#0067AC", initial: "IBK", logo: "ibk.svg" },
  { re: /하나/, label: "하나은행", color: "#008485", initial: "하나", logo: "hana.svg" },
  { re: /우리/, label: "우리은행", color: "#0067AC", initial: "우리", logo: "woori.svg" },
  { re: /농협|nh/i, label: "농협", color: "#00A64F", initial: "NH", logo: "nh.svg" },
  { re: /카카오/, label: "카카오뱅크", color: "#FEE500", initial: "kakao", fg: "#1a1a1a", logo: "kakao.svg" },
  { re: /토스/, label: "토스뱅크", color: "#0064FF", initial: "toss", logo: "toss.svg" },
  { re: /sc|제일/i, label: "SC제일", color: "#0F7A3D", initial: "SC", logo: "sc.svg" },
  { re: /씨티|citi/i, label: "씨티은행", color: "#0560B0", initial: "씨티", logo: "citi.svg" },
  { re: /부산/, label: "부산은행", color: "#E50012", initial: "부산", logo: "busan.svg" },
  { re: /대구|im뱅크|iM/i, label: "iM뱅크", color: "#00857C", initial: "iM", logo: "im.svg" },
  { re: /새마을/, label: "새마을금고", color: "#0072BC", initial: "MG", logo: "mg.svg" },
  { re: /우체국/, label: "우체국", color: "#E2231A", initial: "우체국", logo: "post.svg" },
  { re: /산업|kdb/i, label: "KDB산업", color: "#003DA5", initial: "KDB", logo: "kdb.svg" },
  { re: /케이뱅크|k뱅크/i, label: "케이뱅크", color: "#3C50FB", initial: "K", logo: "kbank.svg" },
  { re: /미래에셋|증권|securities/i, label: "증권", color: "#FF6B00", initial: "증권", logo: "securities.svg" },
];
const BANK_FALLBACK = { label: "기타", color: "var(--text-muted)", initial: "계좌", fg: undefined as string | undefined, logo: undefined as string | undefined };

function bankStyle(name: string | undefined) {
  const n = (name || "").trim();
  for (const b of BANK_STYLE) if (b.re.test(n)) return b;
  return { re: /./, ...BANK_FALLBACK };
}
function bankGroupLabel(name: string | undefined) {
  const n = (name || "").trim();
  if (!n) return "커스텀";
  for (const b of BANK_STYLE) if (b.re.test(n)) return b.label;
  return n; // 원본 은행명 유지
}

const FX_RE = /외화|외환|달러|usd|\$|유로|eur|엔화|jpy/i;

function won(n: number): string {
  const neg = n < 0;
  return `${neg ? "-" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
}
function changeStr(n: number): string {
  if (Math.round(n) === 0) return "변화 없음";
  const up = n > 0;
  return `${up ? "+" : "-"}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")} ${up ? "증가" : "감소"}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function addMonths(d: Date, delta: number): Date {
  const t = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), dim));
}
function defaultRange(): { from: Date; to: Date } {
  const now = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
}

function BankIcon({ name, size = 40 }: { name: string | undefined; size?: number }) {
  const st = bankStyle(name);
  // 은행 로고 자산(public/bank-logos)이 아직 없어 브랜드색+이니셜로 표시. 자산 비치 시 BANK_STYLE.logo 분기 복구.
  return (
    <span className="rounded-lg shrink-0 flex items-center justify-center text-[10px] font-extrabold" style={{ width: size, height: size, background: st.color, color: st.fg || "#fff" }}>
      {st.initial}
    </span>
  );
}

// 시안 — 통장 통계 카드
function BankStat({ tone, icon, label, value, sub, valueTone }: {
  tone: "brand" | "success" | "danger";
  icon: string; label: string; value: string; sub: string; valueTone: string;
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
        <IconTile tone={tone} size={34}><TileIcon name={icon} className="w-4 h-4 text-white" /></IconTile>
      </div>
      <p className={`text-2xl font-bold mono-number mb-1 ${valueTone}`}>{value}</p>
      <p className="text-[11px] text-[var(--text-dim)]">{sub}</p>
    </div>
  );
}

// 계좌 카드 (은행색 + 잔액 숨김 토글). 클릭 → 거래 필터.
//   디자인: /cards BigCard 와 통일 — 진한 그라데이션(브랜드색→어둡게)으로 프리미엄 카드 느낌 + 흰 글씨 대비 확보,
//   블러 장식 원, 신용카드형 타이포(eyebrow 라벨·잔액 히어로·하단 끝4자리/증감).
function BankCardItem({ acc, change, selected, onSelect, onEdit }: {
  acc: { accountNo: string; alias?: string; bankName?: string; balance?: number };
  change: number; selected: boolean; onSelect: () => void; onEdit: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const st = bankStyle(acc.bankName);
  // 밝은 브랜드색(노랑·카카오 등)은 흰 글씨 대비를 위해 더 어둡게, 어두운 색은 살짝만.
  const isLight = !!st.fg; // st.fg 가 지정된 = 밝은 배경 브랜드
  const grad = `linear-gradient(135deg, ${st.color} 0%, color-mix(in srgb, ${st.color} ${isLight ? 45 : 68}%, #000000) 100%)`;
  const name = acc.alias || (acc.bankName ? `${acc.bankName} ${acc.accountNo.slice(-4)}` : acc.accountNo);
  const bal = acc.balance || 0;
  const isFx = FX_RE.test(acc.alias || "") || FX_RE.test(acc.bankName || "");
  const up = Math.round(change) > 0;
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      className={`group relative overflow-hidden rounded-2xl p-5 sm:p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-pointer text-white ${selected ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--bg)]" : ""}`}
      style={{ background: grad }}
    >
      {/* 블러 장식 (/cards 와 동일 톤) */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white rounded-full blur-3xl" />
        <div className="absolute -bottom-12 -left-10 w-40 h-40 bg-white rounded-full blur-3xl" />
      </div>
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-7">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60 mb-1 truncate">{acc.bankName || "ACCOUNT"}</p>
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-semibold truncate" title={acc.accountNo}>{name}</h3>
              {isFx && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold bg-white/25">외화</span>}
            </div>
          </div>
          <BankIcon name={acc.bankName} size={36} />
        </div>
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-white/60 mb-1.5">잔액</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold mono-number leading-none">{visible ? won(bal) : "••••••"}</p>
            <button type="button" onClick={(e) => { e.stopPropagation(); setVisible((v) => !v); }}
              className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 transition" aria-label="잔액 표시/숨김">
              {visible ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 4.6A9.8 9.8 0 0112 4.5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
              )}
            </button>
          </div>
          {Math.round(change) !== 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold mt-2 px-1.5 py-0.5 rounded-md bg-white/15 mono-number">
              <span aria-hidden>{up ? "▲" : "▼"}</span>{changeStr(change)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-white/15 pt-3">
          <span className="text-xs text-white/70 mono-number tracking-wider">•••• {acc.accountNo.slice(-4)}</span>
          <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 transition opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="별칭 편집" title="별칭 편집">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  companyId: string;
  selectedAccountNo: string;
  onSelect: (accountNo: string) => void;
}

export function BankAccountsOverview({ companyId, selectedAccountNo, onSelect }: Props) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState(defaultRange);
  const [sortBy, setSortBy] = useState<"balance" | "name">("balance");
  const [search, setSearch] = useState("");

  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);

  const { data: accounts = [], isFetching, refetch } = useQuery({
    queryKey: ["bank-accounts-distinct", companyId],
    queryFn: () => getDistinctBankAccountNos(companyId),
    enabled: !!companyId,
  });

  const { data: changes } = useQuery({
    queryKey: ["bank-account-changes", companyId, fromStr, toStr],
    queryFn: () => getBankAccountChanges(companyId, fromStr, toStr),
    enabled: !!companyId,
  });

  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const changeByAcct = changes?.byAccount || {};

  // 기간 수입/지출 (표시 전용 — 통계 3카드). getBankAccountChanges 와 동일 소스·필터.
  const { data: flow } = useQuery({
    queryKey: ["bank-period-flow", companyId, fromStr, toStr],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("bank_transactions")
        .select("amount, type")
        .eq("company_id", companyId)
        .gte("transaction_date", fromStr)
        .lte("transaction_date", toStr)
        .limit(50000);
      let income = 0, expense = 0;
      for (const r of (data || []) as Array<{ amount: number; type: string }>) {
        const amt = Math.abs(Number(r.amount || 0));
        if (r.type === "expense") expense += amt; else income += amt;
      }
      return { income, expense };
    },
    enabled: !!companyId,
  });

  // 검색·정렬된 평탄 계좌 목록 (시안 카드 그리드)
  const flatAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = accounts.filter((a) => !q || (a.alias || "").toLowerCase().includes(q) || a.accountNo.includes(q) || (a.bankName || "").toLowerCase().includes(q));
    return [...filtered].sort((a, b) =>
      sortBy === "balance" ? (b.balance || 0) - (a.balance || 0) : (a.alias || a.accountNo).localeCompare(b.alias || b.accountNo, "ko"),
    );
  }, [accounts, search, sortBy]);

  const shiftMonths = (delta: number) => setRange((r) => ({ from: addMonths(r.from, delta), to: addMonths(r.to, delta) }));

  async function handleEdit(accountNo: string, currentAlias: string | undefined, bankName: string | undefined, balance: number) {
    const next = typeof window !== "undefined" ? window.prompt("계좌 별칭", currentAlias || "") : null;
    if (next === null) return;
    await setBankAccountAlias(companyId, accountNo, next, { bankName, balance });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts-distinct", companyId] });
  }

  // 검색 + 은행별 그룹 + 정렬
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = accounts.filter((a) => {
      if (!q) return true;
      return (a.alias || "").toLowerCase().includes(q) || a.accountNo.includes(q) || (a.bankName || "").toLowerCase().includes(q);
    });
    const map = new Map<string, { label: string; items: typeof accounts; total: number }>();
    for (const a of filtered) {
      const label = bankGroupLabel(a.bankName);
      const g = map.get(label) || { label, items: [], total: 0 };
      g.items.push(a);
      g.total += a.balance || 0;
      map.set(label, g);
    }
    const arr = Array.from(map.values());
    for (const g of arr) {
      g.items = [...g.items].sort((a, b) =>
        sortBy === "balance" ? (b.balance || 0) - (a.balance || 0) : (a.alias || a.accountNo).localeCompare(b.alias || b.accountNo, "ko"),
      );
    }
    return arr.sort((a, b) => b.total - a.total);
  }, [accounts, search, sortBy]);

  const handleDownload = () => {
    const rows = ["은행,계좌명,끝4자리,잔액,기간증감"];
    for (const g of groups) {
      for (const a of g.items) {
        rows.push([g.label, `"${(a.alias || a.accountNo).replace(/"/g, "'")}"`, a.accountNo.slice(-4), Math.round(a.balance || 0), Math.round(changeByAcct[a.accountNo] || 0)].join(","));
      }
    }
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `accounts_${fromStr}_${toStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 통계 3개 (시안) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BankStat tone="brand" icon="wallet" label="전체 잔액" value={won(totalBalance)} sub={`${accounts.length}개 계좌`} valueTone="text-[var(--text)]" />
        <BankStat tone="success" icon="trendingUp" label="기간 수입" value={`+${won(flow?.income ?? 0)}`} sub="이 기간" valueTone="text-[var(--success)]" />
        <BankStat tone="danger" icon="trendingDown" label="기간 지출" value={`-${won(flow?.expense ?? 0)}`} sub="이 기간" valueTone="text-[var(--danger)]" />
      </div>

      {/* 컨트롤 — 기간/새로고침/다운로드 + 검색/정렬 */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-bold text-[var(--text)]">내 계좌 <span className="text-xs font-normal text-[var(--text-dim)]">{accounts.length}개</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-xl px-1 py-1 border border-[var(--border)]">
              <button onClick={() => shiftMonths(-1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="이전 달">◀</button>
              <DateField value={fromStr} max={toStr} onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, from: d })); }}
                className="bg-transparent text-xs font-semibold text-[var(--text)] mono-number px-1 outline-none" aria-label="시작일" />
              <span className="text-[var(--text-dim)] text-xs">~</span>
              <DateField value={toStr} min={fromStr} onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, to: d })); }}
                className="bg-transparent text-xs font-semibold text-[var(--text)] mono-number px-1 outline-none" aria-label="종료일" />
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
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="계좌명·끝번호·은행 검색"
            className="flex-1 min-w-[180px] px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "balance" | "name")}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
            <option value="balance">잔액순</option>
            <option value="name">이름순</option>
          </select>
        </div>
      </div>

      {/* 그라데이션 계좌 카드 그리드 (시안) */}
      {flatAccounts.length === 0 ? (
        <div className="flex items-center justify-center py-16 glass-card">
          <div className="text-center">
            <svg className="w-12 h-12 text-[var(--text-dim)] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11" />
            </svg>
            <p className="text-[var(--text)] font-medium">{search ? "검색 결과가 없습니다" : "표시할 계좌가 없습니다"}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{search ? "다른 키워드로 검색해보세요" : "통장을 연결하면 여기에 표시됩니다"}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {flatAccounts.map((a) => (
            <BankCardItem
              key={a.accountNo}
              acc={a}
              change={changeByAcct[a.accountNo] || 0}
              selected={selectedAccountNo === a.accountNo}
              onSelect={() => onSelect(selectedAccountNo === a.accountNo ? "" : a.accountNo)}
              onEdit={() => handleEdit(a.accountNo, a.alias, a.bankName, a.balance || 0)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

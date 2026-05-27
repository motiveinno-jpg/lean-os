"use client";

// granter 계좌 화면 스타일 통장 개요 (2026-05-27): 전체 잔액 + 기간 증감 + 은행별 그룹 + 3열 그리드.
//   - 담당자/인물 이미지 없음 (사장님 명시 제외) · 카드(/cards) 재설계와 디자인 통일
//   - 잔액 = getDistinctBankAccountNos (bank_accounts 정합분) · 증감 = getBankAccountChanges(기간 입금−출금)
//   - 잔액 계산(syncBankBalances) 무변경, 표시만.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  return `${up ? "+" : "-"}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")} ${up ? "늘었어요" : "줄었어요"}`;
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
  const [failed, setFailed] = useState(false);
  if (st.logo && !failed) {
    return (
      <span className="rounded-lg shrink-0 flex items-center justify-center overflow-hidden bg-white border border-[var(--border)]" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/bank-logos/${st.logo}`} alt={st.label} className="object-contain" style={{ width: size * 0.7, height: size * 0.7 }} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="rounded-lg shrink-0 flex items-center justify-center text-[10px] font-extrabold" style={{ width: size, height: size, background: st.color, color: st.fg || "#fff" }}>
      {st.initial}
    </span>
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
  const totalChange = changes?.total ?? 0;
  const changeByAcct = changes?.byAccount || {};

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
    <div className="space-y-4">
      {/* 상단 요약 */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-[var(--text-dim)] mb-1">전체 계좌 잔액</div>
            <div className="text-2xl sm:text-3xl font-extrabold mono-number text-[var(--text)]">{won(totalBalance)}</div>
            {Math.round(totalChange) !== 0 && (
              <div className="text-xs font-semibold mt-1" style={{ color: totalChange > 0 ? "var(--info)" : "var(--danger)" }}>
                기간 내 {changeStr(totalChange)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-xl px-1 py-1 border border-[var(--border)]">
              <button onClick={() => shiftMonths(-1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="이전 달">◀</button>
              <input type="date" value={fromStr} max={toStr} onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, from: d })); }}
                className="bg-transparent text-xs font-semibold text-[var(--text)] mono-number px-1 outline-none" aria-label="시작일" />
              <span className="text-[var(--text-dim)] text-xs">~</span>
              <input type="date" value={toStr} min={fromStr} onChange={(e) => { const d = parseYmd(e.target.value); if (d) setRange((r) => ({ ...r, to: d })); }}
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

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="계좌명·끝번호·은행 검색"
            className="flex-1 min-w-[180px] px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "balance" | "name")}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
            <option value="balance">잔액순</option>
            <option value="name">이름순</option>
          </select>
        </div>
      </div>

      {/* 은행별 그룹 */}
      {groups.length === 0 ? (
        <div className="p-12 text-center glass-card">
          <div className="text-4xl mb-3">🏦</div>
          <div className="text-sm text-[var(--text-muted)]">{search ? "검색 결과가 없습니다." : "표시할 계좌가 없습니다."}</div>
        </div>
      ) : (
        groups.map((g) => {
          const st = bankStyle(g.items[0]?.bankName);
          return (
            <div key={g.label}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.color }} />
                <span className="text-sm font-bold text-[var(--text)]">{g.label}</span>
                <span className="text-xs text-[var(--text-dim)]">{g.items.length}개</span>
                <span className="ml-auto text-xs font-semibold mono-number text-[var(--text)]">{won(g.total)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {g.items.map((a) => {
                  const name = a.alias || (a.bankName ? `${a.bankName} ${a.accountNo.slice(-4)}` : a.accountNo);
                  const bal = a.balance || 0;
                  const chg = changeByAcct[a.accountNo] || 0;
                  const isFx = FX_RE.test(a.alias || "") || FX_RE.test(a.bankName || "");
                  const selected = selectedAccountNo === a.accountNo;
                  return (
                    <div
                      key={a.accountNo}
                      onClick={() => onSelect(selected ? "" : a.accountNo)}
                      role="button"
                      tabIndex={0}
                      className={`group flex items-center gap-3 p-3.5 rounded-xl border transition text-left cursor-pointer ${
                        selected ? "bg-[var(--primary)]/10 border-[var(--primary)]" : "bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--primary)]/60 hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <BankIcon name={a.bankName} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-[var(--text)] truncate" title={a.accountNo}>{name}</span>
                          {isFx && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold text-[var(--primary)] bg-[var(--primary)]/10">외화</span>}
                        </div>
                        <div className={`text-sm font-bold mono-number mt-0.5 ${bal === 0 ? "text-[var(--text-dim)]" : bal < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{won(bal)}</div>
                        {Math.round(chg) !== 0 && (
                          <div className="text-[10px] font-semibold mono-number mt-0.5" style={{ color: chg > 0 ? "var(--info)" : "var(--danger)" }}>
                            {chg > 0 ? "+" : "-"}₩{Math.abs(Math.round(chg)).toLocaleString("ko-KR")}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleEdit(a.accountNo, a.alias, a.bankName, bal); }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--primary)] text-[var(--text-muted)] hover:text-[var(--primary)]"
                        title="별칭 편집"
                        aria-label="별칭 편집"
                      >
                        ✏️
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      <div className="text-[11px] text-[var(--text-dim)] text-center">{accounts.length}개 계좌</div>
    </div>
  );
}

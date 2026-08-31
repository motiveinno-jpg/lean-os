"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchTaxDeadlineChecks } from "@/lib/tax-deadline-checks";

interface UpcomingScheduleCardProps {
  companyId: string;
  windowDays?: number;
}

type ScheduleType = "loan" | "tax" | "contract" | "subscription";

interface ScheduleItem {
  id: string;
  type: ScheduleType;
  title: string;
  date: string; // YYYY-MM-DD
  daysLeft: number;
  amount?: number;
  href: string;
}

const TYPE_META: Record<ScheduleType, { label: string; color: string; bg: string; icon: string }> = {
  loan:         { label: "대출만기",   color: "var(--danger)",   bg: "rgba(239,68,68,0.10)",   icon: "💰" },
  tax:          { label: "세금마감",   color: "var(--warning)",  bg: "rgba(245,158,11,0.10)",  icon: "🧾" },
  contract:     { label: "계약만료",   color: "var(--primary)",  bg: "rgba(99,102,241,0.10)",  icon: "📄" },
  subscription: { label: "구독갱신",   color: "var(--success)",  bg: "rgba(34,197,94,0.10)",   icon: "🔄" },
};

function fmtKR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${Math.round(abs / 1e4)}만`;
  return abs.toLocaleString();
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86400000);
}

function nextOccurrence(today: Date, day: number): Date {
  const y = today.getFullYear();
  const m = today.getMonth();
  let target = new Date(y, m, day);
  if (target < today) target = new Date(y, m + 1, day);
  return target;
}

function fmtDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 라운드7.1 — 액션 인박스/브리핑에서 재사용할 수 있게 공개 헬퍼로 노출 (계산 로직 동일)
export function getUpcomingTaxDeadlines(windowDays = 30): ScheduleItem[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today.getTime() + windowDays * 86400000);
  return buildTaxSchedules(today, windowEnd).sort((a, b) => a.daysLeft - b.daysLeft);
}
export type { ScheduleItem };

function buildTaxSchedules(today: Date, windowEnd: Date): ScheduleItem[] {
  const items: ScheduleItem[] = [];

  //   ★ 부가세는 매달이 아니라 분기(1·4·7·10월 25일) — 매달 25일로 알리던 것을 고쳤다 (2026-08-27 ERP 2순위 '세금 일정').
  //     1·7월 = 확정 신고, 4·10월 = 예정 신고. 링크는 분석 › 부가세 › 신고서 준비.
  for (let k = 0; k < 4; k++) {
    const m = today.getMonth() + k;
    const cand = new Date(today.getFullYear(), m, 25);
    if (![0, 3, 6, 9].includes(cand.getMonth()) || cand < today) continue;
    if (cand > windowEnd) break;
    const mm = cand.getMonth();
    items.push({
      id: `vat-${fmtDateKey(cand)}`,
      type: "tax",
      title: mm === 0 || mm === 6 ? "부가세 확정 신고/납부" : "부가세 예정 신고/납부",
      date: fmtDateKey(cand),
      daysLeft: daysBetween(today, cand),
      //   신고서 준비는 재무 › 세무 신고로 옮겨 갔다 (2026-08-31 세무 1차, 결정 107)
      href: "/finance/tax-filing?tab=vat",
    });
    break;
  }

  //   연 단위 세무 기한 (2026-08-31 세무 1차, 결정 105 — 12월 결산 법인 기준):
  //     법인세 3/31 · 법인지방소득세 4/30 · 중간예납 8/31 · 근로 간이지급명세서 반기(1/31·7/31).
  //   법인세 화면(3차)이 생기기 전까지 링크는 손익(분석)으로 — 숫자를 볼 곳이 그쪽뿐이다.
  const yearly: Array<{ key: string; m: number; d: number; title: string; href: string }> = [
    { key: "cit", m: 3, d: 31, title: "법인세 신고/납부 (12월 결산)", href: "/reports/pnl" },
    { key: "cit-local", m: 4, d: 30, title: "법인지방소득세 신고/납부", href: "/reports/pnl" },
    { key: "cit-interim", m: 8, d: 31, title: "법인세 중간예납", href: "/reports/pnl" },
    { key: "sps-h2", m: 1, d: 31, title: "근로 간이지급명세서 제출 (하반기분)", href: "/finance/tax-filing" },
    { key: "sps-h1", m: 7, d: 31, title: "근로 간이지급명세서 제출 (상반기분)", href: "/finance/tax-filing" },
  ];
  for (const y of yearly) {
    for (const yr of [today.getFullYear(), today.getFullYear() + 1]) {
      const cand = new Date(yr, y.m - 1, y.d);
      if (cand < today || cand > windowEnd) continue;
      items.push({
        id: `${y.key}-${fmtDateKey(cand)}`,
        type: "tax",
        title: y.title,
        date: fmtDateKey(cand),
        daysLeft: daysBetween(today, cand),
        href: y.href,
      });
      break;
    }
  }
  //   4대보험(국민연금·건강·고용·산재) 고지분 — 매월 10일. 급여 초안엔 회사 부담분이 없으니 여기서 잊지 않게.
  const ins = nextOccurrence(today, 10);
  if (ins <= windowEnd) {
    items.push({
      id: `ins-${fmtDateKey(ins)}`,
      type: "tax",
      title: "4대보험 납부 (회사 부담분 전표 확인)",
      date: fmtDateKey(ins),
      daysLeft: daysBetween(today, ins),
      href: "/finance/status",
    });
  }

  const wht = nextOccurrence(today, 10);
  if (wht <= windowEnd) {
    items.push({
      id: `wht-${fmtDateKey(wht)}`,
      type: "tax",
      title: "원천세 신고/납부",
      date: fmtDateKey(wht),
      daysLeft: daysBetween(today, wht),
      // 신고서가 생겼다 — 재무 › 세무 신고 › 원천세 (2026-08-31 세무 1차, 결정 101. 옛 링크는 급여 페이지였다)
      href: "/finance/tax-filing",
    });
  }

  return items;
}

export function UpcomingScheduleCard({ companyId, windowDays = 30 }: UpcomingScheduleCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: items = [], isLoading } = useQuery<ScheduleItem[]>({
    queryKey: ["upcoming-schedule", companyId, windowDays],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const windowEnd = new Date(today);
      windowEnd.setDate(windowEnd.getDate() + windowDays);
      const windowEndIso = fmtDateKey(windowEnd);

      const db = supabase;
      //   2026-08-31 낡은정보 스윕: 상환 끝난 대출·해지한 구독이 만기/갱신 D-day 로 계속 뜨던 것 —
      //   상태 필터 추가. 세금 마감은 '납부 완료' 체크(tax_deadline_checks)를 읽어 걸러낸다
      //   (신호 6칸·브리핑은 이미 거르는데 정작 이 카드만 안 걸렀다).
      const [loans, docs, vault, taxChecked] = await Promise.all([
        db.from("loans")
          .select("id, name, lender, maturity_date, remaining_balance, status")
          .eq("company_id", companyId)
          .or("status.eq.active,status.is.null")
          .not("maturity_date", "is", null)
          .lte("maturity_date", windowEndIso),
        db.from("documents")
          .select("id, name, contract_end_date, contract_amount, counterparty")
          .eq("company_id", companyId)
          .not("contract_end_date", "is", null)
          .lte("contract_end_date", windowEndIso),
        db.from("vault_accounts")
          .select("id, service_name, renewal_date, monthly_cost")
          .eq("company_id", companyId)
          .eq("status", "active")
          .not("renewal_date", "is", null)
          .lte("renewal_date", windowEndIso),
        fetchTaxDeadlineChecks(companyId).catch(() => new Set<string>()),
      ]);

      const merged: ScheduleItem[] = [];

      (loans.data || []).forEach((l: any) => {
        const d = new Date(l.maturity_date);
        const dl = daysBetween(today, d);
        if (dl < 0) return;
        merged.push({
          id: `loan-${l.id}`,
          type: "loan",
          title: `${l.lender} ${l.name}`,
          date: l.maturity_date,
          daysLeft: dl,
          amount: Number(l.remaining_balance) || undefined,
          href: "/loans",
        });
      });

      (docs.data || []).forEach((d: any) => {
        const dt = new Date(d.contract_end_date);
        const dl = daysBetween(today, dt);
        if (dl < 0) return;
        merged.push({
          id: `doc-${d.id}`,
          type: "contract",
          title: d.counterparty ? `${d.counterparty} · ${d.name}` : d.name,
          date: d.contract_end_date,
          daysLeft: dl,
          amount: Number(d.contract_amount) || undefined,
          href: "/documents",
        });
      });

      (vault.data || []).forEach((v: any) => {
        const dt = new Date(v.renewal_date);
        const dl = daysBetween(today, dt);
        if (dl < 0) return;
        merged.push({
          id: `vault-${v.id}`,
          type: "subscription",
          title: v.service_name,
          date: v.renewal_date,
          daysLeft: dl,
          amount: Number(v.monthly_cost) || undefined,
          href: "/vault",
        });
      });

      merged.push(...buildTaxSchedules(today, windowEnd).filter((t) => !taxChecked.has(t.id)));

      merged.sort((a, b) => a.daysLeft - b.daysLeft);
      return merged;
    },
    enabled: !!companyId,
    refetchInterval: 5 * 60_000,
  });

  const visible = expanded ? items : items.slice(0, 5);

  return (
    <div className="upcoming-schedule-card glass-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[var(--text)]">이번 달 주요 일정</span>
          <span className="text-[9px] text-[var(--text-dim)]">D-{windowDays} 이내</span>
        </div>
        <span className="text-[10px] mono-number text-[var(--text-muted)]">{items.length}건</span>
      </div>

      {isLoading ? (
        <div className="text-[11px] text-[var(--text-dim)] text-center py-8">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-[var(--text-dim)] text-center py-8">예정된 일정이 없습니다</div>
      ) : (
        <>
          <ul className="upcoming-schedule-list">
            {visible.map((it) => {
              const meta = TYPE_META[it.type];
              const urgent = it.daysLeft <= 7;
              return (
                <li key={it.id}>
                  <Link
                    href={it.href}
                    className="upcoming-schedule-row group"
                  >
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <span className="flex-1 min-w-0 text-[11px] text-[var(--text)] truncate font-medium">
                      {it.title}
                    </span>
                    {it.amount ? (
                      <span className="text-[10px] mono-number text-[var(--text-muted)] hidden sm:inline">
                        ₩{fmtKR(it.amount)}
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 text-[10px] mono-number font-bold ${urgent ? "" : "text-[var(--text-muted)]"}`}
                      style={urgent ? { color: meta.color } : undefined}
                    >
                      D-{it.daysLeft}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > 5 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 w-full text-[10px] text-[var(--text-muted)] hover:text-[var(--primary)] py-1 transition"
            >
              {expanded ? "접기" : `+${items.length - 5}건 더보기`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

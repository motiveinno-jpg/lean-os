// 수집(불러오기) 한 곳 모으기 — 자료별 현황 조회와 실행 (2026-08-11)
//
//   그동안 수집 버튼이 다섯 화면(/tax-invoices, /e-invoices, /cash-receipts, /bank, /cards)에
//   흩어져 있어 "지금 어디까지 받아 놨나"를 한눈에 볼 수 없었다. 이 모듈이 그 다섯을 하나로 묶는다.
//
//   ⚠️ 실행 경로는 기존 화면들이 쓰던 것을 **그대로** 쓴다. 새로 만들지 않는다.
//     · 홈택스 3종(세금계산서·계산서·현금영수증) → codef-sync 의 action:'hometax-sync-async'
//       + jobType. 백그라운드 job(hometax_sync_jobs)이 생기고 진행률은 그 표를 읽어 본다.
//     · 통장·카드 → lib/data-sync 의 syncCodefData(await 로 끝까지 기다린다).
//
//   ★ 홈택스는 **한 번에 한 job 만** 돈다(다른 job 이 있으면 409 + activeJobId).
//     같은 계정으로 동시 로그인이 안 되기 때문이다(실제로 CF-12201 로 실패한 이력이 있다).
//     그래서 '전부'를 골라도 홈택스 3종은 **차례대로** 돌린다. 통장·카드는 다른 기관이라
//     홈택스와 **동시에** 돌아도 된다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type SourceKey = "tax_invoice" | "exempt_invoice" | "cash_receipt" | "card" | "bank";

/** 홈택스 백그라운드 job 으로 도는 자료 (한 번에 하나씩) */
export const HOMETAX_SOURCES: SourceKey[] = ["tax_invoice", "exempt_invoice", "cash_receipt"];

export type SourceDef = {
  key: SourceKey;
  label: string;
  icon: string;
  /** 카드를 눌렀을 때 갈 곳 — 2단계에서 /collect 안 탭으로 바뀐다 */
  href: string;
  /** 쿨타임·요금제를 세는 단위 (sync_cooldowns.sync_type) */
  syncType: "hometax" | "bank" | "card";
};

export const SOURCES: SourceDef[] = [
  { key: "tax_invoice",    label: "전자세금계산서", icon: "🧾", href: "/tax-invoices",  syncType: "hometax" },
  { key: "exempt_invoice", label: "전자계산서",     icon: "📄", href: "/e-invoices",    syncType: "hometax" },
  { key: "cash_receipt",   label: "현금영수증",     icon: "🧿", href: "/cash-receipts", syncType: "hometax" },
  { key: "card",           label: "신용카드",       icon: "💳", href: "/cards",         syncType: "card" },
  { key: "bank",           label: "통장",           icon: "🏦", href: "/transactions",  syncType: "bank" },
];

export type SourceStatus = {
  key: SourceKey;
  /** 보유 건수 (조회 기간 안) */
  total: number;
  /** 아직 전표가 안 만들어진 건수 */
  pending: number;
  /** 가진 자료 중 가장 최근 일자 */
  latestDate: string | null;
  /** 마지막 수집 시각 */
  lastSyncAt: string | null;
  /** 지난번 수집에 걸린 시간(초). 기록이 없으면 null */
  lastSeconds: number | null;
  /** 수집이 도는데 계속 0건이면 뭔가 고장난 것 — 카드에 빨갛게 띄운다 */
  brokenNote: string | null;
};

/** 조회 기간 안의 자료별 현황. 화면 하나가 다섯 자료를 한 번에 읽는다.
 *  2026-08-11 — 조회 단위가 '월'에서 **기간(시작일~종료일)** 으로 바뀌었다.
 *  끝날은 그 날까지 포함해야 하므로 lte 로 건다(예전엔 다음 달 1일 미만이었다). */
export async function fetchCollectStatus(companyId: string, from: string, to: string): Promise<Record<SourceKey, SourceStatus>> {

  //   ★ 건수는 **행을 세어서** 얻는다(count exact + head). 행을 다 받아 JS 로 세면
  //     Supabase 기본 상한 1,000행에 잘려 **건수가 틀린다** — 조회 단위가 '월'에서 '기간'으로
  //     바뀌자마자 1년치에서 실제로 '1,000건'으로 잘리는 걸 확인했다(2026-08-11).
  //   ★ select() 는 **한 번만** 부를 수 있으므로 컬럼·옵션을 인자로 받아 그때 만든다.
  //     (두 번 부르면 필터가 날아가 0건이 된다 — 실제로 겪었다)
  const dateCol = (k: SourceKey) => (k === "card" || k === "bank" ? "transaction_date" : "issue_date");
  const q = (k: SourceKey, sel: string, opts?: { count: "exact"; head: true }) => {
    switch (k) {
      case "tax_invoice":
        //   면세(전자계산서)를 빼되 tax_kind 가 비어 있는 건 남긴다 —
        //   neq 만 쓰면 NULL 행이 통째로 사라진다(대부분이 NULL 이다).
        return supabase.from("tax_invoices").select(sel, opts as any)
          .eq("company_id", companyId).neq("status", "void")
          .or("tax_kind.is.null,tax_kind.neq.exempt")
          .gte("issue_date", from).lte("issue_date", to);
      case "exempt_invoice":
        return supabase.from("tax_invoices").select(sel, opts as any)
          .eq("company_id", companyId).neq("status", "void").eq("tax_kind", "exempt")
          .gte("issue_date", from).lte("issue_date", to);
      case "cash_receipt":
        return supabase.from("cash_receipts").select(sel, opts as any)
          .eq("company_id", companyId)
          .gte("issue_date", from).lte("issue_date", to);
      case "card":
        return supabase.from("card_transactions").select(sel, opts as any)
          .eq("company_id", companyId)
          .gte("transaction_date", from).lte("transaction_date", to);
      default:
        return supabase.from("bank_transactions").select(sel, opts as any)
          .eq("company_id", companyId)
          .gte("transaction_date", from).lte("transaction_date", to);
    }
  };
  const COUNT = { count: "exact", head: true } as const;

  //   자료마다 세 가지를 묻는다: 전체 건수 · 미처리 건수 · 가진 자료 중 가장 최근 일자
  const perSource = await Promise.all(SOURCES.map(async (sdef) => {
    const k = sdef.key;
    const col = dateCol(k);
    const [total, pending, latest] = await Promise.all([
      q(k, "id", COUNT),
      //   통장은 '전표가 없다'가 아니라 '아직 처리 안 했다'가 기준 — 매칭도 처리에 들어간다
      k === "bank"
        ? (q(k, "id", COUNT) as any).is("journal_entry_id", null).eq("settlement_status", "open")
        : (q(k, "id", COUNT) as any).is("journal_entry_id", null),
      q(k, col).order(col, { ascending: false }).limit(1),
    ]);
    return {
      key: k,
      total: Number((total as any).count || 0),
      pending: Number((pending as any).count || 0),
      latestDate: (((latest as any).data as any[]) || [])[0]?.[col] ?? null,
    };
  }));
  const statOf = new Map(perSource.map((r) => [r.key, r]));

  const [cooldowns, jobs] = await Promise.all([
    supabase.from("sync_cooldowns")
      .select("sync_type, last_run_at, last_duration_sec")
      .eq("company_id", companyId),
    //   홈택스 자료는 job 이력이 정확한 '마지막 수집 시각'이다 (쿨타임은 세 자료가 공유하므로)
    supabase.from("hometax_sync_jobs")
      .select("job_type, status, total_synced, completed_at, started_at")
      .eq("company_id", companyId).eq("status", "completed")
      .order("completed_at", { ascending: false }).limit(60),
  ]);

  const cd = new Map<string, { at: string | null; sec: number | null }>();
  for (const r of ((cooldowns.data as any[]) || [])) {
    cd.set(r.sync_type, { at: r.last_run_at ?? null, sec: r.last_duration_sec ?? null });
  }

  //   job 이력에서 자료별 마지막 완료와 소요시간을 뽑는다
  const jobLast = new Map<string, { at: string | null; sec: number | null; synced: number; zeroRuns: number }>();
  for (const j of ((jobs.data as any[]) || [])) {
    const prev = jobLast.get(j.job_type);
    const sec = j.started_at && j.completed_at
      ? Math.round((new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000)
      : null;
    if (!prev) {
      jobLast.set(j.job_type, {
        at: j.completed_at ?? null, sec, synced: Number(j.total_synced || 0),
        zeroRuns: Number(j.total_synced || 0) === 0 ? 1 : 0,
      });
    } else if (prev.zeroRuns > 0 && Number(j.total_synced || 0) === 0) {
      prev.zeroRuns += 1;   // 연속 0건이 몇 번인지 — 조용히 고장난 걸 잡아낸다
    }
  }

  const brokenOf = (key: SourceKey, total: number): string | null => {
    const j = jobLast.get(key);
    if (!j) return null;
    //   수집은 '완료'로 끝났는데 받아온 게 0건이고 보유 자료도 없으면 저장 단계가 막힌 것이다
    if (j.zeroRuns >= 3 && total === 0) return `수집은 되는데 ${j.zeroRuns}회 연속 0건 — 저장 단계 확인 필요`;
    return null;
  };

  const mk = (key: SourceKey, syncType: SourceDef["syncType"]): SourceStatus => {
    const job = jobLast.get(key);
    const cool = cd.get(syncType);
    const st = statOf.get(key)!;
    return {
      key,
      total: st.total,
      pending: st.pending,
      latestDate: st.latestDate,
      //   홈택스 3종은 job 기록이 자료별로 정확하다. 통장·카드는 쿨타임 기록을 쓴다.
      lastSyncAt: (HOMETAX_SOURCES.includes(key) ? job?.at : cool?.at) ?? null,
      lastSeconds: (HOMETAX_SOURCES.includes(key) ? job?.sec : cool?.sec) ?? null,
      brokenNote: brokenOf(key, st.total),
    };
  };

  return {
    tax_invoice:    mk("tax_invoice",    "hometax"),
    exempt_invoice: mk("exempt_invoice", "hometax"),
    cash_receipt:   mk("cash_receipt",   "hometax"),
    card:           mk("card",           "card"),
    bank:           mk("bank",           "bank"),
  };
}

// ── 실행 ───────────────────────────────────────────────────────────────

export type RunPhase = "wait" | "running" | "done" | "error" | "skip";
export type RunState = { phase: RunPhase; message?: string; synced?: number };

/** 홈택스 백그라운드 job 시작 — 기존 세 화면이 쓰던 것과 완전히 같은 호출 */
async function startHometaxJob(companyId: string, jobType: SourceKey, startDate: string, endDate: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("세션이 만료되었습니다. 다시 로그인하세요.");
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ companyId, action: "hometax-sync-async", startDate, endDate, jobType }),
  });
  const result = await res.json();
  if (res.status === 409 && result.activeJobId) {
    //   다른 홈택스 수집이 이미 돌고 있다 — 그 job 이 끝나기를 기다렸다가 이어서 한다
    return { jobId: result.activeJobId as string, joined: true };
  }
  if (!res.ok || !result.jobId) throw new Error(result.error || "수집 시작 실패");
  return { jobId: result.jobId as string, joined: false };
}

/** job 이 끝날 때까지 기다린다. 진행 상황을 onTick 으로 흘려 보낸다. */
async function waitForJob(jobId: string, onTick?: (done: number, total: number) => void): Promise<{ synced: number; error?: string }> {
  //   Edge 한 번에 다 못 끝내는 자료가 있어(세금계산서 평균 17분) 넉넉히 기다린다.
  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const data = logRead("collect:job", await supabase
      .from("hometax_sync_jobs")
      .select("status, total_synced, current_progress, errors")
      .eq("id", jobId).maybeSingle());
    const job = data as any;
    if (!job) continue;
    const p = job.current_progress as any;
    if (p && onTick) onTick(Number(p.done || 0), Number(p.total || 0));
    if (job.status === "completed") return { synced: Number(job.total_synced || 0) };
    if (job.status === "failed") {
      const first = Array.isArray(job.errors) ? job.errors[0] : null;
      return { synced: Number(job.total_synced || 0), error: first?.hint || first?.message || "수집 실패" };
    }
  }
  return { synced: 0, error: "시간이 너무 오래 걸려 기다리기를 멈췄습니다 — 수집은 뒤에서 계속됩니다" };
}

/** 지난번 수집에 걸린 시간을 남긴다 — 현황판의 '지난번 N초'가 여기서 나온다.
 *  통장·카드는 지금까지 소요 시간이 어디에도 안 남아 예상 시간을 보여줄 수 없었다. */
async function recordDuration(syncType: string, seconds: number) {
  try {
    await (supabase.rpc as any)("record_sync_duration", { p_sync_type: syncType, p_seconds: Math.round(seconds) });
  } catch {
    /* 기록 실패가 수집 결과를 바꾸면 안 된다 */
  }
}

export type CollectOptions = {
  companyId: string;
  /** 고른 자료 — '전부'도 결국 전체를 고른 것일 뿐이라 같은 길로 간다 */
  sources: SourceKey[];
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  onChange: (key: SourceKey, state: RunState) => void;
};

/**
 * 고른 자료를 받아온다.
 *   · 홈택스 3종은 **차례대로** (같은 계정으로 동시 로그인이 안 된다)
 *   · 통장·카드는 그와 **동시에** (다른 기관이다)
 */
export async function runCollect(opts: CollectOptions): Promise<void> {
  const { companyId, sources, startDate, endDate, onChange } = opts;
  const ymd = (d: string) => d.replace(/-/g, "");

  const hometax = SOURCES.filter((s) => sources.includes(s.key) && HOMETAX_SOURCES.includes(s.key));
  const others = SOURCES.filter((s) => sources.includes(s.key) && !HOMETAX_SOURCES.includes(s.key));

  const hometaxChain = (async () => {
    for (const s of hometax) {
      const began = Date.now();
      onChange(s.key, { phase: "running" });
      try {
        const { jobId, joined } = await startHometaxJob(companyId, s.key, startDate, endDate);
        if (joined) onChange(s.key, { phase: "running", message: "다른 수집이 끝나기를 기다리는 중" });
        const { synced, error } = await waitForJob(jobId, (done, total) =>
          onChange(s.key, { phase: "running", message: total ? `${done}/${total}` : undefined }),
        );
        if (error) onChange(s.key, { phase: "error", message: error, synced });
        else {
          onChange(s.key, { phase: "done", synced });
          await recordDuration("hometax", (Date.now() - began) / 1000);
        }
      } catch (e: any) {
        onChange(s.key, { phase: "error", message: e?.message || "수집 실패" });
      }
    }
  })();

  const otherRuns = others.map(async (s) => {
    const began = Date.now();
    onChange(s.key, { phase: "running" });
    try {
      const { syncCodefData, syncBankBalances } = await import("@/lib/data-sync");
      const result = await syncCodefData(companyId, s.key === "bank" ? "bank" : "card", ymd(startDate), ymd(endDate));
      if (!result.success && result.status !== "partial") {
        onChange(s.key, { phase: "error", message: result.error || "수집 실패" });
        return;
      }
      const synced = (s.key === "bank" ? result.bankSynced : result.cardSynced) ?? 0;
      //   통장은 잔액까지 맞춰 준다 — /bank 화면이 하던 것과 같다
      if (s.key === "bank") { try { await syncBankBalances(companyId); } catch { /* 잔액 실패는 수집 결과와 별개 */ } }
      onChange(s.key, { phase: "done", synced });
      await recordDuration(s.key, (Date.now() - began) / 1000);
    } catch (e: any) {
      onChange(s.key, { phase: "error", message: e?.message || "수집 실패" });
    }
  });

  await Promise.all([hometaxChain, ...otherRuns]);
}

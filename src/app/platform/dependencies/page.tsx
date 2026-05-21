"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type Health = {
  supabase: { errors_24h: number; errors_1h: number; sample_query_ok: boolean };
  codef: { bank_tx_24h: number; card_tx_24h: number; note: string };
  stripe: { paid_invoices_24h: number; failed_invoices_24h: number };
  signatures: { approvals_24h: number; fully_signed_24h: number };
  at: string;
};

function StatusBadge({ status }: { status: "ok" | "warn" | "down" }) {
  const tone =
    status === "ok"
      ? "bg-emerald-500/20 text-emerald-300"
      : status === "warn"
      ? "bg-amber-500/20 text-amber-300"
      : "bg-red-500/20 text-red-300";
  const label = status === "ok" ? "정상" : status === "warn" ? "주의" : "장애";
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tone}`}>● {label}</span>;
}

export default function PlatformDependenciesPage() {
  const { data, isLoading, refetch } = useQuery<Health>({
    queryKey: ["op-deps-health"],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_dependencies_health");
      if (error) throw error;
      return data as Health;
    },
    refetchInterval: 60000,
  });

  // 상태 판정 휴리스틱
  const supabaseStatus: "ok" | "warn" | "down" = !data
    ? "down"
    : data.supabase.errors_1h > 50
    ? "warn"
    : "ok";
  const stripeStatus: "ok" | "warn" | "down" = !data
    ? "ok"
    : data.stripe.failed_invoices_24h > 5
    ? "warn"
    : "ok";

  const codefStatus: "ok" | "warn" | "down" =
    data && data.codef.bank_tx_24h + data.codef.card_tx_24h === 0 ? "warn" : "ok";

  type Card = {
    name: string;
    status: "ok" | "warn" | "down";
    desc: string;
    links: { label: string; href: string }[];
    blockedOn: string;
    warning?: string;
  };

  const cards: Card[] = [
    {
      name: "Supabase (DB + Auth)",
      status: supabaseStatus,
      desc: data
        ? `최근 1시간 에러 ${data.supabase.errors_1h}건 / 24시간 ${data.supabase.errors_24h}건`
        : "헬스 미수신",
      links: [
        { label: "status.supabase.com", href: "https://status.supabase.com" },
      ],
      blockedOn: "auth · DB · RLS · Realtime · Storage · Edge Functions 전체",
    },
    {
      name: "CODEF (은행 + 카드 + 홈택스)",
      status: codefStatus,
      desc: data
        ? `24h 통장 ${data.codef.bank_tx_24h.toLocaleString()} · 카드 ${data.codef.card_tx_24h.toLocaleString()}`
        : "—",
      links: [{ label: "codef.io 대시보드", href: "https://developer.codef.io" }],
      blockedOn: "은행·카드 자동 동기화 · 홈택스 세금계산서",
      warning: data?.codef.note,
    },
    {
      name: "Stripe (결제)",
      status: stripeStatus,
      desc: data
        ? `24h 결제 성공 ${data.stripe.paid_invoices_24h} · 실패/연체 ${data.stripe.failed_invoices_24h}`
        : "—",
      links: [
        { label: "status.stripe.com", href: "https://status.stripe.com" },
        { label: "Stripe 대시보드", href: "https://dashboard.stripe.com" },
      ],
      blockedOn: "유료 구독 결제 · 인보이스 발행",
    },
    {
      name: "Resend (메일 발송)",
      status: "ok" as const,
      desc: "내부 발송 로그 미연결 — 헬스는 사이드 시그널만",
      links: [{ label: "status.resend.com", href: "https://status.resend.com" }],
      blockedOn: "견적·계약서 메일 · 알림 메일",
    },
    {
      name: "전자서명 (자체 + Resend)",
      status: "ok" as const,
      desc: data
        ? `24h 승인요청 ${data.signatures.approvals_24h} · 양방향 완료 ${data.signatures.fully_signed_24h}`
        : "—",
      links: [],
      blockedOn: "견적·계약 양방향 서명 · 직인",
    },
    {
      name: "Vercel (호스팅 + Edge)",
      status: "ok" as const,
      desc: "본 페이지가 보인다면 정상",
      links: [{ label: "vercel-status.com", href: "https://www.vercel-status.com" }],
      blockedOn: "SSR · API routes · 정적 배포",
    },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">의존성 상태</h1>
          <p className="text-sm text-[#64748b] mt-1">
            외부 서비스 신호등 + 영향도. {data?.at ? `갱신: ${new Date(data.at).toLocaleTimeString("ko-KR")}` : ""}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="px-3 py-2 bg-[#1e293b] hover:bg-[#1e293b]/70 text-cyan-300 text-xs font-semibold rounded-lg transition"
        >
          ↻ 갱신
        </button>
      </div>

      {isLoading && <div className="text-sm text-[#64748b]">불러오는 중…</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.name} className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold text-white">{c.name}</div>
              <StatusBadge status={c.status} />
            </div>
            <div className="text-xs text-[#94a3b8] mb-3">{c.desc}</div>
            {c.warning && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 rounded-lg p-2 mb-2">
                ⚠ {c.warning}
              </div>
            )}
            <div className="text-[10px] text-[#64748b] mb-2">
              <span className="font-bold uppercase tracking-wider">영향도:</span> {c.blockedOn}
            </div>
            <div className="flex flex-wrap gap-2">
              {c.links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-cyan-400 hover:underline"
                >
                  {l.label} ↗
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-cyan-600/5 border border-cyan-600/20 rounded-2xl p-4 text-xs text-[#94a3b8]">
        <span className="text-cyan-400 font-bold">OP-F</span> · 헬스 휴리스틱은 사이드 시그널만 (실제 ping X).
        외부 status 페이지로 직접 검증 권장. 1분 간격 자동 갱신.
      </div>
    </div>
  );
}

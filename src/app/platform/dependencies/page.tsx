"use client";
// 외부 서비스 상태 — 2026-09-03 v2 pf 디자인. 판정 로직(RPC operator_dependencies_health)은 그대로.
import { SystemTabs } from "../_components/system-tabs";
import { Ico } from "@/components/ui-icon";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfBadge, PfKpi, PfSkeleton } from "../_components/pf/ui";

const db = supabase;

type Health = {
  supabase: { errors_24h: number; errors_1h: number; sample_query_ok: boolean };
  codef: { bank_tx_24h: number; card_tx_24h: number; note: string };
  stripe: { paid_invoices_24h: number; failed_invoices_24h: number };
  signatures: { approvals_24h: number; fully_signed_24h: number };
  at: string;
};

type DepStatus = "ok" | "warn" | "down" | "loading";
const STATUS_LABEL: Record<DepStatus, string> = { ok: "정상", warn: "주의", down: "장애", loading: "확인 중" };
const STATUS_BADGE: Record<DepStatus, "ok" | "warn" | "danger" | "muted"> = { ok: "ok", warn: "warn", down: "danger", loading: "muted" };

function StatusDot({ status }: { status: DepStatus }) {
  if (status === "ok") return <span className="pf-live" />;
  if (status === "loading") return <span className="pf-live pf-live-off" />;
  return <span className="inline-block w-2 h-2 rounded-full" style={{ background: status === "warn" ? "#D97706" : "var(--danger)" }} />;
}

export default function PlatformDependenciesPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<Health>({
    queryKey: ["op-deps-health"],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_dependencies_health");
      if (error) throw error;
      return data as Health;
    },
    refetchInterval: 60000,
  });

  // 상태 판정 (2026-07-28 정정): 헬스체크 "호출 실패"는 서비스 장애가 아니다 —
  //   권한 거부·네트워크 문제를 전 서비스 '장애'로 표시해 큰 혼란을 줬던 문제.
  //   호출 실패 시엔 판정을 보류(loading 배지)하고 아래 배너로 실패 원인을 설명한다.
  const checkFailed = !!error;
  const failReason = checkFailed
    ? (/forbidden|운영자/i.test((error as any)?.message || "")
        ? "권한 없음 — 이 화면은 플랫폼 운영자 계정(creative@mo-tive.com)만 조회할 수 있습니다."
        : `상태 조회 실패 — ${(error as any)?.message || "네트워크 또는 서버 오류"}`)
    : null;
  const baseStatus: DepStatus | null = checkFailed || !data ? "loading" : null;
  const supabaseStatus: DepStatus = baseStatus ?? (data!.supabase.errors_1h > 50 ? "warn" : "ok");
  const stripeStatus: DepStatus = baseStatus ?? (data!.stripe.failed_invoices_24h > 5 ? "warn" : "ok");
  const codefStatus: DepStatus = baseStatus ?? (data!.codef.bank_tx_24h + data!.codef.card_tx_24h === 0 ? "warn" : "ok");

  type Card = {
    name: string;
    plain: string;          // 비전공자용 한 줄 — 이게 뭐 하는 서비스인지
    status: DepStatus;
    desc: string;
    links: { label: string; href: string }[];
    blockedOn: string;
    warning?: string;
  };

  const cards: Card[] = [
    {
      name: "Supabase",
      plain: "오너뷰의 데이터베이스와 로그인",
      status: supabaseStatus,
      desc: data
        ? `최근 1시간 오류 ${data.supabase.errors_1h}건 / 24시간 ${data.supabase.errors_24h}건`
        : "헬스 미수신",
      links: [
        { label: "status.supabase.com", href: "https://status.supabase.com" },
      ],
      blockedOn: "로그인 · 모든 화면의 데이터 · 파일 저장 · 서버 기능",
    },
    {
      name: "CODEF",
      plain: "은행·카드·홈택스 자동 수집",
      status: codefStatus,
      desc: data
        ? `24시간 통장 거래 ${data.codef.bank_tx_24h.toLocaleString()}건 · 카드 거래 ${data.codef.card_tx_24h.toLocaleString()}건`
        : "—",
      links: [{ label: "codef.io 대시보드", href: "https://developer.codef.io" }],
      blockedOn: "은행·카드 자동 수집 · 홈택스 세금계산서",
      warning: data?.codef.note,
    },
    {
      name: "Stripe",
      plain: "구독 결제",
      status: stripeStatus,
      desc: data
        ? `24시간 결제 성공 ${data.stripe.paid_invoices_24h}건 · 실패/연체 ${data.stripe.failed_invoices_24h}건`
        : "—",
      links: [
        { label: "status.stripe.com", href: "https://status.stripe.com" },
        { label: "Stripe 대시보드", href: "https://dashboard.stripe.com" },
      ],
      blockedOn: "유료 구독 결제 · 청구서 발행",
    },
    {
      name: "Resend",
      plain: "메일 발송",
      status: "ok" as const,
      desc: "내부 발송 기록과는 연결돼 있지 않아 간접 신호만 봅니다",
      links: [{ label: "status.resend.com", href: "https://status.resend.com" }],
      blockedOn: "견적·계약서 메일 · 알림 메일",
    },
    {
      name: "전자서명",
      plain: "오너뷰 자체 서명 + 메일 발송",
      status: "ok" as const,
      desc: data
        ? `24시간 결재 요청 ${data.signatures.approvals_24h}건 · 양쪽 서명 완료 ${data.signatures.fully_signed_24h}건`
        : "—",
      links: [],
      blockedOn: "견적·계약 양방향 서명 · 직인",
    },
    {
      name: "Vercel",
      plain: "오너뷰 화면을 띄우는 서버",
      status: "ok" as const,
      desc: "이 화면이 보인다면 정상입니다",
      links: [{ label: "vercel-status.com", href: "https://www.vercel-status.com" }],
      blockedOn: "모든 화면 표시 · 서버 경로",
    },
  ];

  const okCount = cards.filter((c) => c.status === "ok").length;
  const warnCount = cards.filter((c) => c.status === "warn" || c.status === "down").length;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="외부 서비스"
        desc="오너뷰가 기대고 있는 바깥 서비스들이 지금 잘 돌아가는지 봅니다. 1분마다 자동으로 새로 고칩니다."
        actions={
          <>
            {data?.at && <span className="text-[11px] text-[var(--text-dim)]">갱신 {new Date(data.at).toLocaleTimeString("ko-KR")}</span>}
            <button type="button" onClick={() => refetch()} disabled={isFetching} className="pf-btn disabled:opacity-50">↻ 지금 확인</button>
          </>
        }
      />
      <SystemTabs />

      {failReason && (
        <PfCard i={2} hover={false} className="ring-1 ring-[#D97706]/40">
          <div className="px-5 py-3 text-[12px]" style={{ color: "#b45309" }}>
            <span className="font-bold"><Ico e="⚠" /> 서비스 상태를 판정하지 못했습니다.</span> {failReason}
            <span className="block mt-1 text-[11px] opacity-80">이것은 외부 서비스 장애 판정이 아닙니다 — 실제 장애 여부는 시스템 상태 화면의 신호등·타임라인에서 확인하세요.</span>
          </div>
        </PfCard>
      )}

      <div className="pf-kpi-grid">
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="정상" value={okCount} unit="개" live={okCount > 0 && warnCount === 0} /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="주의·장애" value={warnCount} unit="개" accent={warnCount > 0} /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="24시간 은행·카드 수집" value={data ? data.codef.bank_tx_24h + data.codef.card_tx_24h : 0} unit="건" /></PfCard>
        <PfCard i={5} className="pf-kpi-tile"><PfKpi label="24시간 결제 성공" value={data?.stripe.paid_invoices_24h ?? 0} unit="건" /></PfCard>
      </div>

      {isLoading && <PfCard i={6}><PfCardBody className="pt-5"><PfSkeleton rows={3} h={16} /></PfCardBody></PfCard>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c, idx) => (
          <PfCard key={c.name} i={6 + idx} className={c.status === "warn" ? "ring-1 ring-[#D97706]/40" : c.status === "down" ? "ring-1 ring-[var(--danger)]/40" : ""}>
            <PfCardHead
              title={<span className="flex items-center gap-2"><StatusDot status={c.status} />{c.name}</span>}
              sub={c.plain}
              right={<PfBadge tone={STATUS_BADGE[c.status]}>{STATUS_LABEL[c.status]}</PfBadge>}
            />
            <PfCardBody className="space-y-2">
              <div className="text-[12px] text-[var(--text-muted)]">{c.desc}</div>
              {c.warning && (
                <div className="text-[11px] rounded-lg px-2.5 py-2" style={{ color: "#b45309", background: "color-mix(in oklab, #D97706 12%, transparent)" }}>
                  <Ico e="⚠" /> {c.warning}
                </div>
              )}
              <div className="text-[11px] text-[var(--text-dim)]">
                <span className="font-bold">멈추면 안 되는 것:</span> {c.blockedOn}
              </div>
              {c.links.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {c.links.map((l) => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="pf-chip">{l.label} ↗</a>
                  ))}
                </div>
              )}
            </PfCardBody>
          </PfCard>
        ))}
      </div>

      <p className="text-[11px] text-[var(--text-dim)] px-1 pf-in" style={{ ["--pf-i" as string]: 13 }}>
        여기 표시되는 상태는 오너뷰 안의 간접 신호로 추정한 값이라 실제와 다를 수 있습니다. 정확한 확인은 각 서비스의 공식 상태 페이지에서 하세요.
      </p>
    </PfPage>
  );
}

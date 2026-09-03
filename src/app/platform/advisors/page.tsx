"use client";

// 플랫폼 운영자 — 제휴 세무사 관리 (2026-08-11 신설).
//   세무사는 /advisor 포털에서 가입(pending) → 여기서 승인(active) + 회사 연결.
//   tax_advisors/advisor_company_links 조작은 전부 operator_* SECURITY DEFINER RPC.
//   2026-09-03 운영자 페이지 v2 — pf-* 디자인(KPI·세무사 카드·연결 폼). 데이터·동작은 그대로.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch } from "../_components/ops-kit";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";

const db = supabase;

type Advisor = {
  id: string; name: string; office_name: string | null; email: string; phone: string | null;
  specialty: string | null; status: string; created_at: string; approved_at: string | null; link_count: number;
};
type AdvisorLink = { id: string; company_id: string; company_name: string; status: string; created_at: string };

const STATUS: Record<string, { label: string; tone: "warn" | "ok" | "danger" }> = {
  pending: { label: "승인 대기", tone: "warn" },
  active: { label: "활성", tone: "ok" },
  suspended: { label: "중지", tone: "danger" },
};

export default function PlatformAdvisorsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: advisors = [], isLoading } = useQuery<Advisor[]>({
    queryKey: ["op-advisors"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("operator_list_advisors");
      if (error) throw error;
      return (data || []) as Advisor[];
    },
    refetchInterval: 60_000,
  });

  // 연결용 회사 목록 (운영자는 companies 전체 조회 가능 — customers 페이지와 동일 경로)
  const { data: companies = [] } = useQuery({
    queryKey: ["op-advisor-companies"],
    queryFn: async () => {
      const data = logRead("platform/advisors:companies", await (db as any)
        .from("companies").select("id, name, business_number").order("name"));
      return (data || []) as { id: string; name: string; business_number: string | null }[];
    },
  });

  const { data: links = [] } = useQuery<AdvisorLink[]>({
    queryKey: ["op-advisor-links", openId],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("operator_advisor_links", { p_advisor_id: openId });
      if (error) throw error;
      return (data || []) as AdvisorLink[];
    },
    enabled: !!openId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["op-advisors"] });
    qc.invalidateQueries({ queryKey: ["op-advisor-links"] });
  };

  const setStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (db as any).rpc("operator_set_advisor_status", { p_advisor_id: id, p_status: status });
      if (error) throw error;
      // 승인 시 세무사에게 안내 메일 — 베스트에포트
      if (status === "active") db.functions.invoke("advisor-notify", { body: { event: "approved", advisor_id: id } }).catch(() => {});
    },
    onSuccess: invalidate,
  });

  const [linkCompanyId, setLinkCompanyId] = useState("");
  const linkMut = useMutation({
    mutationFn: async ({ advisorId, companyId }: { advisorId: string; companyId: string }) => {
      const { error } = await (db as any).rpc("operator_link_advisor", { p_advisor_id: advisorId, p_company_id: companyId });
      if (error) throw error;
      db.functions.invoke("advisor-notify", { body: { event: "linked", advisor_id: advisorId } }).catch(() => {});
    },
    onSuccess: () => { setLinkCompanyId(""); invalidate(); },
  });
  const unlinkMut = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await (db as any).rpc("operator_unlink_advisor", { p_link_id: linkId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return advisors;
    return advisors.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.office_name || "").toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
  }, [advisors, search]);

  const counts = useMemo(() => {
    const c = { pending: 0, active: 0, suspended: 0, linked: 0 };
    advisors.forEach((a) => {
      if (a.status in c) (c as Record<string, number>)[a.status]++;
      c.linked += a.link_count || 0;
    });
    return c;
  }, [advisors]);

  return (
    <PfPage>
      <PfPageHead
        eyebrow="지원"
        title="제휴 세무사"
        desc="세무사가 owner-view.com/advisor 에서 가입하면 여기서 승인하고, 담당 회사를 연결합니다. 연결된 회사 데이터만 볼 수 있고 좌석 요금은 들지 않습니다."
        actions={<OpsSearch value={search} onChange={setSearch} placeholder="이름·사무소·이메일 검색" />}
      />

      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="승인 기다리는 세무사" value={counts.pending} unit="명" live={counts.pending > 0} accent={counts.pending > 0} /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="활동 중" value={counts.active} unit="명" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="중지" value={counts.suspended} unit="명" /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="연결된 회사" value={counts.linked} unit="곳" /></PfCard>
      </div>

      {isLoading ? (
        <PfCard i={5}><PfCardBody className="pt-5"><PfSkeleton h={18} rows={3} /></PfCardBody></PfCard>
      ) : shown.length === 0 ? (
        <PfCard i={5}>
          <PfEmpty>
            {advisors.length === 0
              ? <>아직 가입한 세무사가 없습니다. 세무사에게 <span className="font-semibold text-[var(--text)]">owner-view.com/advisor</span> 가입을 안내하세요.</>
              : "검색 결과가 없습니다"}
          </PfEmpty>
        </PfCard>
      ) : (
        <div className="space-y-3">
          {shown.map((a, idx) => {
            const st = STATUS[a.status] || STATUS.pending;
            const open = openId === a.id;
            return (
              <PfCard key={a.id} i={5 + idx} hover={!open}>
                <PfCardHead
                  title={<>{a.name}{a.office_name && <span className="text-[12px] font-medium text-[var(--text-muted)]">{a.office_name}</span>}<PfBadge tone={st.tone}>{st.label}</PfBadge></>}
                  sub={<>{a.email}{a.phone ? ` · ${a.phone}` : ""}{a.specialty ? ` · ${a.specialty}` : ""} · 연결 {a.link_count}개사 · 가입 {String(a.created_at).slice(0, 10)}</>}
                  right={
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.status !== "active" && (
                        <button className="pf-btn pf-btn-sm pf-btn-primary" disabled={setStatusMut.isPending}
                          onClick={() => setStatusMut.mutate({ id: a.id, status: "active" })}>승인</button>
                      )}
                      {a.status === "active" && (
                        <button className="pf-btn pf-btn-sm pf-btn-ghost" disabled={setStatusMut.isPending}
                          onClick={async () => { if (await appConfirm("이 세무사를 중지하시겠습니까? 연결된 회사 조회가 즉시 차단됩니다.", { danger: true })) setStatusMut.mutate({ id: a.id, status: "suspended" }); }}>중지</button>
                      )}
                      <button className={`pf-btn pf-btn-sm ${open ? "" : "pf-btn-ghost"}`} onClick={() => setOpenId(open ? null : a.id)}>
                        {open ? "닫기" : "회사 연결"}
                      </button>
                    </div>
                  }
                />

                {open && (
                  <PfCardBody>
                    <div className="rounded-2xl border border-[var(--border)]/70 bg-[var(--bg-surface)]/60 p-4">
                      <div className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mb-2">회사 연결</div>
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <select value={linkCompanyId} onChange={(e) => setLinkCompanyId(e.target.value)} className="field-input flex-1 min-w-[220px]">
                          <option value="">연결할 회사 선택…</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}{c.business_number ? ` (${c.business_number})` : ""}</option>
                          ))}
                        </select>
                        <button className="pf-btn pf-btn-primary" disabled={!linkCompanyId || linkMut.isPending}
                          onClick={() => linkMut.mutate({ advisorId: a.id, companyId: linkCompanyId })}>연결</button>
                      </div>
                      {links.length === 0 ? (
                        <div className="text-[12px] text-[var(--text-dim)] py-2">연결된 회사가 없습니다.</div>
                      ) : (
                        <div className="pf-rows">
                          {links.map((l) => (
                            <div key={l.id} className="pf-row !px-2">
                              <span className="pf-row-title">{l.company_name}</span>
                              <PfBadge tone={l.status === "active" ? "ok" : "muted"}>{l.status === "active" ? "연결됨" : "해제됨"}</PfBadge>
                              <span className="text-[11px] text-[var(--text-dim)] ml-auto mono-number">{String(l.created_at).slice(0, 10)}</span>
                              {l.status === "active" && (
                                <button className="pf-btn pf-btn-sm pf-btn-ghost text-[var(--danger)]" disabled={unlinkMut.isPending}
                                  onClick={async () => { if (await appConfirm(`${l.company_name} 연결을 해제하시겠습니까?`, { danger: true })) unlinkMut.mutate(l.id); }}>해제</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </PfCardBody>
                )}
              </PfCard>
            );
          })}
        </div>
      )}
    </PfPage>
  );
}

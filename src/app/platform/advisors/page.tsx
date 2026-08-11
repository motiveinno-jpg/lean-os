"use client";

// 플랫폼 운영자 — 제휴 세무사 관리 (2026-08-11 신설).
//   세무사는 /advisor 포털에서 가입(pending) → 여기서 승인(active) + 회사 연결.
//   tax_advisors/advisor_company_links 조작은 전부 operator_* SECURITY DEFINER RPC.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch } from "../_components/ops-kit";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

const db = supabase;

type Advisor = {
  id: string; name: string; office_name: string | null; email: string; phone: string | null;
  specialty: string | null; status: string; created_at: string; approved_at: string | null; link_count: number;
};
type AdvisorLink = { id: string; company_id: string; company_name: string; status: string; created_at: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "승인 대기", cls: "bg-amber-500/10 text-amber-600" },
  active: { label: "활성", cls: "bg-emerald-500/10 text-emerald-600" },
  suspended: { label: "중지", cls: "bg-rose-500/10 text-rose-600" },
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
    },
    onSuccess: invalidate,
  });

  const [linkCompanyId, setLinkCompanyId] = useState("");
  const linkMut = useMutation({
    mutationFn: async ({ advisorId, companyId }: { advisorId: string; companyId: string }) => {
      const { error } = await (db as any).rpc("operator_link_advisor", { p_advisor_id: advisorId, p_company_id: companyId });
      if (error) throw error;
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

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">제휴 세무사</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            /advisor 포털 가입자 {advisors.length}명 — 승인 후 회사를 연결하면 그 회사 데이터를 조회할 수 있습니다 (좌석 비과금)
          </p>
        </div>
        <OpsSearch value={search} onChange={setSearch} placeholder="이름·사무소·이메일 검색" />
      </div>

      {isLoading ? (
        <div className="text-sm text-[var(--text-dim)] py-10 text-center">불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="platform-advisors-empty">
          아직 가입한 세무사가 없습니다. 세무사에게 <span className="font-semibold text-[var(--text)]">owner-view.com/advisor</span> 가입을 안내하세요.
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((a) => {
            const st = STATUS[a.status] || STATUS.pending;
            const open = openId === a.id;
            return (
              <div key={a.id} className="platform-advisor-card">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[15px] text-[var(--text)]">{a.name}</span>
                      {a.office_name && <span className="text-sm text-[var(--text-muted)]">{a.office_name}</span>}
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-xs text-[var(--text-dim)] mt-0.5">
                      {a.email}{a.phone ? ` · ${a.phone}` : ""}{a.specialty ? ` · ${a.specialty}` : ""} · 연결 {a.link_count}개사
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {a.status !== "active" && (
                      <button className="platform-advisor-btn-primary" disabled={setStatusMut.isPending}
                        onClick={() => setStatusMut.mutate({ id: a.id, status: "active" })}>승인</button>
                    )}
                    {a.status === "active" && (
                      <button className="platform-advisor-btn-ghost" disabled={setStatusMut.isPending}
                        onClick={async () => { if (await appConfirm("이 세무사를 중지하시겠습니까? 연결된 회사 조회가 즉시 차단됩니다.", { danger: true })) setStatusMut.mutate({ id: a.id, status: "suspended" }); }}>중지</button>
                    )}
                    <button className="platform-advisor-btn-ghost" onClick={() => setOpenId(open ? null : a.id)}>
                      {open ? "닫기" : "회사 연결"}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="platform-advisor-links">
                    <div className="flex items-center gap-2 mb-3">
                      <select value={linkCompanyId} onChange={(e) => setLinkCompanyId(e.target.value)} className="platform-advisor-company-select">
                        <option value="">연결할 회사 선택…</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}{c.business_number ? ` (${c.business_number})` : ""}</option>
                        ))}
                      </select>
                      <button className="platform-advisor-btn-primary" disabled={!linkCompanyId || linkMut.isPending}
                        onClick={() => linkMut.mutate({ advisorId: a.id, companyId: linkCompanyId })}>연결</button>
                    </div>
                    {links.length === 0 ? (
                      <div className="text-xs text-[var(--text-dim)]">연결된 회사가 없습니다.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {links.map((l) => (
                          <div key={l.id} className="platform-advisor-link-row">
                            <span className="text-sm font-semibold text-[var(--text)]">{l.company_name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${l.status === "active" ? "bg-emerald-500/10 text-emerald-600" : "bg-[var(--bg-surface)] text-[var(--text-dim)]"}`}>
                              {l.status === "active" ? "연결됨" : "해제됨"}
                            </span>
                            <span className="text-[11px] text-[var(--text-dim)] ml-auto">{String(l.created_at).slice(0, 10)}</span>
                            {l.status === "active" && (
                              <button className="platform-advisor-btn-danger" disabled={unlinkMut.isPending}
                                onClick={async () => { if (await appConfirm(`${l.company_name} 연결을 해제하시겠습니까?`, { danger: true })) unlinkMut.mutate(l.id); }}>해제</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

// 플랫폼 운영자 — 랜딩 제휴·도입 문의함 (2026-07-27 신설).
//   partnership_inquiries 는 RLS 정책 0개(PII 차단) → operator_* SECURITY DEFINER RPC 로만 조회/수정.
//   접수는 /api/partnership (service_role) 경유.
//   2026-09-03 운영자 페이지 v2 — pf-* 디자인(KPI·상태 도넛·타임라인 목록). 데이터·동작은 그대로.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch, OpsCompanySelect, OpsExportButton, exportCsv } from "../_components/ops-kit";
import { kstDateStr } from "@/lib/kst";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";
import { PfDonut } from "@/app/platform/_components/pf/charts";

const db = supabase;

type Inquiry = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  created_at: string;
};

const STATUS: Record<string, { tone: "warn" | "info" | "ok"; label: string; color: string }> = {
  new: { tone: "warn", label: "신규", color: "var(--chart-2)" },
  contacted: { tone: "info", label: "연락함", color: "var(--chart-1)" },
  closed: { tone: "ok", label: "종료", color: "var(--chart-3)" },
};

//   전역 copy-protection(body user-select:none) 아래서도 확실히 복사되게 — clipboard API 우선,
//   막히면(권한/비보안 컨텍스트) textarea+execCommand 폴백. (2026-09-01 사장님: 문의 복사 안 됨)
function copyText(text: string) {
  try { navigator.clipboard?.writeText(text).catch(() => {}); } catch { /* ignore */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.top = "-9999px"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch { /* ignore */ }
}

export default function PlatformPartnershipPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<Inquiry[]>({
    queryKey: ["op-partnership", filter],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_list_partnership_inquiries", {
        p_limit: 200,
        ...(filter ? { p_status: filter } : {}),
      });
      if (error) throw error;
      return (data || []) as Inquiry[];
    },
    refetchInterval: 60_000,
  });

  // 검색 (2026-07-28 전면 정비) — 회사·담당자·이메일·내용
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.company_name) set.add(it.company_name); });
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [items]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (companyFilter !== "all" && (it.company_name || "") !== companyFilter) return false;
      if (!q) return true;
      return (it.company_name || "").toLowerCase().includes(q) ||
        (it.contact_name || "").toLowerCase().includes(q) ||
        (it.email || "").toLowerCase().includes(q) ||
        (it.message || "").toLowerCase().includes(q);
    });
  }, [items, search, companyFilter]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db.rpc("operator_set_partnership_inquiry_status", { p_id: id, p_status: status });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["op-partnership"] }),
  });

  // KPI·구성 — 현재 불러온 목록(필터 반영) 기준
  const counts = useMemo(() => {
    const c = { new: 0, contacted: 0, closed: 0 };
    items.forEach((it) => { if (it.status in c) (c as Record<string, number>)[it.status]++; });
    return c;
  }, [items]);
  const thisWeek = useMemo(() => {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    return items.filter((it) => new Date(it.created_at).getTime() >= since).length;
  }, [items]);

  return (
    <PfPage>
      <PfPageHead
        eyebrow="지원"
        title="도입·제휴 문의"
        desc="홈페이지 문의 폼으로 들어온 도입·제휴 요청입니다. 연락한 뒤 '연락함', 마무리되면 '종료'로 바꿔 두면 신규 건만 남습니다."
        actions={
          <>
            <OpsCompanySelect value={companyFilter} onChange={setCompanyFilter} options={companyOptions} />
            <OpsSearch value={search} onChange={setSearch} placeholder="회사·담당자·이메일 검색" />
            <OpsExportButton
              disabled={shown.length === 0}
              onClick={() => exportCsv(shown.map((it) => ({
                상태: it.status, 회사: it.company_name || "", 담당자: it.contact_name || "",
                이메일: it.email || "", 전화: it.phone || "",
                내용: (it.message || "").slice(0, 200), 접수일: String(it.created_at).slice(0, 10),
              })), "도입문의")}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        <div className="pf-kpi-grid">
          <PfCard i={1} className="pf-kpi-tile"><PfKpi label="아직 연락 안 한 문의" value={counts.new} unit="건" live={counts.new > 0} accent={counts.new > 0} /></PfCard>
          <PfCard i={2} className="pf-kpi-tile"><PfKpi label="연락함" value={counts.contacted} unit="건" /></PfCard>
          <PfCard i={3} className="pf-kpi-tile"><PfKpi label="종료" value={counts.closed} unit="건" /></PfCard>
          <PfCard i={4} className="pf-kpi-tile"><PfKpi label="최근 7일 접수" value={thisWeek} unit="건" /></PfCard>
        </div>
        <PfCard i={5}>
          <PfCardHead title="상태별 구성" sub={filter ? `'${STATUS[filter]?.label || filter}' 만 불러온 상태` : "불러온 문의 전체"} />
          <PfCardBody>
            <PfDonut
              size={150}
              centerLabel="문의"
              slices={(["new", "contacted", "closed"] as const).map((s) => ({ label: STATUS[s].label, value: counts[s], color: STATUS[s].color }))}
            />
          </PfCardBody>
        </PfCard>
      </div>

      <PfCard i={6} hover={false}>
        <PfCardHead
          title="문의 목록"
          sub={`${shown.length}건 표시 · 최근 접수 순`}
          right={
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {[null, "new", "contacted", "closed"].map((s) => (
                <button key={s ?? "all"} onClick={() => setFilter(s)} className={`pf-chip ${filter === s ? "pf-chip-on" : ""}`}>
                  {s === null ? "전체" : STATUS[s].label}
                </button>
              ))}
            </div>
          }
        />
        {isLoading ? (
          <div className="px-5 pb-5"><PfSkeleton h={18} rows={4} /></div>
        ) : shown.length === 0 ? (
          <PfEmpty ok={filter === "new"}>{filter === "new" ? "연락할 신규 문의가 없습니다 ✓" : "문의가 없습니다"}</PfEmpty>
        ) : (
          <ol className="relative px-5 pb-5">
            {shown.map((it, idx) => {
              const st = STATUS[it.status] || STATUS.new;
              return (
                <li key={it.id} className="relative pl-6 py-4 border-b border-[var(--border)]/60 last:border-b-0">
                  {/* 타임라인 선·점 */}
                  {idx < shown.length - 1 && <span className="absolute left-[7px] top-8 bottom-0 w-px bg-[var(--border)]" aria-hidden />}
                  <span className="absolute left-0 top-[22px] w-[15px] h-[15px] rounded-full border-2 border-[var(--bg-card)]" style={{ background: st.color }} aria-hidden />
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <PfBadge tone={st.tone}>{st.label}</PfBadge>
                        <span className="font-bold text-[14px] text-[var(--text)]">{it.company_name}</span>
                        <span className="text-[11px] text-[var(--text-dim)] mono-number">{kstDateStr(new Date(it.created_at))}</span>
                      </div>
                      {/*   문의 본문은 드래그 선택·복사 허용 (전역 copy-protection 예외, 2026-09-01 사장님) */}
                      <div className="text-[13px] text-[var(--text-muted)] mt-1 leading-relaxed whitespace-pre-wrap select-text cursor-text">{it.message}</div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-2">
                        {it.contact_name} ·{" "}
                        <a href={`mailto:${it.email}`} className="underline hover:text-[var(--text)]">{it.email}</a>
                        {it.phone ? ` · ${it.phone}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <button
                        onClick={() => {
                          const text = [
                            `회사: ${it.company_name || "-"}`,
                            `담당: ${it.contact_name || "-"}`,
                            `이메일: ${it.email || "-"}`,
                            it.phone ? `연락처: ${it.phone}` : null,
                            `접수일: ${kstDateStr(new Date(it.created_at))}`,
                            "",
                            it.message || "",
                          ].filter((l) => l != null).join("\n");
                          copyText(text);
                          setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="pf-btn pf-btn-sm pf-btn-ghost"
                        title="문의 내용 전체를 복사합니다"
                      >
                        {copiedId === it.id ? "복사됨 ✓" : "복사"}
                      </button>
                      {["new", "contacted", "closed"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus.mutate({ id: it.id, status: s })}
                          className={`pf-chip ${it.status === s ? "pf-chip-on" : ""}`}
                        >
                          {STATUS[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </PfCard>
    </PfPage>
  );
}

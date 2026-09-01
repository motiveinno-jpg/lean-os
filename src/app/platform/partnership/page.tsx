"use client";

// 플랫폼 운영자 — 랜딩 제휴·도입 문의함 (2026-07-27 신설).
//   partnership_inquiries 는 RLS 정책 0개(PII 차단) → operator_* SECURITY DEFINER RPC 로만 조회/수정.
//   접수는 /api/partnership (service_role) 경유.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch, OpsCompanySelect, OpsExportButton, exportCsv } from "../_components/ops-kit";
import { kstDateStr } from "@/lib/kst";

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

const STATUS: Record<string, { bg: string; text: string; label: string }> = {
  new: { bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]", label: "신규" },
  contacted: { bg: "bg-[var(--info-dim)]", text: "text-[var(--info)]", label: "연락함" },
  closed: { bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]", label: "종료" },
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

  return (
    <div className="max-w-5xl space-y-6">
      <div className="platform-partnership-header">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">도입·제휴 문의</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            랜딩페이지 문의 폼 접수분 — {items.length}건
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
        <div className="platform-partnership-filters">
          {[null, "new", "contacted", "closed"].map((s) => (
            <button
              key={s ?? "all"}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === s
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {s === null ? "전체" : STATUS[s].label}
            </button>
          ))}
        </div>
      </div>

      <div className="platform-partnership-list glass-card">
        {isLoading ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">불러오는 중…</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">문의가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {shown.map((it) => {
              const st = STATUS[it.status] || STATUS.new;
              return (
                <div key={it.id} className="platform-partnership-row">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                        <span className="font-semibold text-[var(--text)]">{it.company_name}</span>
                      </div>
                      {/*   문의 본문은 드래그 선택·복사 허용 (전역 copy-protection 예외, 2026-09-01 사장님) */}
                      <div className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed whitespace-pre-wrap select-text cursor-text">{it.message}</div>
                      <div className="text-xs text-[var(--text-dim)] mt-2">
                        {it.contact_name} ·{" "}
                        <a href={`mailto:${it.email}`} className="underline hover:text-[var(--text)]">{it.email}</a>
                        {it.phone ? ` · ${it.phone}` : ""} · {kstDateStr(new Date(it.created_at))}
                      </div>
                    </div>
                    <div className="platform-partnership-actions">
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
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text)] transition"
                        title="문의 내용 전체를 복사합니다"
                      >
                        {copiedId === it.id ? "복사됨 ✓" : "복사"}
                      </button>
                      {["new", "contacted", "closed"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus.mutate({ id: it.id, status: s })}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                            it.status === s
                              ? `${STATUS[s].bg} ${STATUS[s].text}`
                              : "bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text)]"
                          }`}
                        >
                          {STATUS[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

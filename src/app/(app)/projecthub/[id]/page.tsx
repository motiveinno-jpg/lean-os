"use client";

// 프로젝트 상세 (라이프사이클 탭) — 기존 deal 데이터 재사용. 2026-06-17 핸드오프 v2.
//   탭: 개요 / 견적서 / 계약 / 진행현황 / 손익. 모두 기존 테이블 읽기(연결·표시), 원본 무수정.
//   손익(원가율) 은 journal_entries.deal_id + v_deal_pnl 추가 후 별도 단계에서 채움.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";

const db = supabase as any;
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

type TabKey = "overview" | "quote" | "contract" | "progress" | "pnl";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "quote", label: "견적서" },
  { key: "contract", label: "계약" },
  { key: "progress", label: "진행현황" },
  { key: "pnl", label: "손익" },
];

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const role = user?.role;
  const params = useParams();
  const dealId = String(params?.id || "");
  const [tab, setTab] = useState<TabKey>("overview");

  const { data: deal, isLoading } = useQuery({
    queryKey: ["projecthub-deal", dealId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("*").eq("id", dealId).maybeSingle();
      return data as any;
    },
    enabled: !!companyId && !!dealId,
  });
  const { data: partner } = useQuery({
    queryKey: ["projecthub-deal-partner", deal?.partner_id],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name, business_number, representative, contact_name, contact_email").eq("id", deal.partner_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.partner_id,
  });
  const { data: manager } = useQuery({
    queryKey: ["projecthub-deal-manager", deal?.internal_manager_id],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name").eq("id", deal.internal_manager_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.internal_manager_id,
  });

  // 견적/계약 — documents(deal_id) + quote_tracking + quote_approvals + signature_requests
  const { data: documents = [] } = useQuery({
    queryKey: ["projecthub-docs", dealId],
    queryFn: async () => {
      const { data } = await db.from("documents").select("id, name, status, content_type, contract_amount, document_number, created_at").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId && (tab === "quote" || tab === "contract"),
  });
  const docIds = useMemo(() => documents.map((d) => d.id), [documents]);
  const { data: quoteTracking = [] } = useQuery({
    queryKey: ["projecthub-quotes", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("quote_tracking").select("*").in("document_id", docIds);
      return (data || []) as any[];
    },
    enabled: tab === "quote" && docIds.length > 0,
  });
  const { data: approvals = [] } = useQuery({
    queryKey: ["projecthub-approvals", dealId],
    queryFn: async () => {
      const { data } = await db.from("quote_approvals").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: (tab === "quote" || tab === "contract") && !!dealId,
  });
  const { data: sigRequests = [] } = useQuery({
    queryKey: ["projecthub-sigs", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("signature_requests").select("id, title, status, signer_name, signer_email, signed_at, our_signed_at, signed_contract_url, document_id").in("document_id", docIds).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: tab === "contract" && docIds.length > 0,
  });

  // 진행현황 — deal_milestones + deal_nodes
  const { data: milestones = [] } = useQuery({
    queryKey: ["projecthub-ms", dealId],
    queryFn: async () => {
      const { data } = await db.from("deal_milestones").select("*").eq("deal_id", dealId).order("due_date", { ascending: true });
      return (data || []) as any[];
    },
    enabled: tab === "progress" && !!dealId,
  });
  const { data: nodes = [] } = useQuery({
    queryKey: ["projecthub-nodes", dealId],
    queryFn: async () => {
      const { data } = await db.from("deal_nodes").select("*").eq("deal_id", dealId).order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: tab === "progress" && !!dealId,
  });

  if (role && role !== "owner" && role !== "admin") return <AccessDenied />;
  if (isLoading) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>;
  if (!deal) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">프로젝트를 찾을 수 없습니다. <Link href="/projecthub" className="text-[var(--primary)] hover:underline">목록으로</Link></div>;

  const stage = (STAGE_ORDER.includes(deal.stage) ? deal.stage : "estimate") as ProjectStage;
  const sc = STAGE_COLOR[stage];
  const contract = Number(deal.contract_total || 0);

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/projecthub" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← 프로젝트</Link>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--text)] mt-1 truncate">{deal.name || "(이름 없음)"}</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">{partner?.name || "거래처 미지정"}{manager?.name ? ` · 담당 ${manager.name}` : ""}</p>
        </div>
        <Link href={`/projects/${dealId}`} className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0">
          워크플로우에서 열기 →
        </Link>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition whitespace-nowrap ${tab === t.key ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 개요 */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric label="계약금액(매출)" value={won(contract)} />
            <Metric label="직접원가" value="—" hint="손익 단계" />
            <Metric label="배분 판관비" value="—" hint="손익 단계" />
            <Metric label="총원가" value="—" hint="손익 단계" />
            <Metric label="마진" value="—" hint="손익 단계" />
            <Metric label="원가율" value="—" hint="손익 단계" />
          </div>
          <div className="glass-card p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Info label="거래처" value={partner?.name || "—"} />
            <Info label="담당자" value={manager?.name || "—"} />
            <Info label="분류" value={deal.classification || "—"} />
            <Info label="단계" value={STAGE_LABEL[stage]} />
            <Info label="시작일" value={fmtDate(deal.start_date)} />
            <Info label="종료일" value={fmtDate(deal.end_date)} />
            <Info label="상태" value={deal.status || "—"} />
            <Info label="다음 액션" value={deal.next_action_text || "—"} />
          </div>
        </div>
      )}

      {/* 견적서 */}
      {tab === "quote" && (
        <div className="space-y-3">
          {documents.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 문서(견적서)가 없습니다." />
          ) : (
            <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
              {documents.map((doc) => {
                const qt = quoteTracking.find((q) => q.document_id === doc.id);
                return (
                  <div key={doc.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--text)] truncate">{doc.name || qt?.quote_title || "문서"}</div>
                      <div className="text-[11px] text-[var(--text-dim)]">{doc.content_type || "문서"} · {fmtDate(doc.created_at)}{doc.document_number ? ` · ${doc.document_number}` : ""}</div>
                    </div>
                    {qt && (
                      <div className="text-[11px] text-[var(--text-muted)] shrink-0">
                        열람 {qt.view_count ?? 0}회{qt.viewed_at ? ` · 최근 ${fmtDate(qt.viewed_at)}` : ""}
                      </div>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{qt?.status || doc.status || "—"}</span>
                    {doc.contract_amount != null && <span className="text-xs mono-number text-[var(--text)] shrink-0">{won(doc.contract_amount)}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").length > 0 && (
            <div className="glass-card p-4">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">견적 승인 흐름</div>
              {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").map((a) => (
                <ApprovalRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 계약 */}
      {tab === "contract" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">전자계약(전자서명) 상태입니다. 발송·관리는 전자계약 메뉴에서 합니다.</p>
            <Link href="/signatures" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">전자계약 메뉴 →</Link>
          </div>
          {sigRequests.length === 0 && approvals.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 전자계약·승인 내역이 없습니다." />
          ) : (
            <>
              {sigRequests.length > 0 && (
                <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
                  {sigRequests.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--text)] truncate">{s.title || "계약서"}</div>
                        <div className="text-[11px] text-[var(--text-dim)]">{s.signer_name || "—"}{s.signer_email ? ` · ${s.signer_email}` : ""}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{s.status}</span>
                      {s.signed_at && <span className="text-[11px] text-green-500 shrink-0">서명완료 {fmtDate(s.signed_at)}</span>}
                      {s.signed_contract_url && <a href={s.signed_contract_url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--primary)] hover:underline shrink-0">계약서</a>}
                    </div>
                  ))}
                </div>
              )}
              {approvals.length > 0 && (
                <div className="glass-card p-4">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2">단계별 승인</div>
                  {approvals.map((a) => <ApprovalRow key={a.id} a={a} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 진행현황 */}
      {tab === "progress" && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">마일스톤</div>
            {milestones.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)]">등록된 마일스톤이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {milestones.map((m) => {
                  const done = m.status === "completed" || !!m.completed_at;
                  return (
                    <div key={m.id} className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${done ? "bg-green-500" : "bg-[var(--border)]"}`} />
                      <span className={`text-sm flex-1 ${done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"}`}>{m.name || "마일스톤"}</span>
                      <span className="text-[11px] text-[var(--text-muted)] mono-number">{fmtDate(m.due_date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="glass-card p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">작업 항목 (매출·원가)</div>
            {nodes.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)]">등록된 작업 항목이 없습니다.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="px-2 py-1.5 text-left font-semibold">항목</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-[70px]">상태</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-[110px]">매출</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-[110px]">예정원가</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-[110px]">실제원가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <tr key={n.id} className="border-b border-[var(--border)]/30">
                        <td className="px-2 py-1.5 text-[var(--text)]">{n.name || n.title || "항목"}</td>
                        <td className="px-2 py-1.5 text-center text-[var(--text-muted)]">{n.status || "—"}</td>
                        <td className="px-2 py-1.5 text-right mono-number text-[var(--text)]">{n.revenue_amount != null ? won(n.revenue_amount) : "—"}</td>
                        <td className="px-2 py-1.5 text-right mono-number text-[var(--text-muted)]">{n.expected_cost != null ? won(n.expected_cost) : "—"}</td>
                        <td className="px-2 py-1.5 text-right mono-number text-[var(--text-muted)]">{n.actual_cost != null ? won(n.actual_cost) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 손익 */}
      {tab === "pnl" && (
        <div className="glass-card p-10 text-center">
          <div className="text-sm text-[var(--text)]">손익(원가율) 분석은 준비 중입니다</div>
          <p className="text-xs text-[var(--text-dim)] mt-2 max-w-md mx-auto">
            전표에 프로젝트를 태그(journal_entries.deal_id)해 직접원가를 자동 집계하고, 회사 판관비를 매출 비례로 배분해 원가율·마진을 산출할 예정입니다.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>매출(계약금액)</span><span className="font-bold mono-number text-[var(--text)]">{won(contract)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-base font-bold mono-number mt-0.5 ${value === "—" ? "text-[var(--text-dim)]" : "text-[var(--text)]"}`} title={hint}>{value}</div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[var(--text-muted)] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[var(--text)] min-w-0 break-words">{value}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">{text}</div>;
}
function ApprovalRow({ a }: { a: any }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[var(--border)]/30 last:border-0">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{a.stage || "—"}</span>
      <span className="text-[var(--text)] flex-1 truncate">{a.recipient || a.recipient_name || "—"}</span>
      <span className="text-[var(--text-muted)] shrink-0">{a.status || "—"}</span>
      {(a.fully_signed_contract_url || a.signed_contract_url) && (
        <a href={a.fully_signed_contract_url || a.signed_contract_url} target="_blank" rel="noreferrer" className="text-[var(--primary)] hover:underline shrink-0">계약서</a>
      )}
    </div>
  );
}

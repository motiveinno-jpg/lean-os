"use client";

// 플랫폼 운영자 — 광고 메일 수신거부 목록 (2026-09-16 신설).
//   왜 필요한가: 소개 메일을 사람이 수동으로 보내는 동안, 보내기 전에 「이 주소는 빼야 한다」를
//     확인할 곳이 있어야 한다. 거부한 사람에게 또 나가면 그게 정보통신망법 위반이다.
//   email_optouts 는 RLS 정책 0개(PII 차단) → operator_* SECURITY DEFINER RPC 로만 조회/수정.
//   접수는 /api/unsubscribe (service_role) 경유. 메일 회신으로 온 거부는 여기서 손으로 등록한다.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch, OpsExportButton, exportCsv } from "../_components/ops-kit";
import { kstDateStr } from "@/lib/kst";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfState } from "@/app/platform/_components/pf/ui";
import { appConfirm } from "@/components/global-confirm";

const db = supabase;

type Optout = {
  id: string;
  email: string;
  source: string;
  note: string | null;
  created_at: string;
};

// 어디로 들어온 거부인지. 회신·직접등록은 사람이 옮긴 것이라 오등록 가능성이 있어 구분해 둔다.
const SOURCE: Record<string, { tone: "ok" | "info" | "warn" | "muted"; label: string }> = {
  self: { tone: "ok", label: "본인 신청" },
  reply: { tone: "info", label: "메일 회신" },
  manual: { tone: "info", label: "직접 등록" },
  bounce: { tone: "warn", label: "반송" },
  complaint: { tone: "warn", label: "스팸 신고" },
};

function KpiPending({ label }: { label: string }) {
  return (
    <div>
      <span className="pf-kpi-label">{label}</span>
      <div className="pf-kpi-value mono-number mt-1 text-[var(--text-dim)]">—</div>
    </div>
  );
}

export default function PlatformEmailOptoutsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addNote, setAddNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // 목록은 1,000행씩 끝까지 넘겨 받는다 — 발송 전 대조용이라 잘리면 거부한 주소로 다시 나간다.
  const { data: items = [], isLoading, error: listError, refetch } = useQuery<Optout[]>({
    queryKey: ["op-email-optouts"],
    queryFn: async () => {
      const PAGE = 1000;
      const out: Optout[] = [];
      for (let offset = 0; offset < 200_000; offset += PAGE) {
        const { data, error } = await (db.rpc as any)("operator_list_email_optouts", { p_limit: PAGE, p_offset: offset });
        if (error) {
          // 페이지 인자(p_offset)를 받는 함수가 아직 없는 DB — 예전 방식(최대 2,000건 한 번)으로 받는다
          if (offset === 0 && error.code === "PGRST202") {
            const old = await db.rpc("operator_list_email_optouts", { p_limit: 2000 });
            if (old.error) throw old.error;
            return (old.data || []) as Optout[];
          }
          throw error;
        }
        const rows = (data || []) as Optout[];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
    refetchInterval: 60_000,
  });

  // 건수는 목록과 따로 센다(목록 길이로 세면 목록이 잘릴 때 숫자도 같이 틀린다)
  const { data: counts } = useQuery<{ total: number; by_self: number; last_7d: number } | null>({
    queryKey: ["op-email-optout-counts"],
    queryFn: async () => {
      const { data, error } = await (db.rpc as any)("operator_email_optout_counts");
      if (error) throw error;
      const r = (data || [])[0];
      return r ? { total: Number(r.total), by_self: Number(r.by_self), last_7d: Number(r.last_7d) } : null;
    },
    refetchInterval: 60_000,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      it.email.toLowerCase().includes(q) || (it.note || "").toLowerCase().includes(q));
  }, [items, search]);

  const thisWeek = useMemo(() => {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    return items.filter((it) => new Date(it.created_at).getTime() >= since).length;
  }, [items]);
  const bySelf = useMemo(() => items.filter((it) => it.source === "self").length, [items]);
  const kpiReady = !isLoading && !listError;

  const add = useMutation({
    mutationFn: async () => {
      const email = addEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("올바른 이메일 주소를 입력해주세요.");
      const { error } = await db.rpc("operator_add_email_optout", {
        p_email: email,
        p_note: addNote.trim() || undefined,
        p_source: "reply",
      });
      if (error) throw error;
      return email;
    },
    onSuccess: (email) => {
      setAddEmail(""); setAddNote("");
      setMsg(`${email} 등록했습니다. 앞으로 이 주소로는 보내지 마세요.`);
      qc.invalidateQueries({ queryKey: ["op-email-optouts"] });
      qc.invalidateQueries({ queryKey: ["op-email-optout-counts"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "등록에 실패했습니다."),
  });

  //   되돌리기 — 잘못 등록했을 때 뺄 수단이 없으면 운영자가 실수를 고칠 방법이 없다.
  const remove = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await db.rpc("operator_remove_email_optout", { p_email: email });
      if (error) throw error;
      return email;
    },
    onSuccess: (email) => {
      setMsg(`${email} 를 목록에서 뺐습니다.`);
      qc.invalidateQueries({ queryKey: ["op-email-optouts"] });
      qc.invalidateQueries({ queryKey: ["op-email-optout-counts"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "삭제에 실패했습니다."),
  });

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="메일 수신거부"
        desc="광고·소개 메일을 보내기 전에 이 목록을 먼저 거르세요. 거부한 주소로 다시 보내면 정보통신망법 위반입니다. 메일 회신으로 받은 거부는 아래에서 직접 등록하시면 됩니다."
        actions={
          <>
            <OpsSearch value={search} onChange={setSearch} placeholder="이메일·메모 검색" />
            <OpsExportButton
              disabled={shown.length === 0}
              onClick={() => exportCsv(shown.map((it) => ({
                이메일: it.email,
                경로: SOURCE[it.source]?.label || it.source,
                메모: it.note || "",
                접수일: String(it.created_at).slice(0, 10),
              })), "메일수신거부")}
            />
          </>
        }
      />

      <div className="pf-kpi-grid">
        {/* 건수 함수가 있으면 그것, 없으면(적용 전) 끝까지 받은 목록으로 센다. 목록도 못 받았으면 숫자를 내지 않는다. */}
        <PfCard i={1} className="pf-kpi-tile">{counts || kpiReady ? <PfKpi label="수신거부 전체" value={counts?.total ?? items.length} unit="건" /> : <KpiPending label="수신거부 전체" />}</PfCard>
        <PfCard i={2} className="pf-kpi-tile">{counts || kpiReady ? <PfKpi label="본인이 직접 신청" value={counts?.by_self ?? bySelf} unit="건" /> : <KpiPending label="본인이 직접 신청" />}</PfCard>
        <PfCard i={3} className="pf-kpi-tile">{counts || kpiReady ? <PfKpi label="최근 7일" value={counts?.last_7d ?? thisWeek} unit="건" live={(counts?.last_7d ?? thisWeek) > 0} /> : <KpiPending label="최근 7일" />}</PfCard>
      </div>

      <PfCard i={4} hover={false}>
        <PfCardHead title="회신으로 받은 수신거부 등록" sub="메일에 '수신거부'라고 회신이 오면 여기에 넣어 두세요" />
        <PfCardBody>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex-1 min-w-[220px] grid gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--text-muted)]">이메일 주소</span>
              <input
                value={addEmail}
                onChange={(e) => { setAddEmail(e.target.value); setMsg(null); }}
                placeholder="email@company.com"
                className="pf-input"
                autoComplete="off"
              />
            </label>
            <label className="flex-1 min-w-[220px] grid gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--text-muted)]">메모 <small className="font-normal text-[var(--text-dim)]">선택</small></span>
              <input
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="예) 9/16 회신으로 요청"
                className="pf-input"
                autoComplete="off"
              />
            </label>
            <button
              onClick={() => add.mutate()}
              disabled={add.isPending || !addEmail.trim()}
              className="btn btn-primary btn-sm"
            >
              {add.isPending ? "등록 중…" : "수신거부 등록"}
            </button>
          </div>
          {msg && <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">{msg}</p>}
          <p className="mt-3 text-[12px] text-[var(--text-dim)] leading-relaxed">
            등록하면 그 주소는 다시 보내면 안 됩니다. 회신 주신 분께는 처리했다는 답장을 보내 주세요 —
            법이 14일 안에 처리 결과를 알리도록 정하고 있습니다. (홈페이지에서 직접 거부한 분은 그 화면에서 결과를 보므로 따로 알릴 필요가 없습니다.)
          </p>
        </PfCardBody>
      </PfCard>

      <PfCard i={5} hover={false}>
        <PfCardHead title="수신거부 목록" sub={`${shown.length}건 표시 · 최근 접수 순${counts && counts.total > items.length ? ` · 전체 ${counts.total.toLocaleString()}건 중 ${items.length.toLocaleString()}건만 받았습니다` : ""}`} />
        <PfState
          loading={isLoading}
          error={listError}
          onRetry={() => refetch()}
          empty={shown.length === 0}
          ok={!search}
          emptyText={search ? "검색 결과가 없습니다" : "수신거부가 없습니다 ✓"}
          skeletonH={18}
        >
          <div className="px-5 pb-5">
            {shown.map((it) => {
              const src = SOURCE[it.source] || { tone: "muted" as const, label: it.source };
              return (
                <div key={it.id} className="flex items-center justify-between gap-4 flex-wrap py-3 border-b border-[var(--border)]/60 last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PfBadge tone={src.tone}>{src.label}</PfBadge>
                      {/*   주소는 복사해서 발송 목록과 대조해야 하므로 선택 허용 (전역 copy-protection 예외) */}
                      <span className="font-semibold text-[13.5px] text-[var(--text)] select-text cursor-text break-all">{it.email}</span>
                      <span className="text-[11px] text-[var(--text-dim)] mono-number">{kstDateStr(new Date(it.created_at))}</span>
                    </div>
                    {it.note && <div className="text-[12px] text-[var(--text-muted)] mt-1">{it.note}</div>}
                  </div>
                  <button
                    onClick={async () => {
                      // 빼면 그 주소로 광고 메일이 다시 나갈 수 있다 — 잘못 등록한 건인지 한 번 더 묻는다
                      if (!(await appConfirm(`${it.email} 를 수신거부 목록에서 뺄까요?\n빼면 이 주소로 광고·소개 메일을 다시 보낼 수 있게 됩니다. 본인이 거부한 주소라면 빼지 마세요.`, { confirmLabel: "목록에서 빼기", danger: true }))) return;
                      remove.mutate(it.email);
                    }}
                    disabled={remove.isPending}
                    className="btn btn-secondary btn-sm shrink-0"
                    title="잘못 등록한 건만 빼세요"
                  >
                    목록에서 빼기
                  </button>
                </div>
              );
            })}
          </div>
        </PfState>
      </PfCard>
    </PfPage>
  );
}

"use client";

// 플랫폼 운영자 — 받은 메일 (2026-09-16 신설).
//   광고 메일(hello@owner-view.com)에 사람들이 회신하면 Resend 가 받아 웹훅으로 넘기고, 여기서 본다.
//   · 목록은 미리보기만, 열면 본문 전체(HTML 은 격리된 iframe 에서만 그린다 — 외부 메일이라 스크립트·링크를 믿지 않는다).
//   · "수신거부"라고 회신한 사람은 버튼 한 번으로 수신거부 목록에 넣는다(다음 발송에서 자동 제외).
//   · 답장은 메일 앱으로(mailto) — 오너뷰가 직접 답장을 보내는 건 다음 단계.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { appConfirm } from "@/components/global-confirm";
import { OpsSearch } from "../_components/ops-kit";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";

const db = supabase as any;

type Row = {
  id: string; from_email: string; from_name: string | null; to_emails: string[]; subject: string | null; preview: string;
  has_html: boolean; attachment_count: number; received_at: string; read_at: string | null;
  campaign_id: string | null; campaign_subject: string | null; opted_out: boolean;
};
type Full = {
  id: string; from_email: string; from_name: string | null; to_emails: string[]; subject: string | null;
  text_body: string | null; html_body: string | null; attachments: { filename?: string; content_type?: string }[];
  received_at: string; read_at: string | null; message_id: string | null;
};

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function PlatformEmailInboxPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["op-email-inbox", unreadOnly],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_list_email_inbox", { p_limit: 300, p_unread_only: unreadOnly });
      if (error) throw error;
      return (data || []) as Row[];
    },
    refetchInterval: 30_000,
  });

  const { data: full, isLoading: opening } = useQuery<Full | null>({
    queryKey: ["op-email-inbox-open", openId],
    enabled: !!openId,
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_open_email_inbox", { p_id: openId });
      if (error) throw error;
      //   열면 읽음 처리되므로 목록도 갱신
      qc.invalidateQueries({ queryKey: ["op-email-inbox"] });
      return ((data || [])[0] as Full) || null;
    },
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.from_email, r.from_name || "", r.subject || "", r.preview].some((v) => v.toLowerCase().includes(q)));
  }, [rows, search]);
  const unread = rows.filter((r) => !r.read_at).length;
  const today = rows.filter((r) => new Date(r.received_at).toDateString() === new Date().toDateString()).length;

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "unread" | "delete" }) => {
      const { error } = await db.rpc("operator_set_email_inbox", { p_id: id, p_action: action });
      if (error) throw error;
    },
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ["op-email-inbox"] }); if (v.action === "delete") setOpenId(null); setMsg(null); },
    onError: (e) => setMsg(e instanceof Error ? e.message : "처리에 실패했습니다."),
  });
  const optout = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await db.rpc("operator_add_email_optout", { p_email: email, p_note: "회신으로 수신거부 요청", p_source: "reply" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["op-email-inbox"] }); qc.invalidateQueries({ queryKey: ["op-email-optouts"] }); setMsg("수신거부 목록에 넣었습니다. 다음 발송부터 자동으로 빠집니다."); },
    onError: (e) => setMsg(e instanceof Error ? e.message : "등록에 실패했습니다."),
  });

  const current = openId ? rows.find((r) => r.id === openId) : null;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="받은 메일"
        desc="hello@owner-view.com 으로 온 메일입니다. 광고 메일에 대한 회신이 여기 쌓입니다. '수신거부'라고 답한 분은 버튼 한 번으로 목록에 넣으세요."
        actions={
          <>
            <OpsSearch value={search} onChange={setSearch} placeholder="보낸 사람·제목·본문 검색" />
            <button type="button" className={unreadOnly ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? "안 읽은 것만 보는 중" : "안 읽은 것만"}
            </button>
          </>
        }
      />

      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="안 읽음" value={unread} unit="통" live={unread > 0} /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="오늘 받음" value={today} unit="통" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="전체" value={rows.length} unit="통" /></PfCard>
      </div>

      {msg && <p className="text-sm text-[var(--text-muted)]">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PfCard i={4} hover={false}>
          <PfCardHead title="목록" sub={`${shown.length}통 · 최근 받은 순`} />
          <PfCardBody>
            {isLoading ? <PfSkeleton rows={4} /> : shown.length === 0 ? <PfEmpty>{unreadOnly ? "안 읽은 메일이 없습니다." : "아직 받은 메일이 없습니다."}</PfEmpty> : (
              <ul className="divide-y divide-[var(--border)]">
                {shown.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpenId(r.id)}
                      className={`w-full text-left px-2 py-2.5 rounded-lg transition hover:bg-[var(--bg-surface)] ${openId === r.id ? "bg-[var(--bg-surface)]" : ""}`}>
                      <div className="flex items-baseline gap-2">
                        <span className={`truncate text-sm ${r.read_at ? "text-[var(--text-muted)]" : "font-semibold text-[var(--text)]"}`}>{r.from_name || r.from_email}</span>
                        {r.opted_out && <PfBadge tone="warn">수신거부됨</PfBadge>}
                        {r.campaign_id && <PfBadge tone="info">회신</PfBadge>}
                        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-dim)] mono-number">{when(r.received_at)}</span>
                      </div>
                      <div className={`truncate text-sm ${r.read_at ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}>{r.subject || "(제목 없음)"}</div>
                      <div className="truncate text-xs text-[var(--text-dim)]">{r.preview || (r.has_html ? "(HTML 메일)" : "")}{r.attachment_count > 0 ? ` · 첨부 ${r.attachment_count}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PfCardBody>
        </PfCard>

        <PfCard i={5} hover={false}>
          {!openId ? (
            <PfCardBody><PfEmpty>왼쪽에서 메일을 고르면 여기에 내용이 보입니다.</PfEmpty></PfCardBody>
          ) : opening || !full ? (
            <PfCardBody><PfSkeleton rows={6} /></PfCardBody>
          ) : (
            <>
              <PfCardHead title={full.subject || "(제목 없음)"} sub={`${full.from_name ? `${full.from_name} <${full.from_email}>` : full.from_email} → ${(full.to_emails || []).join(", ")} · ${when(full.received_at)}`} />
              <PfCardBody>
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <a className="btn-secondary btn-sm" href={`mailto:${encodeURIComponent(full.from_email)}?subject=${encodeURIComponent(`Re: ${full.subject || ""}`)}`}>메일 앱으로 답장</a>
                  <button type="button" className="btn-secondary btn-sm" disabled={!!current?.opted_out || optout.isPending}
                    title="이 사람이 수신거부를 요청했다면 누르세요. 다음 발송부터 자동으로 빠집니다."
                    onClick={async () => { if (await appConfirm(`${full.from_email} 을(를) 수신거부 목록에 넣을까요?`, { confirmLabel: "넣기" })) optout.mutate(full.from_email); }}>
                    {current?.opted_out ? "이미 수신거부됨" : "수신거부 등록"}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => act.mutate({ id: full.id, action: "unread" })}>안 읽음으로</button>
                  <span className="ml-auto" />
                  <button type="button" className="btn-secondary btn-sm text-[var(--danger)]"
                    onClick={async () => { if (await appConfirm("이 메일을 지울까요? 되돌릴 수 없습니다.", { danger: true, confirmLabel: "지우기" })) act.mutate({ id: full.id, action: "delete" }); }}>지우기</button>
                </div>
                {full.attachments?.length > 0 && (
                  <p className="text-xs text-[var(--text-muted)] mb-2">첨부 {full.attachments.length}개: {full.attachments.map((a) => a.filename || "(이름 없음)").join(", ")} <span className="text-[var(--text-dim)]">· 파일은 Resend 콘솔에서 받습니다</span></p>
                )}
                {full.text_body ? (
                  <pre className="whitespace-pre-wrap font-[inherit] text-sm leading-relaxed text-[var(--text)] max-h-[60vh] overflow-auto">{full.text_body}</pre>
                ) : full.html_body ? (
                  /*   외부 HTML — sandbox(스크립트·폼·같은 출처 차단) 안에서만 그린다 */
                  <iframe title="메일 본문" sandbox="" srcDoc={full.html_body} className="w-full min-h-[60vh] rounded-lg border border-[var(--border)] bg-white" />
                ) : <PfEmpty>본문이 비어 있습니다.</PfEmpty>}
              </PfCardBody>
            </>
          )}
        </PfCard>
      </div>
    </PfPage>
  );
}

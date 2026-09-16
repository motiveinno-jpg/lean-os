"use client";

// 플랫폼 운영자 — 광고·소개 메일 보내기 (2026-09-16 신설).
//   주소 목록을 붙여 넣으면 엣지 함수 email-campaign-send 가 news.mo-tive.com 으로 보낸다.
//   · 수신거부(email_optouts)는 보내기 직전에 자동으로 뺀다 — "미리 계산"으로 몇 명이 빠지는지 먼저 본다.
//   · 제목 앞 (광고)·발신자·수신거부 안내는 함수가 붙인다. 여기서는 제목·본문·주소만.
//   · 반송·스팸신고는 웹훅이 수신거부 목록에 넣어 다음 발송부터 빠진다. 아래 이력 표에서 건수를 본다.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { appConfirm } from "@/components/global-confirm";
import { kstDateStr } from "@/lib/kst";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";

const db = supabase;

type Campaign = {
  id: string; subject: string; from_email: string; status: string;
  total: number; sent_count: number; skipped_optout: number; failed_count: number;
  delivered: number; bounced: number; complained: number;
  created_at: string; sent_at: string | null;
};
type Preview = { total: number; skipped_optout: number; will_send: number; invalid: string[] };

const STATUS: Record<string, { tone: "ok" | "info" | "warn" | "muted"; label: string }> = {
  sent: { tone: "ok", label: "발송 완료" },
  sending: { tone: "info", label: "보내는 중" },
  failed: { tone: "warn", label: "실패" },
  draft: { tone: "muted", label: "초안" },
};

/** 붙여 넣은 글에서 이메일만 뽑는다 — 줄바꿈·쉼표·CSV·이름 섞인 목록 전부 */
function extractEmails(text: string): string[] {
  const found = text.match(/[^\s,;<>"'()\[\]]+@[^\s,;<>"'()\[\]]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(found.map((e) => e.trim().toLowerCase()))];
}

export default function PlatformEmailCampaignsPage() {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [listText, setListText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const emails = useMemo(() => extractEmails(listText), [listText]);

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["op-email-campaigns"],
    queryFn: async () => {
      //   생성 타입에 아직 없는 RPC(마이그 20260916190000) — 재생성 전까지 넓게 부른다
      const { data, error } = await (db.rpc as any)("operator_list_email_campaigns", { p_limit: 100 });
      if (error) throw error;
      return (data || []) as Campaign[];
    },
    refetchInterval: 30_000,
  });

  const call = async (dryRun: boolean) => {
    const { data, error } = await db.functions.invoke("email-campaign-send", {
      body: { subject, body_text: bodyText, recipients: emails, dry_run: dryRun },
    });
    if (error) {
      //   함수가 돌려준 오류 문구를 그대로 보여 준다(HTTP 오류는 context 에 본문이 있다)
      let text = error.message || "실패";
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) text = j.error; } catch { /* ignore */ }
      throw new Error(text);
    }
    if (data?.error) throw new Error(String(data.error));
    return data as Preview & { ok: boolean; sent?: number; failed?: number; campaign_id?: string };
  };

  const runPreview = async () => {
    setMsg(null); setBusy("preview");
    try { setPreview(await call(true)); }
    catch (e) { setMsg({ tone: "warn", text: e instanceof Error ? e.message : "미리 계산에 실패했습니다." }); }
    setBusy(null);
  };

  const runSend = async () => {
    if (!preview) return;
    const ok = await appConfirm(
      `${preview.will_send.toLocaleString()}명에게 보냅니다.\n\n· 제목: (광고) ${subject.replace(/^\(광고\)\s*/, "")}\n· 수신거부 ${preview.skipped_optout}명은 자동으로 뺐습니다\n· 보낸 뒤에는 되돌릴 수 없습니다`,
      { title: "메일 보내기", confirmLabel: "보내기" });
    if (!ok) return;
    setMsg(null); setBusy("send");
    try {
      const r = await call(false);
      setMsg({ tone: r.failed ? "warn" : "ok", text: `발송 ${r.sent ?? 0}명 완료${r.failed ? ` · 실패 ${r.failed}명 (아래 이력에서 확인)` : ""} · 수신거부 제외 ${r.skipped_optout}명` });
      setPreview(null); setListText("");
      qc.invalidateQueries({ queryKey: ["op-email-campaigns"] });
    } catch (e) { setMsg({ tone: "warn", text: e instanceof Error ? e.message : "발송에 실패했습니다." }); }
    setBusy(null);
  };

  const canPreview = !!subject.trim() && !!bodyText.trim() && emails.length > 0 && !busy;
  const totals = useMemo(() => ({
    sent: campaigns.reduce((s, c) => s + (c.sent_count || 0), 0),
    bounced: campaigns.reduce((s, c) => s + Number(c.bounced || 0), 0),
    complained: campaigns.reduce((s, c) => s + Number(c.complained || 0), 0),
  }), [campaigns]);

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="메일 보내기"
        desc="소개·광고 메일을 news.mo-tive.com 에서 보냅니다. 수신거부한 주소는 자동으로 빠지고, 제목의 (광고) 표시·발신자·수신거부 안내는 자동으로 붙습니다. 반송·스팸신고 주소는 다음 발송부터 자동 제외됩니다."
      />

      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="지금까지 발송" value={totals.sent} unit="통" /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="반송" value={totals.bounced} unit="통" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="스팸 신고" value={totals.complained} unit="통" live={totals.complained > 0} /></PfCard>
      </div>

      <PfCard i={4} hover={false}>
        <PfCardHead title="새 메일" sub="제목·본문·받는 주소를 넣고 '미리 계산'으로 몇 명에게 나가는지 먼저 확인하세요" />
        <PfCardBody>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">제목 <span className="text-[var(--text-dim)]">· 앞에 (광고)가 자동으로 붙습니다</span></span>
              <input className="pf-input" value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} placeholder="사장님 대신 회사 상황을 매일 정리해 드립니다" maxLength={200} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">본문 <span className="text-[var(--text-dim)]">· 줄바꿈 그대로 나갑니다. 발신자·수신거부 안내는 끝에 자동으로 붙습니다</span></span>
              <textarea className="pf-input min-h-[220px] font-[inherit]" value={bodyText} onChange={(e) => { setBodyText(e.target.value); setPreview(null); }} placeholder="안녕하세요, 오너뷰입니다. …" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">받는 주소 <span className="text-[var(--text-dim)]">· 줄바꿈·쉼표·엑셀 복사 그대로 붙여 넣으면 이메일만 골라냅니다 (한 번에 2,000명까지)</span></span>
              <textarea className="pf-input min-h-[120px] font-mono text-[12px]" value={listText} onChange={(e) => { setListText(e.target.value); setPreview(null); }} placeholder={"ceo@company.com\n대표님, hong@example.com, 02-1234-5678"} />
              <span className="text-[11px] text-[var(--text-dim)]">주소 {emails.length.toLocaleString()}개 인식</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" className="btn-secondary btn-sm" disabled={!canPreview} onClick={runPreview}>
                {busy === "preview" ? "계산 중…" : "미리 계산"}
              </button>
              {preview && (
                <span className="text-sm text-[var(--text-muted)]">
                  총 <b className="mono-number">{preview.total.toLocaleString()}</b>명 · 수신거부 제외 <b className="mono-number">{preview.skipped_optout.toLocaleString()}</b>명 → 발송 예정 <b className="mono-number text-[var(--text)]">{preview.will_send.toLocaleString()}</b>명
                  {preview.invalid.length > 0 && <> · 형식 오류 {preview.invalid.length}개 제외</>}
                </span>
              )}
              <span className="ml-auto" />
              <button type="button" className="btn-primary btn-sm" disabled={!preview || preview.will_send === 0 || !!busy} onClick={runSend}
                title={!preview ? "먼저 '미리 계산'을 누르세요" : undefined}>
                {busy === "send" ? "보내는 중…" : preview ? `${preview.will_send.toLocaleString()}명에게 보내기` : "보내기"}
              </button>
            </div>
            {msg && <p className={`text-sm ${msg.tone === "ok" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p>}
          </div>
        </PfCardBody>
      </PfCard>

      <PfCard i={5} hover={false}>
        <PfCardHead title="발송 이력" sub={`${campaigns.length}건 · 도착·반송·스팸신고는 Resend 알림이 오는 대로 채워집니다`} />
        <PfCardBody>
          {isLoading ? <PfSkeleton rows={3} /> : campaigns.length === 0 ? <PfEmpty>아직 보낸 메일이 없습니다.</PfEmpty> : (
            <div className="overflow-x-auto">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>보낸 시각</th><th>제목</th><th>상태</th>
                    <th className="text-right">대상</th><th className="text-right">발송</th><th className="text-right">제외</th><th className="text-right">실패</th>
                    <th className="text-right">도착</th><th className="text-right">반송</th><th className="text-right">스팸 신고</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const st = STATUS[c.status] || STATUS.draft;
                    return (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap text-[var(--text-muted)]">{kstDateStr(new Date(c.sent_at || c.created_at))}</td>
                        <td className="max-w-[320px] truncate" title={c.subject}>{c.subject}</td>
                        <td><PfBadge tone={st.tone}>{st.label}</PfBadge></td>
                        <td className="text-right mono-number">{c.total.toLocaleString()}</td>
                        <td className="text-right mono-number">{c.sent_count.toLocaleString()}</td>
                        <td className="text-right mono-number">{c.skipped_optout.toLocaleString()}</td>
                        <td className="text-right mono-number">{c.failed_count.toLocaleString()}</td>
                        <td className="text-right mono-number">{Number(c.delivered).toLocaleString()}</td>
                        <td className="text-right mono-number">{Number(c.bounced).toLocaleString()}</td>
                        <td className="text-right mono-number">{Number(c.complained).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PfCardBody>
      </PfCard>
    </PfPage>
  );
}

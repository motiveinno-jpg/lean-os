"use client";

// 플랫폼 운영자 — 광고·소개 메일 보내기 (2026-09-16 신설).
//   주소 목록을 붙여 넣으면 엣지 함수 email-campaign-send 가 hello@owner-view.com 으로 보낸다.
//   · 수신거부(email_optouts)는 보내기 직전에 자동으로 뺀다 — "미리 계산"으로 몇 명이 빠지는지 먼저 본다.
//   · 제목 앞 (광고)·발신자·수신거부 안내는 함수가 붙인다. 여기서는 제목·본문·주소만.
//   · 반송·스팸신고는 웹훅이 수신거부 목록에 넣어 다음 발송부터 빠진다. 아래 이력 표에서 건수를 본다.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { appConfirm } from "@/components/global-confirm";
import { kstDateStr, kstDateTime } from "@/lib/kst";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";

const db = supabase;

type Campaign = {
  id: string; subject: string; from_email: string; status: string;
  total: number; sent_count: number; skipped_optout: number; skipped_duplicate: number; failed_count: number;
  delivered: number; bounced: number; complained: number;
  created_at: string; sent_at: string | null;
};
type Preview = { total: number; skipped_optout: number; skipped_duplicate: number; will_send: number; invalid: string[]; preview_html?: string; orphan_links?: string[] };

const STATUS: Record<string, { tone: "ok" | "info" | "warn" | "muted"; label: string }> = {
  sent: { tone: "ok", label: "발송 완료" },
  sending: { tone: "info", label: "보내는 중" },
  failed: { tone: "warn", label: "실패" },
  draft: { tone: "muted", label: "초안" },
};

/** 이력 표에서 눌러 주소를 볼 수 있는 결과 */
const DETAIL_LABEL: Record<string, string> = {
  sent: "발송", bounced: "반송", complained: "스팸 신고", skipped_duplicate: "중복 제외", skipped_optout: "수신거부 제외", failed: "실패",
};
//   '발송' 은 실제로 Resend 에 넘어간 모든 상태 — 캠페인 sent_count 와 같은 범위
const KIND_STATUSES: Record<string, string[]> = {
  sent: ["sent", "delivered", "delayed", "bounced", "complained"],
};
const STATUS_LABEL: Record<string, string> = {
  sent: "전달 중", delivered: "도착", delayed: "전달 지연", bounced: "반송", complained: "스팸 신고",
  skipped_duplicate: "중복 제외", skipped_optout: "수신거부 제외", failed: "실패", queued: "대기",
};
const PAGE = 1000;
type Recipient = {
  email: string; status: string; error: string | null; sent_at: string | null; updated_at: string | null;
  campaign_id: string; campaign_subject: string; campaign_sent_at: string; total: number;
};
type DetailScope = { campaign: Campaign | null; kind: string };

/** Resend 가 주는 영어 사유를 한 줄 우리말로 — 원문은 title 로 남긴다 */
function reasonOf(r: Recipient): string {
  const e = (r.error || "").toLowerCase();
  if (r.status === "complained") return "받는 사람이 스팸으로 신고";
  if (r.status === "skipped_duplicate") return "최근에 이미 받은 주소";
  if (r.status === "skipped_optout") return "수신거부·반송 이력";
  if (e.includes("hard bounce")) return "없는 주소이거나 영구 거부 (영구 반송)";
  if (e.includes("general bounce")) return "받는 쪽 일시 문제 (일시 반송)";
  if (e.includes("mailbox") && e.includes("full")) return "받은편지함 용량 초과";
  if (r.status === "bounced") return "반송 (사유 미상)";
  return r.error || "";
}

/** 이전 발송과 겹치는 주소를 어디까지 거슬러 올라가 뺄지 (일) */
const DEDUPE_OPTIONS = [
  { days: 30, label: "최근 30일 안에 받은 주소 제외" },
  { days: 7, label: "최근 7일 안에 받은 주소 제외" },
  { days: 90, label: "최근 90일 안에 받은 주소 제외" },
  { days: 36500, label: "한 번이라도 받은 주소 제외" },
  { days: 0, label: "제외하지 않음 (다시 보내기)" },
];

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
  const [dedupeDays, setDedupeDays] = useState(30);
  //   campaign 이 null 이면 상단 합계(모든 발송)에서 연 목록
  const [detail, setDetail] = useState<DetailScope | null>(null);
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

  const openDetail = (campaign: Campaign | null, kind: string) => {
    setDetail((d) => (d && (d.campaign?.id ?? null) === (campaign?.id ?? null) && d.kind === kind ? null : { campaign, kind }));
  };
  const isOpen = (campaign: Campaign | null, kind: string) =>
    !!detail && (detail.campaign?.id ?? null) === (campaign?.id ?? null) && detail.kind === kind;

  const call = async (dryRun: boolean) => {
    const { data, error } = await db.functions.invoke("email-campaign-send", {
      body: { subject, body_text: bodyText, recipients: emails, dedupe_days: dedupeDays, dry_run: dryRun },
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
      `${preview.will_send.toLocaleString()}명에게 보냅니다.\n\n· 제목: (광고) ${subject.replace(/^\(광고\)\s*/, "")}\n· 수신거부 ${preview.skipped_optout}명은 자동으로 뺐습니다\n${preview.skipped_duplicate ? `· 이전에 받은 ${preview.skipped_duplicate}명은 뺐습니다\n` : ""}· 보낸 뒤에는 되돌릴 수 없습니다`,
      { title: "메일 보내기", confirmLabel: "보내기" });
    if (!ok) return;
    setMsg(null); setBusy("send");
    try {
      const r = await call(false);
      setMsg({ tone: r.failed ? "warn" : "ok", text: `발송 ${r.sent ?? 0}명 완료${r.failed ? ` · 실패 ${r.failed}명 (아래 이력에서 확인)` : ""} · 수신거부 제외 ${r.skipped_optout}명${r.skipped_duplicate ? ` · 중복 제외 ${r.skipped_duplicate}명` : ""}` });
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
        desc="소개·광고 메일을 hello@owner-view.com 에서 보냅니다. 수신거부한 주소는 자동으로 빠지고, 제목의 (광고) 표시·발신자·수신거부 안내는 자동으로 붙습니다. 반송·스팸신고 주소는 다음 발송부터 자동 제외됩니다."
      />

      <div className="pf-kpi-grid">
        {([
          { kind: "sent", label: "지금까지 발송", value: totals.sent },
          { kind: "bounced", label: "반송", value: totals.bounced },
          { kind: "complained", label: "스팸 신고", value: totals.complained, live: totals.complained > 0 },
        ] as const).map((t, i) => (
          <PfCard key={t.kind} i={i + 1} className={`pf-kpi-tile ${isOpen(null, t.kind) ? "ring-2 ring-[var(--primary)]" : ""}`}>
            <button type="button" className="block w-full text-left disabled:cursor-default" disabled={t.value === 0}
              onClick={() => openDetail(null, t.kind)} title={t.value > 0 ? "눌러서 주소 보기" : undefined}>
              <PfKpi label={t.label} value={t.value} unit="통" live={"live" in t ? t.live : false} />
              {t.value > 0 && <span className="text-[11px] text-[var(--text-dim)]">{isOpen(null, t.kind) ? "닫기 ▲" : "눌러서 주소 보기 ▼"}</span>}
            </button>
          </PfCard>
        ))}
      </div>

      {detail && !detail.campaign && <RecipientPanel key={`all:${detail.kind}`} scope={detail} onClose={() => setDetail(null)} />}

      <PfCard i={4} hover={false}>
        <PfCardHead title="새 메일" sub="제목·본문·받는 주소를 넣고 '미리 계산'으로 몇 명에게 나가는지 먼저 확인하세요" />
        <PfCardBody>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">제목 <span className="text-[var(--text-dim)]">· 앞에 (광고)가 자동으로 붙습니다</span></span>
              <input className="pf-input" value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} placeholder="사장님 대신 회사 상황을 매일 정리해 드립니다" maxLength={200} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">본문 <span className="text-[var(--text-dim)]">· 줄바꿈 그대로 나갑니다. 링크는 <code>[바로가기](https://주소)</code> 처럼 쓰거나 주소를 그대로 적으세요. 발신자·수신거부 안내는 끝에 자동으로 붙습니다</span></span>
              <textarea className="pf-input min-h-[220px] font-[inherit]" value={bodyText} onChange={(e) => { setBodyText(e.target.value); setPreview(null); }} placeholder="안녕하세요, 오너뷰입니다. …" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">받는 주소 <span className="text-[var(--text-dim)]">· 줄바꿈·쉼표·엑셀 복사 그대로 붙여 넣으면 이메일만 골라냅니다 (한 번에 2,000명까지)</span></span>
              <textarea className="pf-input min-h-[120px] font-mono text-[12px]" value={listText} onChange={(e) => { setListText(e.target.value); setPreview(null); }} placeholder={"ceo@company.com\n대표님, hong@example.com, 02-1234-5678"} />
              <span className="text-[11px] text-[var(--text-dim)]">주소 {emails.length.toLocaleString()}개 인식</span>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--text-muted)]">이전 발송과 겹치는 주소 <span className="text-[var(--text-dim)]">· 목록을 나눠 보낼 때 같은 사람이 두 번 받지 않게 합니다</span></span>
              <select className="pf-input max-w-[320px]" value={dedupeDays} onChange={(e) => { setDedupeDays(Number(e.target.value)); setPreview(null); }}>
                {DEDUPE_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" className="btn-secondary btn-sm" disabled={!canPreview} onClick={runPreview}>
                {busy === "preview" ? "계산 중…" : "미리 계산"}
              </button>
              {preview && (
                <span className="text-sm text-[var(--text-muted)]">
                  총 <b className="mono-number">{preview.total.toLocaleString()}</b>명 · 수신거부 제외 <b className="mono-number">{preview.skipped_optout.toLocaleString()}</b>명 · 중복 제외 <b className="mono-number">{(preview.skipped_duplicate ?? 0).toLocaleString()}</b>명 → 발송 예정 <b className="mono-number text-[var(--text)]">{preview.will_send.toLocaleString()}</b>명
                  {preview.invalid.length > 0 && <> · 형식 오류 {preview.invalid.length}개 제외</>}
                </span>
              )}
              <span className="ml-auto" />
              <button type="button" className="btn-primary btn-sm" disabled={!preview || preview.will_send === 0 || !!busy} onClick={runSend}
                title={!preview ? "먼저 '미리 계산'을 누르세요" : undefined}>
                {busy === "send" ? "보내는 중…" : preview ? `${preview.will_send.toLocaleString()}명에게 보내기` : "보내기"}
              </button>
            </div>
            {preview?.orphan_links && preview.orphan_links.length > 0 && (
              <p className="text-sm text-[var(--danger)]">
                링크 주소가 없는 곳이 있습니다: {preview.orphan_links.map((l) => `[${l}]`).join(", ")} — 다른 곳에서 복사하면 링크가 떨어집니다.
                <code>[{preview.orphan_links[0]}](https://주소)</code> 처럼 주소를 붙여 주세요.
              </p>
            )}
            {preview?.preview_html && (
              <div className="grid gap-1">
                <span className="text-xs text-[var(--text-muted)]">받는 사람에게 보이는 모양</span>
                {/* 스크립트 없는 샌드박스 — 링크는 새 창으로만 열린다 */}
                <iframe title="메일 미리보기" sandbox="allow-popups allow-popups-to-escape-sandbox" className="w-full h-[420px] rounded-md border border-[var(--border)] bg-white"
                  srcDoc={`<base target="_blank"><body style="margin:16px;background:#fff">${preview.preview_html}</body>`} />
              </div>
            )}
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
                    <th className="text-right">대상</th><th className="text-right">발송</th><th className="text-right">수신거부 제외</th><th className="text-right">중복 제외</th><th className="text-right">실패</th>
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
                        <td className="text-right mono-number"><CountCell n={c.skipped_optout} active={isOpen(c, "skipped_optout")} onClick={() => openDetail(c, "skipped_optout")} /></td>
                        <td className="text-right mono-number"><CountCell n={(c.skipped_duplicate ?? 0)} active={isOpen(c, "skipped_duplicate")} onClick={() => openDetail(c, "skipped_duplicate")} /></td>
                        <td className="text-right mono-number"><CountCell n={c.failed_count} active={isOpen(c, "failed")} onClick={() => openDetail(c, "failed")} /></td>
                        <td className="text-right mono-number">{Number(c.delivered).toLocaleString()}</td>
                        <td className="text-right mono-number"><CountCell n={Number(c.bounced)} active={isOpen(c, "bounced")} onClick={() => openDetail(c, "bounced")} /></td>
                        <td className="text-right mono-number"><CountCell n={Number(c.complained)} active={isOpen(c, "complained")} onClick={() => openDetail(c, "complained")} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {detail?.campaign && <RecipientPanel key={`${detail.campaign.id}:${detail.kind}`} scope={detail} onClose={() => setDetail(null)} />}
        </PfCardBody>
      </PfCard>
    </PfPage>
  );
}

/** 이력 표 숫자 — 0 이 아니면 눌러서 그 주소 목록을 연다 */
function CountCell({ n, active, onClick }: { n: number; active: boolean; onClick: () => void }) {
  const v = Number(n || 0);
  if (v === 0) return <>0</>;
  return (
    <button type="button" onClick={onClick} title="눌러서 주소 보기"
      className={`underline decoration-dotted underline-offset-2 hover:text-[var(--primary)] ${active ? "text-[var(--primary)] font-semibold" : ""}`}>
      {v.toLocaleString()}
    </button>
  );
}

/** 누른 건수의 주소 목록 — 1,000개씩 넘겨 보고, 복사는 전체를 모아서 */
function RecipientPanel({ scope, onClose }: { scope: DetailScope; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [copyState, setCopyState] = useState<"" | "busy" | "done">("");
  const statuses = KIND_STATUSES[scope.kind] || [scope.kind];
  const fetchPage = async (n: number) => {
    const { data, error } = await (db.rpc as any)("operator_list_email_recipients",
      { p_statuses: statuses, p_campaign: scope.campaign?.id ?? null, p_limit: PAGE, p_offset: n * PAGE });
    if (error) throw error;
    return (data || []) as Recipient[];
  };
  const { data: rows = [], isLoading } = useQuery<Recipient[]>({
    queryKey: ["op-email-recipients", scope.campaign?.id ?? "all", scope.kind, page],
    queryFn: () => fetchPage(page),
  });
  const total = rows[0] ? Number(rows[0].total) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const showStatus = statuses.length > 1;
  const showCampaign = !scope.campaign;

  const copyAll = async () => {
    setCopyState("busy");
    try {
      const all: string[] = [];
      for (let n = 0; n < pages; n++) all.push(...(n === page ? rows : await fetchPage(n)).map((r) => r.email));
      await navigator.clipboard.writeText([...new Set(all)].join("\n"));
      setCopyState("done");
    } catch { setCopyState(""); }
  };

  return (
    <div className="mt-4 rounded-md border border-[var(--border)] p-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <b className="text-sm">{DETAIL_LABEL[scope.kind]} 주소 {isLoading ? "" : `${total.toLocaleString()}개`}</b>
        <span className="text-xs text-[var(--text-dim)] truncate max-w-[420px]">
          {scope.campaign ? `${kstDateTime(scope.campaign.sent_at || scope.campaign.created_at)} · ${scope.campaign.subject}` : "지금까지 보낸 메일 전체"}
        </span>
        <span className="ml-auto" />
        {total > 0 && (
          <button type="button" className="btn-secondary btn-sm" disabled={copyState === "busy"} onClick={copyAll}>
            {copyState === "busy" ? "모으는 중…" : copyState === "done" ? "복사했습니다" : `주소 ${total.toLocaleString()}개 복사`}
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
      </div>
      {(scope.kind === "bounced" || scope.kind === "complained") && (
        <p className="text-xs text-[var(--text-dim)] mb-2">이 주소들은 수신거부 목록에 들어가 다음 발송부터 자동으로 빠집니다.</p>
      )}
      {isLoading ? <PfSkeleton rows={3} /> : rows.length === 0 ? <PfEmpty>해당 주소가 없습니다.</PfEmpty> : (
        <div className="overflow-auto max-h-[420px]">
          <table className="pf-table">
            <thead>
              <tr>
                <th>주소</th>{showStatus && <th>상태</th>}<th>{showStatus ? "비고" : "사유"}</th>{showCampaign && <th>보낸 메일</th>}<th>시각</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.campaign_id}:${r.email}`}>
                  <td className="font-mono text-[12px]">{r.email}</td>
                  {showStatus && <td className="whitespace-nowrap">{STATUS_LABEL[r.status] || r.status}</td>}
                  <td className="text-[var(--text-muted)]" title={r.error || undefined}>{r.status === "delivered" || r.status === "sent" ? "" : reasonOf(r)}</td>
                  {showCampaign && <td className="max-w-[260px] truncate text-[var(--text-muted)]" title={r.campaign_subject}>{kstDateTime(r.campaign_sent_at)} · {r.campaign_subject}</td>}
                  <td className="whitespace-nowrap text-[var(--text-muted)]">{kstDateTime(r.updated_at || r.sent_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-2 mt-2 text-xs text-[var(--text-muted)]">
          <button type="button" className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>이전</button>
          <span className="mono-number">{(page * PAGE + 1).toLocaleString()}–{Math.min(total, (page + 1) * PAGE).toLocaleString()} / {total.toLocaleString()}</span>
          <button type="button" className="btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>다음</button>
        </div>
      )}
    </div>
  );
}

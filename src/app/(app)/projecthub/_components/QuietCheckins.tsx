"use client";

// 조용한 프로젝트 한 줄 체크인 — 프로젝트 목록 맨 위 한 구획.
//
// 배경 (2026-08-03 실측):
//   살아 있는 프로젝트 9개 중 7개(78%)가 2주 이상 아무 변화가 없었고, 주간 보고는 1건,
//   체크인 주기를 정한 프로젝트는 1개뿐이었다. 만들어놓고 방치되다 그대로 보관된다.
//   → 조용한 것만 골라 "한 줄"만 묻는다. 초안은 지난 2주 데이터에서 미리 채운다.
//
// 절대규칙
//   · 한 주에 최대 3개만 노출한다. 7개를 전부 띄우면 알림 피로로 통째로 무시된다.
//   · 자동으로 기록하지 않는다 — 초안만 채우고 남기는 것은 사람이 누른다.
//   · 이번 주에 이미 남겼거나 넘긴 프로젝트는 다음 주에 다시 묻는다.

import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { computePeriodStart } from "@/lib/project-checkin";
import { todayKst } from "@/lib/kst";

const MAX_ROWS = 3;          // 한 주에 묻는 최대 개수
const QUIET_DAYS = 14;       // 이 기간 아무 변화가 없으면 '조용'
const SNOOZE_KEY = "ov.projecthub.checkinSnooze";

type Deal = { id: string; name: string; stage?: string | null; updated_at?: string | null; created_at?: string | null };
type Task = { deal_id: string; status?: string | null; updated_at?: string | null };

const daysBetween = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export function QuietCheckins({ companyId, userId, deals, tasks, outstandingOf, won, toast, open, onCount }: {
  companyId: string;
  userId: string | null;
  deals: Deal[];
  tasks: Task[];
  outstandingOf: (dealId: string) => number;
  won: (n: number | null | undefined) => string;
  toast: (msg: string, kind?: any) => void;
  /** 접힘/펼침 — 목록 위가 길어지지 않게 기본은 접힌 상태다(2026-08-03 사장님 지적) */
  open: boolean;
  /** 접혀 있어도 개수는 위쪽 한 줄에 보여야 하므로 부모에게 알린다 */
  onCount: (n: number) => void;
}) {
  const qc = useQueryClient();
  const week = computePeriodStart("weekly");
  const dealIds = useMemo(() => deals.map((d) => d.id), [deals]);

  const { data: updates = [] } = useQuery({
    queryKey: ["projecthub-updates", companyId, dealIds.length],
    queryFn: async () => {
      if (!dealIds.length) return [];
      const data = logRead('QuietCheckins:updates', await supabase
        .from("project_updates").select("deal_id, update_date, period_start, created_at")
        .in("deal_id", dealIds).order("update_date", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });

  // 이번 주는 넘기기 — 주차 단위로 기억한다(다음 주엔 다시 묻는다).
  const [snoozed, setSnoozed] = useState<string[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { setSnoozed(JSON.parse(window.localStorage.getItem(SNOOZE_KEY) || "[]")); } catch { /* 깨진 값 무시 */ }
  }, []);
  const snooze = (dealId: string) => {
    setSnoozed((prev) => {
      const next = [...prev.filter((k) => k.startsWith(`${week}:`)), `${week}:${dealId}`];
      if (typeof window !== "undefined") window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const rows = useMemo(() => {
    if (!deals.length) return [] as { deal: Deal; quietDays: number; draft: string }[];
    // 프로젝트별 마지막 움직임 — 프로젝트 자체 수정 / 업무 변경 / 지난 체크인 중 가장 최근
    const lastAct: Record<string, number> = {};
    const touch = (id: string, iso?: string | null) => {
      if (!id || !iso) return;
      const t = new Date(iso).getTime();
      if (!lastAct[id] || t > lastAct[id]) lastAct[id] = t;
    };
    for (const d of deals) touch(d.id, d.updated_at || d.created_at);
    for (const t of tasks) touch(t.deal_id, t.updated_at);
    for (const u of updates as any[]) touch(u.deal_id, u.created_at);

    // 이번 주에 이미 남긴 프로젝트는 묻지 않는다
    const done = new Set((updates as any[])
      .filter((u) => String(u.period_start || u.update_date || "") >= week)
      .map((u) => u.deal_id));

    // 지난 2주 완료 업무 수 — 초안 문장에 쓴다
    const recentDone: Record<string, number> = {};
    for (const t of tasks) {
      if (t.status !== "done" || !t.updated_at) continue;
      if (daysBetween(t.updated_at) > QUIET_DAYS) continue;
      recentDone[t.deal_id] = (recentDone[t.deal_id] || 0) + 1;
    }

    return deals
      .filter((d) => d.stage !== "completed" && d.stage !== "settlement")
      .filter((d) => !done.has(d.id) && !snoozed.includes(`${week}:${d.id}`))
      .map((d) => {
        const last = lastAct[d.id];
        const quietDays = last ? Math.floor((Date.now() - last) / 86_400_000) : QUIET_DAYS;
        const bits: string[] = [];
        if (recentDone[d.id]) bits.push(`지난 2주 완료 ${recentDone[d.id]}건`);
        const out = outstandingOf(d.id);
        if (out > 1) bits.push(`미수 ${won(out)}`);
        const draft = bits.length ? `${bits.join(" · ")}. ` : "";
        return { deal: d, quietDays, draft };
      })
      .filter((r) => r.quietDays >= QUIET_DAYS)
      .sort((a, b) => b.quietDays - a.quietDays)
      .slice(0, MAX_ROWS);
  }, [deals, tasks, updates, snoozed, week, outstandingOf, won]);

  const [text, setText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const save = async (dealId: string, name: string) => {
    const body = (text[dealId] ?? "").trim();
    if (!body || saving) return;
    setSaving(dealId);
    try {
      const { error } = await supabase.from("project_updates").insert({
        company_id: companyId, deal_id: dealId, update_date: todayKst(),
        period_start: week, did: body, created_by: userId,
      });
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["projecthub-updates"] });
      qc.invalidateQueries({ queryKey: ["project-updates", dealId] });
      toast(`'${name}' 이번 주 기록을 남겼습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "기록 실패", "error");
    } finally {
      setSaving(null);
    }
  };

  useEffect(() => { onCount(rows.length); }, [rows.length, onCount]);

  if (rows.length === 0 || !open) return null;

  return (
    <section className="ph-checkins">
      <div className="ph-checkins-head">
        <b>2주 이상 변동 없는 프로젝트</b>
        <span>한 줄만 남겨두면 나중에 경과를 알 수 있어요. 이번 주는 {rows.length}건만 표시해요.</span>
      </div>
      {rows.map((r) => (
        <div key={r.deal.id} className="ph-checkin">
          <div className="ph-checkin-top">
            <b>{r.deal.name}</b>
            <span>{r.quietDays}일째 변동 없음</span>
            <button type="button" className="ph-checkin-skip" onClick={() => snooze(r.deal.id)}>이번 주 넘기기</button>
          </div>
          <div className="ph-checkin-write">
            <input
              value={text[r.deal.id] ?? r.draft}
              onChange={(e) => setText((p) => ({ ...p, [r.deal.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") save(r.deal.id, r.deal.name); }}
              placeholder="예: 거래처 검토 대기 중, 다음 주 재확인"
              className="ph-checkin-input" />
            <button type="button" className="ph-checkin-save"
              disabled={saving === r.deal.id || !(text[r.deal.id] ?? r.draft).trim()}
              onClick={() => save(r.deal.id, r.deal.name)}>
              {saving === r.deal.id ? "남기는 중…" : "남기기"}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

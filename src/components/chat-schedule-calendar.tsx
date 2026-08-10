"use client";

// 메신저 오른쪽의 달력 (2026-08-10 사장님 지시 + Teams 화면 캡처).
//
//   왼쪽 레일에서 '일정' 을 고르면 대화창 자리에 이 달력이 선다. 예전엔 '무슨 일정인가요' 라는
//   입력칸에 제목부터 쳐야 했는데, 일정은 **날짜를 먼저 고르는 일**이다 —
//   일정/할 일 메뉴와 같게 **날짜 칸을 누르면** 그 날짜로 넣는 창이 열린다.
//
//   저장은 lib/schedule 의 upsertEvent — 일정/할 일 메뉴와 같은 자리로 간다.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { todayKst } from "@/lib/kst";
import {
  getMonthEvents, upsertEvent, eventDateKeys, EVENT_COLOR_BG,
  type ScheduleEvent, type EventColor,
} from "@/lib/schedule";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const COLORS: [EventColor, string][] = [
  ["blue", "파랑"], ["green", "초록"], ["red", "빨강"], ["amber", "노랑"], ["violet", "보라"], ["gray", "회색"],
];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

export function ChatScheduleCalendar({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  //   날짜를 누르면 그 날짜로 여는 입력 창
  const [draft, setDraft] = useState<null | { date: string; title: string; shared: boolean; color: EventColor }>(null);

  const { data: events = [] } = useQuery({
    queryKey: ["chat-cal-events", companyId, userId, view.y, view.m0],
    queryFn: () => getMonthEvents(companyId!, view.y, view.m0, { scope: "both", userId: userId || undefined }),
    enabled: !!companyId,
  });

  //   날짜별로 모아 둔다 — 기간 일정은 걸친 날마다 들어간다(일정 화면과 같은 규칙)
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of events as ScheduleEvent[]) {
      for (const k of eventDateKeys(e)) {
        const arr = m.get(k) || [];
        arr.push(e);
        m.set(k, arr);
      }
    }
    return m;
  }, [events]);

  const first = new Date(view.y, view.m0, 1);
  const daysInMonth = new Date(view.y, view.m0 + 1, 0).getDate();
  const lead = first.getDay();
  const cells: ({ d: number; key: string } | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, key: keyOf(view.y, view.m0, d) });
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayKst();
  const move = (step: number) => setView((v) => {
    const n = new Date(v.y, v.m0 + step, 1);
    return { y: n.getFullYear(), m0: n.getMonth() };
  });

  const add = useMutation({
    //   ⚠️ 하루 종일 일정은 날짜 문자열 그대로 — toISOString() 을 쓰면 KST 자정이 UTC 로 밀려 하루 전이 된다
    mutationFn: () => upsertEvent({
      companyId: companyId!, userId: userId!, title: draft!.title.trim(),
      startAt: `${draft!.date}T00:00:00`, allDay: true, color: draft!.color, isShared: draft!.shared,
    }),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["chat-cal-events"] });
      qc.invalidateQueries({ queryKey: ["chat-schedule-events"] });
      qc.invalidateQueries({ queryKey: ["schedule-events"] });   // 일정/할 일 메뉴도 같이
      toast("일정에 넣었습니다.", "success");
    },
    onError: (e: any) => toast(e?.message || "일정 저장 실패", "error"),
  });

  const canSave = !!draft?.title.trim() && !!companyId && !!userId && !add.isPending;
  useModalKeys(!!draft, () => setDraft(null), canSave ? () => add.mutate() : undefined);

  return (
    <div className="chat-cal">
      <header className="chat-cal-head">
        <button type="button" onClick={() => move(-1)} title="이전 달">‹</button>
        <b>{view.y}년 {view.m0 + 1}월</b>
        <button type="button" onClick={() => move(1)} title="다음 달">›</button>
        <button type="button" className="chat-cal-today"
          onClick={() => setView({ y: now.getFullYear(), m0: now.getMonth() })}>오늘</button>
        <span className="chat-cal-hint">날짜를 누르면 그 날 일정을 넣습니다</span>
      </header>

      <div className="chat-cal-week">
        {WD.map((w, i) => (
          <span key={w} className={i === 0 ? "chat-cal-sun" : i === 6 ? "chat-cal-sat" : ""}>{w}</span>
        ))}
      </div>

      <div className="chat-cal-grid">
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} className="chat-cal-day chat-cal-day-out" />;
          const list = byDay.get(c.key) || [];
          const dow = i % 7;
          return (
            <button key={c.key} type="button" className={`chat-cal-day ${c.key === today ? "chat-cal-day-today" : ""}`}
              onClick={() => setDraft({ date: c.key, title: "", shared: true, color: "blue" })}
              title={`${c.key} 에 일정 넣기`}>
              <span className={`chat-cal-daynum ${dow === 0 ? "chat-cal-sun" : dow === 6 ? "chat-cal-sat" : ""}`}>{c.d}</span>
              {list.slice(0, 3).map((e) => (
                <span key={e.id} className={`chat-cal-ev ${EVENT_COLOR_BG[e.color] || ""}`} title={e.title}>{e.title}</span>
              ))}
              {list.length > 3 && <span className="chat-cal-more">+{list.length - 3}</span>}
            </button>
          );
        })}
      </div>

      {/* 날짜를 누르면 뜨는 입력 창 — 제목만 적으면 끝난다 */}
      {draft && (
        <div className="chat-cal-modal" onClick={() => setDraft(null)}>
          <div className="chat-cal-box" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>{draft.date}</b>
              <span>일정 넣기</span>
              <button type="button" onClick={() => setDraft(null)} title="닫기">✕</button>
            </header>
            <input autoFocus value={draft.title} placeholder="일정 이름"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="chat-cal-input" />
            <div className="chat-cal-colors">
              {COLORS.map(([c, label]) => (
                <button key={c} type="button" title={label} aria-pressed={draft.color === c}
                  onClick={() => setDraft({ ...draft, color: c })}
                  className={`chat-cal-color ${DOT[c]} ${draft.color === c ? "chat-cal-color-on" : ""}`} />
              ))}
            </div>
            <label className="chat-cal-check">
              <input type="checkbox" checked={draft.shared}
                onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
              전체 공유 — 회사 구성원 모두에게 보입니다
            </label>
            <div className="chat-cal-foot">
              <button type="button" className="chat-cal-cancel" onClick={() => setDraft(null)}>취소</button>
              <button type="button" className="chat-cal-save" disabled={!canSave} onClick={() => add.mutate()}>
                {add.isPending ? "넣는 중…" : "넣기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

//   색 고르기용 진한 점 — EVENT_COLOR_BG 는 옅은 배경이라 단추로는 잘 안 보인다
const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};

// 내 상태(presence) — 2026-09-04 사장님 "우측 상단 내 이름을 눌렀을 때 현재 상태를 설정, 회의중·자리비움 등, 메신저에도 표시"
//   저장은 users.presence_status·presence_note·presence_until·presence_set_at (마이그레이션 20260904120000).
//   서버 잡 없이 만료를 다룬다: until 이 지났으면 화면이 '근무중' 으로 본다(effectivePresence).
//   '근무중' 은 기본값이라 메신저에서 표시하지 않는다 — 평소엔 아무 표시가 없고 예외 상태만 보인다.

export type PresenceStatus = "available" | "meeting" | "away" | "out" | "focus" | "off";

export const PRESENCE: { id: PresenceStatus; label: string; hint: string }[] = [
  { id: "available", label: "근무중", hint: "기본 — 표시 없음" },
  { id: "meeting", label: "회의중", hint: "답이 늦을 수 있음" },
  { id: "away", label: "자리비움", hint: "잠깐 자리를 비움" },
  { id: "out", label: "외근", hint: "회사 밖에서 근무" },
  { id: "focus", label: "집중 근무", hint: "급한 일만 연락" },
  { id: "off", label: "퇴근·휴가", hint: "오늘은 응답 없음" },
];
export const PRESENCE_LABEL: Record<PresenceStatus, string> = Object.fromEntries(PRESENCE.map((p) => [p.id, p.label])) as Record<PresenceStatus, string>;

/** 해제 시점 선택지 — 분 단위. 0 = 직접 해제할 때까지, -1 = 오늘 자정까지 */
export const PRESENCE_UNTIL: { id: string; label: string; minutes: number }[] = [
  { id: "30m", label: "30분", minutes: 30 },
  { id: "1h", label: "1시간", minutes: 60 },
  { id: "2h", label: "2시간", minutes: 120 },
  { id: "today", label: "오늘까지", minutes: -1 },
  { id: "manual", label: "직접 해제", minutes: 0 },
];

export type PresenceRow = { presence_status?: string | null; presence_note?: string | null; presence_until?: string | null };
export type Presence = { status: PresenceStatus; note: string | null; until: string | null };

/** 저장된 값 → 화면이 보는 상태. until 이 지났거나 값이 없으면 근무중. */
export function effectivePresence(row: PresenceRow | null | undefined, now: number = Date.now()): Presence {
  const raw = (row?.presence_status || "available") as PresenceStatus;
  const valid = PRESENCE.some((p) => p.id === raw) ? raw : "available";
  if (valid === "available") return { status: "available", note: null, until: null };
  const until = row?.presence_until || null;
  if (until && new Date(until).getTime() <= now) return { status: "available", note: null, until: null };
  return { status: valid, note: row?.presence_note || null, until };
}

/** "회의중 · 14:30까지" / "외근 · 오늘까지 · 3시 복귀" */
export function presenceText(p: Presence): string {
  if (p.status === "available") return "";
  const parts = [PRESENCE_LABEL[p.status]];
  if (p.until) {
    const d = new Date(p.until); const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    parts.push(sameDay ? (d.getHours() === 23 && d.getMinutes() === 59 ? "오늘까지" : `${hm}까지`) : `${d.getMonth() + 1}/${d.getDate()} ${hm}까지`);
  }
  if (p.note) parts.push(p.note);
  return parts.join(" · ");
}

/** 선택지 → until 시각(ISO) 또는 null */
export function untilFromChoice(id: string, now: Date = new Date()): string | null {
  const c = PRESENCE_UNTIL.find((u) => u.id === id);
  if (!c || c.minutes === 0) return null;
  if (c.minutes === -1) { const d = new Date(now); d.setHours(23, 59, 0, 0); return d.toISOString(); }
  return new Date(now.getTime() + c.minutes * 60_000).toISOString();
}

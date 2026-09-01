"use client";

// 일정 입력 창 — **워크스페이스(일정 메뉴)와 메신저가 같은 것을 쓴다** (2026-08-10 사장님 지시:
//   "앞으로 동일한 메뉴로 본다"). 한쪽만 바뀌는 일이 없게 여기 하나로 모았다.
//
//   · '할 일' 이라는 구분이 없다 — 날짜를 비우면 목록에만 남고, 넣으면 달력에도 뜬다.
//   · 공유 범위는 **기본이 '나만'** 이고, 구성원 · 부서 · 전체를 골라 넓힌다.
//     ⚠️ 못 볼 사람에게 안 보이게 막는 것은 RLS 다. 이 화면은 무엇으로 저장할지만 고른다.
//   · 이름 옆에 '어떤 일정인지'(설명)를 적는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getCompanyUsers } from "@/lib/queries";
import { ChatEmojiPicker } from "@/components/chat-emoji-picker";
import { resolveSignedUrl } from "@/lib/file-storage";
import {
  getDepartments, uploadScheduleFile, VISIBILITY_LABEL,
  type EventColor, type ScheduleAttachment, type ScheduleEvent, type Visibility,
} from "@/lib/schedule";
import { supabase } from "@/lib/supabase";

const COLORS: [EventColor, string][] = [
  ["blue", "파랑"], ["green", "초록"], ["red", "빨강"], ["amber", "노랑"], ["violet", "보라"], ["gray", "회색"],
];
const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};
const VIS: Visibility[] = ["private", "members", "departments", "company"];
const VIS_HINT: Record<Visibility, string> = {
  private: "나만 봅니다",
  members: "고른 사람에게만 보입니다",
  departments: "고른 부서 사람들에게 보입니다",
  company: "회사 구성원 모두에게 보입니다",
};

export type ScheduleDraft = {
  id?: string;
  title: string;
  description: string;
  /** 비우면 날짜 없는 항목(옛 '할 일') */
  from: string;
  to: string;
  color: EventColor;
  visibility: Visibility;
  targetUserIds: string[];
  targetDepartments: string[];
  attachments: ScheduleAttachment[];
  /** 반복(결정 145) — "" = 안 함 */
  recurFreq: "" | "daily" | "weekly" | "monthly";
  recurWeekday: number;
  /** 알림 — "" = 없음, 'morning' = 당일 아침 8:30. 반복 일정은 저장 시 비워진다(1차 미지원) */
  reminder: string;
};

/** 저장된 일정 → 편집용 초안. 새로 만들 때는 날짜만 넣어 부르면 된다. */
export function draftFromEvent(e?: Partial<ScheduleEvent> | null, fallback?: { from?: string; to?: string }): ScheduleDraft {
  const from = (e?.start_at || "").slice(0, 10) || fallback?.from || "";
  const to = (e?.end_at || "").slice(0, 10) || fallback?.to || from;
  return {
    id: e?.id,
    title: e?.title || "",
    description: e?.description || "",
    from, to,
    color: (e?.color as EventColor) || "blue",
    visibility: (e?.visibility as Visibility) || "private",
    targetUserIds: e?.target_user_ids || [],
    targetDepartments: e?.target_departments || [],
    attachments: e?.attachments || [],
    recurFreq: (e?.recurrence?.freq as ScheduleDraft["recurFreq"]) || "",
    recurWeekday: e?.recurrence?.weekday ?? new Date(`${from || "2026-01-05"}T00:00:00`).getDay(),
    reminder: e?.reminder || "",
  };
}

export function ScheduleItemEditor({
  companyId, userId, draft, onChange, onSave, onDelete, onClose, saving,
}: {
  companyId: string | null;
  userId: string | null;
  draft: ScheduleDraft;
  onChange: (d: ScheduleDraft) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picker, setPicker] = useState<null | "emoji">(null);
  const [uploading, setUploading] = useState(false);

  //   이모지는 커서 자리에 — 설명을 쓰다 중간에 넣을 수 있게
  const insertEmoji = (em: string) => {
    const el = descRef.current;
    const start = el?.selectionStart ?? draft.description.length;
    const end = el?.selectionEnd ?? start;
    const next = draft.description.slice(0, start) + em + draft.description.slice(end);
    set({ description: next });
    const pos = start + em.length;
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };

  const addFile = async (file: File) => {
    if (!companyId || uploading) return;
    setUploading(true);
    try {
      const att = await uploadScheduleFile(companyId, file);
      set({ attachments: [...draft.attachments, att] });
    } catch (e: any) {
      alert(e?.message || "파일을 올리지 못했습니다");
    } finally { setUploading(false); }
  };

  //   documents 버킷은 비공개다 — 누를 때마다 잠깐 쓰는 주소를 새로 받는다
  const openFile = async (f: ScheduleAttachment) => {
    const url = await resolveSignedUrl(f.url, f.name);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  };
  const canSave = !!draft.title.trim() && !!companyId && !!userId && !saving;
  useModalKeys(true, onClose, canSave ? onSave : undefined);

  //   알림 발송은 feature_rollout('schedule_reminders') 게이트(모티브 먼저) — 안 켜진 회사엔 칸 자체를 숨긴다
  const { data: remindReady = false } = useQuery({
    queryKey: ["feat-schedule-reminders", companyId],
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("feature_on", { p_feature: "schedule_reminders", p_company: companyId });
      return data === true;
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId && draft.visibility === "members",
    staleTime: 5 * 60_000,
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["schedule-departments", companyId],
    queryFn: () => getDepartments(companyId!),
    enabled: !!companyId && draft.visibility === "departments",
    staleTime: 5 * 60_000,
  });

  //   범위를 좁히면 고른 대상은 지운다 — 안 보이는 곳에 남아 있으면 나중에 오해를 준다
  useEffect(() => {
    if (draft.visibility !== "members" && draft.targetUserIds.length) set({ targetUserIds: [] });
    if (draft.visibility !== "departments" && draft.targetDepartments.length) set({ targetDepartments: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.visibility]);

  //   시작 날짜를 바꾸면 반복 요일을 그 날짜의 요일로 맞춘다 — 9/03(목)을 넣었는데 수요일로
  //   반복되는 사고 방지(2026-09-01 실측서 잡음). 요일을 따로 고른 뒤라도 날짜가 우선.
  useEffect(() => {
    if (!draft.from) return;
    const wd = new Date(`${draft.from}T00:00:00`).getDay();
    if (!Number.isNaN(wd) && wd !== draft.recurWeekday) set({ recurWeekday: wd });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.from]);

  const toggleUser = (id: string) => set({
    targetUserIds: draft.targetUserIds.includes(id)
      ? draft.targetUserIds.filter((x) => x !== id) : [...draft.targetUserIds, id],
  });
  const toggleDept = (name: string) => set({
    targetDepartments: draft.targetDepartments.includes(name)
      ? draft.targetDepartments.filter((x) => x !== name) : [...draft.targetDepartments, name],
  });

  return (
    <div className="sched-editor" onClick={onClose}>
      <div className="sched-editor-box" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>{draft.id ? "일정 고치기" : "일정 넣기"}</b>
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>

        <label className="sched-field">
          <span>이름</span>
          <input autoFocus value={draft.title} placeholder="무슨 일정인가요"
            onChange={(e) => set({ title: e.target.value })} className="sched-in" />
        </label>

        {/*  설명은 늘 펼쳐 둔다 (2026-08-10 사장님 지시) — 한 번 더 누르게 하지 않는다 */}
        <div className="sched-field sched-field-top">
          <span>설명</span>
          <div className="sched-desc-wrap">
            <textarea ref={descRef} value={draft.description} rows={3} placeholder="어떤 일정인지 · 무엇을 준비해야 하는지"
              onChange={(e) => set({ description: e.target.value })} className="sched-in sched-area" />
            <div className="sched-desc-tools">
              {/*  이모지는 **쓰던 자리**에 꽂는다 — 끝에 붙이지 않는다(메신저 작성 상자와 같은 규칙) */}
              <button type="button" className="sched-tool" aria-label="이모지" title="이모지"
                onClick={() => setPicker((p) => (p === "emoji" ? null : "emoji"))}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" />
                </svg>
              </button>
              <button type="button" className="sched-tool" aria-label="파일 첨부" title="파일 첨부"
                disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <span className="sched-tool-txt">올리는 중…</span> : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
              </button>
              <input ref={fileRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) addFile(f); e.target.value = ""; }} />
            </div>
            {picker === "emoji" && (
              <ChatEmojiPicker onClose={() => setPicker(null)} onPick={(em) => { insertEmoji(em); setPicker(null); }} />
            )}
          </div>
        </div>

        {draft.attachments.length > 0 && (
          <div className="sched-field sched-field-top">
            <span>첨부</span>
            <div className="sched-files">
              {draft.attachments.map((f, i) => (
                <span key={`${f.url}-${i}`} className="sched-file">
                  <button type="button" onClick={() => openFile(f)} title="열기">📎 {f.name}</button>
                  <button type="button" className="sched-file-x" title="빼기"
                    onClick={() => set({ attachments: draft.attachments.filter((_, x) => x !== i) })}>✕</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="sched-field">
          <span>기간</span>
          <div className="sched-range">
            <DateField value={draft.from} placeholder="날짜 없음"
              onChange={(e) => {
                const from = e.target.value;
                set({ from, to: !from ? "" : (draft.to && draft.to >= from ? draft.to : from) });
              }} />
            <i>~</i>
            <DateField value={draft.to} min={draft.from || undefined} disabled={!draft.from}
              onChange={(e) => set({ to: e.target.value || draft.from })} />
          </div>
        </div>
        {!draft.from && <p className="sched-note">날짜를 비우면 달력에 안 뜨고 <b>목록에만</b> 남습니다.</p>}

        {/* 반복(결정 145) — 한 건으로 저장되고 달력이 회차를 펼친다. 고치면 모든 회차 반영 */}
        <div className="sched-field">
          <span>반복</span>
          <div className="sched-range">
            <select className="sched-in" value={draft.recurFreq} disabled={!draft.from} aria-label="반복"
              onChange={(e) => set({ recurFreq: e.target.value as ScheduleDraft["recurFreq"] })}>
              <option value="">안 함</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
            </select>
            {draft.recurFreq === "weekly" && (
              <select className="sched-in" value={String(draft.recurWeekday)} aria-label="반복 요일"
                onChange={(e) => set({ recurWeekday: Number(e.target.value) })}>
                {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => <option key={i} value={i}>{d}요일</option>)}
              </select>
            )}
          </div>
        </div>
        {draft.recurFreq && <p className="sched-note">한 건으로 저장되고 달력에 회차로 펼쳐 보입니다 — <b>고치거나 지우면 모든 회차</b>에 적용됩니다. 매월 반복은 그 날짜가 없는 달(31일 등)엔 건너뜁니다.</p>}

        {/* 알림 — 발송 게이트가 켜진 회사에만 보인다(안 켜진 회사에 보여주면 거짓말) */}
        {remindReady && (
          <div className="sched-field">
            <span>알림</span>
            <select className="sched-in" value={draft.reminder} disabled={!draft.from || !!draft.recurFreq} aria-label="알림"
              onChange={(e) => set({ reminder: e.target.value })}>
              <option value="">없음</option>
              <option value="morning">당일 아침 8:30</option>
            </select>
          </div>
        )}
        {remindReady && !!draft.recurFreq && <p className="sched-note">반복 일정 알림은 다음 단계에서 — 지금은 단발 일정만 알림이 갑니다.</p>}
        {remindReady && !draft.recurFreq && draft.reminder && <p className="sched-note">알림은 <b>나에게</b> 옵니다(알림 벨).</p>}

        <div className="sched-field">
          <span>공유 범위</span>
          <div className="sched-vis">
            {VIS.map((v) => (
              <button key={v} type="button" onClick={() => set({ visibility: v })} aria-pressed={draft.visibility === v}
                className={`sched-vis-btn ${draft.visibility === v ? "sched-vis-on" : ""}`}>{VISIBILITY_LABEL[v]}</button>
            ))}
          </div>
        </div>
        <p className="sched-note">{VIS_HINT[draft.visibility]}</p>

        {draft.visibility === "members" && (
          <TagPicker
            placeholder="이름으로 찾아 넣기"
            empty="고를 사람이 없습니다."
            //   ⚠️ 이름을 찾으려면 **나까지 포함한 전체 목록**을 줘야 한다 — 나를 빼고 주면
            //      대상에 내가 들어 있던 일정에서 이름 대신 id 가 그대로 보인다(2026-08-10 발견).
            //      나는 후보에서만 감춘다(내 일정은 어차피 나에게 보이므로 고를 이유가 없다).
            options={(users as any[]).map((u: any) => ({ key: u.id, label: u.name || u.email }))}
            hideFromSuggest={userId ? [userId] : []}
            selected={draft.targetUserIds}
            onToggle={toggleUser} />
        )}
        {draft.visibility === "departments" && (
          <TagPicker
            placeholder="부서 이름으로 찾아 넣기"
            empty="인사기록에 부서가 적힌 구성원이 없습니다."
            options={depts.map((d) => ({ key: d.name, label: d.name, sub: `${d.count}명` }))}
            selected={draft.targetDepartments}
            onToggle={toggleDept} />
        )}

        <div className="sched-field">
          <span>색</span>
          <div className="sched-colors">
            {COLORS.map(([c, label]) => (
              <button key={c} type="button" title={label} aria-pressed={draft.color === c}
                onClick={() => set({ color: c })}
                className={`sched-color ${DOT[c]} ${draft.color === c ? "sched-color-on" : ""}`} />
            ))}
          </div>
        </div>

        <footer>
          {onDelete && <button type="button" className="sched-del" onClick={onDelete}>삭제</button>}
          <span className="sched-spacer" />
          <button type="button" className="sched-cancel" onClick={onClose}>취소</button>
          <button type="button" className="sched-save" disabled={!canSave} onClick={onSave}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 태그로 고르기 — 구성원·부서가 많아지면 체크박스 목록은 다 훑어야 해서 못 쓴다
 *  (2026-08-10 사장님 지시). 고른 것은 위에 태그로 남고, 아래에서 찾아 눌러 넣는다. */
function TagPicker({ placeholder, empty, options, selected, onToggle, hideFromSuggest = [] }: {
  placeholder: string;
  empty: string;
  options: { key: string; label: string; sub?: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  /** 후보 목록에서만 감출 것(이름은 태그에 그대로 나와야 하므로 options 에는 남겨 둔다) */
  hideFromSuggest?: string[];
}) {
  const [q, setQ] = useState("");
  const chosen = useMemo(
    () => selected.map((k) => options.find((o) => o.key === k) || { key: k, label: k }),
    [selected, options],
  );
  //   이미 고른 것은 아래 목록에서 뺀다 — 두 번 누를 일이 없게
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options
      .filter((o) => !selected.includes(o.key) && !hideFromSuggest.includes(o.key))
      .filter((o) => !t || `${o.label} ${o.sub || ""}`.toLowerCase().includes(t))
      .slice(0, 8);
  }, [options, selected, q, hideFromSuggest]);

  return (
    <div className="sched-tagbox">
      {chosen.length > 0 && (
        <div className="sched-tags">
          {chosen.map((o) => (
            <span key={o.key} className="sched-tag">
              {o.label}
              <button type="button" onClick={() => onToggle(o.key)} title="빼기">✕</button>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        //   Enter 로 첫 후보를 바로 넣는다 — 마우스 없이 이어서 여러 명을 고를 수 있게
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && matches[0]) {
            e.preventDefault();
            onToggle(matches[0].key);
            setQ("");
          }
        }}
        className="sched-tagsearch" />
      {options.length === 0 ? (
        <p className="sched-note sched-note-flat">{empty}</p>
      ) : matches.length === 0 ? (
        <p className="sched-note sched-note-flat">{q.trim() ? "찾는 것이 없습니다." : "모두 골랐습니다."}</p>
      ) : (
        <div className="sched-tagopts">
          {matches.map((o) => (
            <button key={o.key} type="button" className="sched-tagopt" onClick={() => { onToggle(o.key); setQ(""); }}>
              <span>{o.label}</span>
              {o.sub && <em>{o.sub}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

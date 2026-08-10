"use client";

// 일정 입력 창 — **워크스페이스(일정 메뉴)와 메신저가 같은 것을 쓴다** (2026-08-10 사장님 지시:
//   "앞으로 동일한 메뉴로 본다"). 한쪽만 바뀌는 일이 없게 여기 하나로 모았다.
//
//   · '할 일' 이라는 구분이 없다 — 날짜를 비우면 목록에만 남고, 넣으면 달력에도 뜬다.
//   · 공유 범위는 **기본이 '나만'** 이고, 구성원 · 부서 · 전체를 골라 넓힌다.
//     ⚠️ 못 볼 사람에게 안 보이게 막는 것은 RLS 다. 이 화면은 무엇으로 저장할지만 고른다.
//   · 이름 옆에 '어떤 일정인지'(설명)를 적는다.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getCompanyUsers } from "@/lib/queries";
import {
  getDepartments, VISIBILITY_LABEL,
  type EventColor, type ScheduleEvent, type Visibility,
} from "@/lib/schedule";

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
  const canSave = !!draft.title.trim() && !!companyId && !!userId && !saving;
  useModalKeys(true, onClose, canSave ? onSave : undefined);

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
        <label className="sched-field sched-field-top">
          <span>설명</span>
          <textarea value={draft.description} rows={3} placeholder="어떤 일정인지 · 무엇을 준비해야 하는지"
            onChange={(e) => set({ description: e.target.value })} className="sched-in sched-area" />
        </label>

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

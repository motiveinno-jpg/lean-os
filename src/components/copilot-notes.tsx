"use client";
// AI 참모 "회사 메모"(기억) — 2026-09-03 사장님: "참모를 학습시켜 쓸만하게".
//   · 참모는 매 답변마다 이 메모를 읽는다(엣지 owner-copilot 이 ai_copilot_notes 를 사용자 메시지에 싣는다).
//   · 대화 중 "기억해" → 참모가 remember_note 로 저장 / 여기서는 직접 추가·삭제 + 답변 "바로잡기" 저장.
//   · 회사별 격리(RLS: company_id = 내 회사, 관리자 또는 /copilot 권한).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { Ico } from "@/components/ui-icon";

export type CopilotNote = {
  id: string; content: string; kind: "fact" | "preference" | "correction";
  source: "user" | "feedback" | "copilot" | "auto"; question: string | null; created_at: string;
};

const KIND_KO: Record<CopilotNote["kind"], string> = { fact: "회사 사실", preference: "답변 방식", correction: "교정" };
const SOURCE_KO: Record<CopilotNote["source"], string> = { user: "직접 입력", feedback: "답변 바로잡기", copilot: "대화 중 기억", auto: "자동 기억" };

export type AutoNote = { id: string; content: string; kind: string };

/** 답변 카드 아래 "참모가 기억했어요" — 이번 대화에서 참모가 스스로 저장한 메모. 취소하면 바로 비활성. */
export function AutoMemoryChips({ notes }: { notes?: AutoNote[] }) {
  const { toast } = useToast();
  const [list, setList] = useState<AutoNote[]>(notes ?? []);
  if (!list.length) return null;
  const cancel = async (id: string) => {
    const { error } = await supabase.from("ai_copilot_notes").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return; }
    setList((l) => l.filter((n) => n.id !== id));
    toast("기억을 취소했습니다.", "success");
  };
  return (
    <div className="cpn-auto">
      {list.map((n) => (
        <div key={n.id} className="cpn-auto-item">
          <span className="cpn-auto-label"><Ico e="🧠" /> 기억했어요</span>
          <span className="cpn-auto-text">{n.content}</span>
          <button type="button" className="cpn-auto-cancel" onClick={() => void cancel(n.id)}>취소</button>
        </div>
      ))}
    </div>
  );
}

export async function saveCopilotNote(input: {
  companyId: string; content: string; kind: CopilotNote["kind"]; source: CopilotNote["source"]; question?: string | null; userId?: string | null;
}): Promise<void> {
  const content = input.content.trim().slice(0, 500);
  if (!content) throw new Error("내용을 입력해 주세요.");
  const { error } = await supabase.from("ai_copilot_notes").insert({
    company_id: input.companyId, content, kind: input.kind, source: input.source,
    question: input.question?.slice(0, 300) ?? null, created_by: input.userId ?? null,
  });
  if (error) throw error;
}

/** 답변 카드 아래 "이 답변 바로잡기" — 교정 메모로 저장해 다음 답변부터 반영. */
export function AnswerFixForm({ companyId, userId, question }: { companyId?: string; userId?: string | null; question?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!companyId) return null;
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await saveCopilotNote({ companyId, userId, content: text, kind: "correction", source: "feedback", question });
      setDone(true); setOpen(false); setText("");
      toast("참모가 기억했습니다. 다음 답변부터 반영됩니다.", "success");
    } catch (e) { toast(friendlyError(e), "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="cpn-fix">
      {done ? (
        <span className="cpn-fix-done"><Ico e="✓" /> 바로잡은 내용을 기억했습니다</span>
      ) : !open ? (
        <button type="button" className="cpn-fix-btn" onClick={() => setOpen(true)}>
          <Ico e="✎" /> 이 답변 바로잡기
        </button>
      ) : (
        <div className="cpn-fix-form">
          <label className="cpn-fix-label" htmlFor="cpn-fix-input">어떻게 답했어야 하나요? 참모가 기억해 다음부터 그렇게 답합니다.</label>
          <textarea
            id="cpn-fix-input" className="cpn-fix-input" rows={2} value={text} maxLength={500} autoFocus
            placeholder="예: 우리 회사 급여일은 25일이야 / 미수금은 세금계산서 기준이 아니라 거래 장부 기준으로 말해줘"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); setText(""); }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            }}
          />
          <div className="cpn-fix-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setOpen(false); setText(""); }} disabled={busy}>취소</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !text.trim()}>{busy ? "저장 중…" : "기억시키기"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 조회 줄 오른쪽 "참모 메모 N" 버튼 + 오른쪽 패널(목록·추가·삭제). */
export function CopilotNotesButton({ companyId, userId }: { companyId?: string; userId?: string | null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<CopilotNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<CopilotNote["kind"]>("fact");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("ai_copilot_notes")
      .select("id, content, kind, source, question, created_at")
      .eq("company_id", companyId).eq("active", true)
      .order("created_at", { ascending: false }).limit(200);
    if (error) { toast(friendlyError(error), "error"); return; }
    setNotes((data ?? []) as CopilotNote[]);
  }, [companyId, toast]);

  useEffect(() => { void load(); }, [load]);
  // 패널을 열 때마다 새로 읽는다 — 대화 중 "기억해"로 저장된 메모가 바로 보이도록.
  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!companyId) return null;
  const count = notes?.length ?? 0;

  const add = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await saveCopilotNote({ companyId, userId, content: draft, kind, source: "user" });
      setDraft(""); await load();
      toast("메모를 저장했습니다. 다음 답변부터 반영됩니다.", "success");
    } catch (e) { toast(friendlyError(e), "error"); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("ai_copilot_notes").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return; }
    setNotes((ns) => (ns ?? []).filter((n) => n.id !== id));
  };

  return (
    <>
      <button type="button" className="btn-secondary btn-sm cpn-open" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <Ico e="🧠" /> 참모 메모{count > 0 ? ` ${count}` : ""}
      </button>
      {open && (
        <div className="cpn-backdrop" onClick={() => setOpen(false)}>
          <aside className="cpn-panel" role="dialog" aria-label="참모 메모" onClick={(e) => e.stopPropagation()}>
            <div className="cpn-head">
              <div>
                <div className="cpn-title">참모 메모</div>
                <div className="cpn-sub">참모가 답할 때마다 읽는 우리 회사의 기준·사실·교정입니다. 대화 중 &ldquo;기억해&rdquo;라고 해도 여기에 쌓입니다.</div>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="닫기"><Ico e="✕" /></button>
            </div>
            <div className="cpn-add">
              <select className="cpn-kind" value={kind} onChange={(e) => setKind(e.target.value as CopilotNote["kind"])} aria-label="메모 종류">
                <option value="fact">회사 사실</option>
                <option value="preference">답변 방식</option>
                <option value="correction">교정</option>
              </select>
              <input
                className="cpn-input" value={draft} maxLength={500} placeholder="예: 급여는 매달 25일에 나간다 / 금액은 표로 보여줘"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void add(); } }}
              />
              <button type="button" className="btn-primary btn-sm" onClick={() => void add()} disabled={busy || !draft.trim()}>추가</button>
            </div>
            <div className="cpn-list">
              {notes === null ? (
                <div className="cpn-empty">불러오는 중…</div>
              ) : notes.length === 0 ? (
                <div className="cpn-empty">아직 메모가 없습니다. 참모가 틀리게 답하면 답변 아래 &ldquo;이 답변 바로잡기&rdquo;를 누르거나, 대화 중 &ldquo;기억해: …&rdquo;라고 말해 보세요.</div>
              ) : notes.map((n) => (
                <div key={n.id} className="cpn-item">
                  <div className="cpn-item-main">
                    <div className="cpn-item-meta">
                      <span className={`cpn-badge cpn-badge-${n.kind}`}>{KIND_KO[n.kind]}</span>
                      <span className="cpn-item-src">{SOURCE_KO[n.source]} · {n.created_at.slice(0, 10)}</span>
                    </div>
                    <div className="cpn-item-text">{n.content}</div>
                    {n.question && <div className="cpn-item-q">원래 질문: {n.question}</div>}
                  </div>
                  <button type="button" className="btn-ghost btn-sm cpn-del" onClick={() => void remove(n.id)} aria-label="메모 삭제">삭제</button>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

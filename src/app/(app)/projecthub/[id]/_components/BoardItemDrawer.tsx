"use client";

// 행 상세 — 오른쪽에서 열리는 서랍 (2026-08-04 기획 4단계).
//
// 배경: 요청·검수처럼 **요청과 회신이 대화인** 일은 표 한 칸(링크)으로 부족했다.
//   한 줄을 열면 모든 칸을 한 화면에서 채우고, 메모와 파일을 그 줄에 붙인다.
//   칸 편집은 표·칸반과 **같은 Cell** 을 쓴다 — 편집 방식이 화면마다 갈리지 않게.

//   2026-08-10 (사장님 지시) — "메모 남기기가 작은 상태에서 글을 쓰다 보니 불편하다."
//     · 입력칸이 **쓰는 만큼 저절로 늘어난다**(2줄 고정 → 최대 520px). 모서리를 끌어 더 늘릴 수도 있다.
//     · 서랍이 좁아서(448px) 긴 글이 답답했다 → '넓게' 토글을 넣고 고른 값을 기억한다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { resolveSignedUrl } from "@/lib/file-storage";
import type { BoardColumn, BoardItem } from "@/lib/project-boards";
import { growTextarea } from "./BoardMinutes";

const db = supabase as any;
const BUCKET = "documents";
const WIDE_KEY = "pb-drawer-wide";

export type ItemNote = {
  id: string; user_id: string | null; body: string | null;
  file_url: string | null; file_name: string | null; created_at: string;
};

export function BoardItemDrawer({ item, cols, companyId, userId, users, nameLabel, dealId, onClose, onSaveName, renderCell }: {
  item: BoardItem;
  cols: BoardColumn[];
  companyId: string;
  userId?: string;
  users: { id: string; name: string }[];
  nameLabel: string;
  /** @멘션 알림이 이 프로젝트로 돌아오게 하는 데 쓴다 */
  dealId: string;
  onClose: () => void;
  onSaveName: (name: string) => void;
  /** 칸 편집기 — 표·칸반이 쓰는 것을 그대로 받아 쓴다 */
  renderCell: (col: BoardColumn) => React.ReactNode;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  //   파일은 label 로 감싼 숨은 input 이었는데, 모바일·사파리는 display:none 인 input 에 클릭을
  //   넘기지 않아 **눌러도 아무 일이 없었다**(2026-08-06 사장님 제보). 단추가 직접 input 을 연다.
  const fileRef = useRef<HTMLInputElement | null>(null);
  //   @멘션 — 이름을 고르면 본문에 '@이름'이 들어가고, 남기면 그 사람에게 알림이 간다
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [at, setAt] = useState<{ q: string; idx: number } | null>(null);
  //   넓게 보기 — 사람마다 다르게 쓰므로 고른 값을 기억한다(localStorage 는 마운트 뒤에 읽는다)
  const [wide, setWide] = useState(false);
  useEffect(() => { try { setWide(localStorage.getItem(WIDE_KEY) === "1"); } catch { /* 무시 */ } }, []);
  const toggleWide = () => setWide((w) => {
    const next = !w;
    try { localStorage.setItem(WIDE_KEY, next ? "1" : "0"); } catch { /* 무시 */ }
    return next;
  });
  const atList = useMemo(() => {
    if (!at) return [];
    const q = at.q.trim().toLowerCase();
    return users.filter((u) => (u.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [at, users]);

  const { data: notes = [] } = useQuery({
    queryKey: ["pb-notes", item.id],
    queryFn: async () => {
      const data = logRead("BoardItemDrawer:notes", await db.from("project_board_item_notes")
        .select("id, user_id, body, file_url, file_name, created_at")
        .eq("item_id", item.id).order("created_at", { ascending: true }));
      return (data || []) as ItemNote[];
    },
    enabled: !!item.id,
  });

  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name || "";
  const refresh = () => qc.invalidateQueries({ queryKey: ["pb-notes", item.id] });

  // ── @멘션 ── 캐럿 바로 앞이 '@글자' 면 고를 목록을 띄운다
  const AT_RE = /(?:^|\s)@([^\s@]{0,20})$/;
  const onTextChange = (el: HTMLTextAreaElement) => {
    setText(el.value);
    growTextarea(el);
    const m = AT_RE.exec(el.value.slice(0, el.selectionStart ?? el.value.length));
    setAt(m ? { q: m[1], idx: 0 } : null);
  };
  const pickMention = (u: { id: string; name: string }) => {
    const el = taRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const m = AT_RE.exec(text.slice(0, caret));
    if (!m) { setAt(null); return; }
    const start = caret - m[1].length - 1;          // '@' 가 있는 자리
    const next = `${text.slice(0, start)}@${u.name} ${text.slice(caret)}`;
    setText(next);
    setAt(null);
    //   커서를 넣은 이름 뒤로 — 이어서 바로 칠 수 있게
    const pos = start + (u.name || "").length + 2;
    window.requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); growTextarea(el); });
  };

  const addNote = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { error } = await db.from("project_board_item_notes")
        .insert({ company_id: companyId, item_id: item.id, user_id: userId || null, body });
      if (error) throw new Error(error.message);
      setText("");
      setAt(null);
      growTextarea(taRef.current);   // 비운 뒤 높이도 되돌린다(빈 칸이 커다랗게 남지 않게)
      refresh();
      //   멘션 알림 — 메모는 이미 남았으니 알림이 실패해도 되돌리지 않는다(게시판과 같은 규칙).
      //   type 은 notifications 의 enum 안에 있는 'chat' 을 쓴다(새 값 추가 X).
      const hit = users.filter((u) => u.name && body.includes(`@${u.name}`) && u.id !== userId);
      if (hit.length > 0) {
        const who = users.find((u) => u.id === userId)?.name || "누군가";
        const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
        const { error: nErr } = await db.from("notifications").insert(hit.map((u) => ({
          company_id: companyId, user_id: u.id, type: "chat",
          title: "프로젝트 멘션",
          message: `${who} 님이 「${item.name || nameLabel}」에서 회원님을 불렀어요: ${preview}`,
          entity_type: "project_board_item", entity_id: dealId, is_read: false,
        })));
        if (!nErr) toast(`${hit.map((u) => u.name).join(" · ")} 님에게 알렸습니다.`, "success");
      }
    } catch (e: any) {
      toast(e?.message || "메모 저장 실패", "error");
    } finally { setBusy(false); }
  };

  const addFile = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      //   ⚠️ 저장소 키에는 한글을 못 쓴다 — 남겨 뒀더니 'Invalid key' 로 첨부가 통째로 실패했다
      //      (2026-08-06 사장님 제보: '리뷰.PNG'). 보이는 이름은 file_name 에 원본 그대로 남는다.
      //      태스크 첨부(src/lib/task-attachments.ts)와 같은 규칙을 쓴다.
      const safe = (file.name || "file").replace(/[^\w.\-]/g, "_").slice(-120) || "file";
      const path = `board-items/${companyId}/${item.id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await db.from("project_board_item_notes")
        .insert({ company_id: companyId, item_id: item.id, user_id: userId || null, file_url: url, file_name: file.name });
      if (error) throw new Error(error.message);
      refresh();
      toast(`'${file.name}' 을 붙였습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "파일 첨부 실패", "error");
    } finally { setBusy(false); }
  };

  // 붙인 파일 열기 — documents 버킷은 **비공개**라 공개 주소로는 안 열린다("Bucket not found").
  //   눌렀을 때마다 잠깐 쓰는 서명 주소를 새로 받는다. 예전에 붙인 것(공개 주소로 저장된 줄)도
  //   같은 함수가 버킷·경로를 뽑아 살려 준다. 받을 때 이름은 올릴 때 쓴 원본 이름 그대로.
  const openFile = async (n: ItemNote) => {
    const url = await resolveSignedUrl(n.file_url, n.file_name || undefined);
    if (!url) { toast("파일 주소를 만들지 못했어요. 다시 올려 주세요.", "error"); return; }
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const removeNote = async (n: ItemNote) => {
    await db.from("project_board_item_notes").delete().eq("id", n.id);
    refresh();
  };

  return (
    <>
      <div className="pb-drawer-veil" onClick={onClose} />
      <aside className={`pb-drawer ${wide ? "pb-drawer-wide" : ""}`} aria-label={`${nameLabel} 상세`}>
        <header className="pb-drawer-head">
          <input defaultValue={item.name} placeholder={`${nameLabel} 입력`}
            onBlur={(e) => onSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="pb-drawer-name" />
          {/*  긴 글을 쓸 때는 넓게 — 고른 값은 다음에도 그대로 열린다 */}
          <button type="button" className="pb-drawer-widebtn" onClick={toggleWide} aria-pressed={wide}
            title={wide ? "좁게 보기" : "넓게 보기 — 긴 글을 쓸 때"}>↔ {wide ? "좁게" : "넓게"}</button>
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>

        <section className="pb-drawer-fields">
          {cols.map((c) => (
            <div key={c.id} className="pb-drawer-field">
              <label>{c.name}</label>
              <div>{renderCell(c)}</div>
            </div>
          ))}
        </section>

        <section className="pb-drawer-notes">
          <b>메모 · 파일</b>
          {notes.length === 0 && <p className="pb-drawer-empty">아직 없어요. 진행 상황이나 파일을 여기에 남기세요.</p>}
          {notes.map((n) => (
            <div key={n.id} className="pb-note">
              <span className="pb-note-who">{nameOf(n.user_id) || "누군가"}<em>{String(n.created_at).slice(5, 16).replace("T", " ")}</em></span>
              {n.file_url
                ? <button type="button" className="pb-note-file" onClick={() => openFile(n)}>📎 {n.file_name || "첨부파일"}</button>
                : <p className="pb-note-body">{markMentions(n.body || "", users)}</p>}
              <button type="button" onClick={() => removeNote(n)} title="지우기">✕</button>
            </div>
          ))}
        </section>

        <footer className="pb-drawer-foot">
          <textarea ref={taRef} value={text} onChange={(e) => onTextChange(e.currentTarget)} rows={3}
            placeholder="메모 남기기 — @ 로 사람을 부를 수 있어요 (Ctrl+Enter 로 남기기)"
            onKeyDown={(e) => {
              if (at && atList.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setAt({ ...at, idx: (at.idx + 1) % atList.length }); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setAt({ ...at, idx: (at.idx - 1 + atList.length) % atList.length }); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(atList[at.idx]); return; }
                if (e.key === "Escape") { setAt(null); return; }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote();
            }} />
          {/* @멘션 고르기 — 게시판 멘션과 같은 모양(mention-dropdown) 을 쓴다 */}
          {at && atList.length > 0 && (
            <div className="mention-dropdown pb-at-pop">
              <div className="mention-dropdown-header">멘션 — @{at.q}</div>
              {atList.map((u, i) => (
                <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}
                  onMouseEnter={() => setAt({ ...at, idx: i })}
                  className={`mention-dropdown-item ${i === at.idx ? "pb-at-on" : ""}`}>
                  <span className="pb-at-face">{(u.name || "?")[0]}</span>
                  <span className="pb-at-name">{u.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="pb-drawer-actions">
            {/* 단추가 숨은 input 을 직접 연다 — label+display:none 은 모바일에서 안 열렸다 */}
            <button type="button" className="pb-drawer-file" disabled={busy}
              onClick={() => fileRef.current?.click()}>{busy ? "올리는 중…" : "📎 파일"}</button>
            <input ref={fileRef} type="file" className="pb-drawer-fileinput" tabIndex={-1} aria-hidden="true"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) addFile(f); e.target.value = ""; }} />
            <button type="button" className="pb-drawer-send" disabled={busy || !text.trim()} onClick={addNote}>
              {busy ? "저장 중…" : "남기기"}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

/** 남긴 메모에서 '@이름' 을 눈에 띄게 — 누구를 부른 글인지 목록에서 바로 읽힌다.
 *  회사 사람 이름만 표시로 친다(아무 @글자나 파랗게 만들면 오해를 준다). */
function markMentions(body: string, users: { id: string; name: string }[]): ReactNode {
  const names = users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0 || !body.includes("@")) return body;
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(<b key={`${m.index}-${m[1]}`} className="pb-note-at">@{m[1]}</b>);
    last = m.index + m[0].length;
  }
  if (last === 0) return body;
  if (last < body.length) out.push(body.slice(last));
  return out;
}

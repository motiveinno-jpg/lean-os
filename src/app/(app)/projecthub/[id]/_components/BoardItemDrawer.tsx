"use client";

// 행 상세 — 오른쪽에서 열리는 서랍 (2026-08-04 기획 4단계).
//
// 배경: 요청·검수처럼 **요청과 회신이 대화인** 일은 표 한 칸(링크)으로 부족했다.
//   한 줄을 열면 모든 칸을 한 화면에서 채우고, 메모와 파일을 그 줄에 붙인다.
//   칸 편집은 표·칸반과 **같은 Cell** 을 쓴다 — 편집 방식이 화면마다 갈리지 않게.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import type { BoardColumn, BoardItem } from "@/lib/project-boards";

const db = supabase as any;
const BUCKET = "documents";

export type ItemNote = {
  id: string; user_id: string | null; body: string | null;
  file_url: string | null; file_name: string | null; created_at: string;
};

export function BoardItemDrawer({ item, cols, companyId, userId, users, nameLabel, onClose, onSaveName, renderCell }: {
  item: BoardItem;
  cols: BoardColumn[];
  companyId: string;
  userId?: string;
  users: { id: string; name: string }[];
  nameLabel: string;
  onClose: () => void;
  onSaveName: (name: string) => void;
  /** 칸 편집기 — 표·칸반이 쓰는 것을 그대로 받아 쓴다 */
  renderCell: (col: BoardColumn) => React.ReactNode;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

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

  const addNote = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { error } = await db.from("project_board_item_notes")
        .insert({ company_id: companyId, item_id: item.id, user_id: userId || null, body });
      if (error) throw new Error(error.message);
      setText("");
      refresh();
    } catch (e: any) {
      toast(e?.message || "메모 저장 실패", "error");
    } finally { setBusy(false); }
  };

  const addFile = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const safe = file.name.replace(/[^\w.\-가-힣]/g, "_");
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

  const removeNote = async (n: ItemNote) => {
    await db.from("project_board_item_notes").delete().eq("id", n.id);
    refresh();
  };

  return (
    <>
      <div className="pb-drawer-veil" onClick={onClose} />
      <aside className="pb-drawer" aria-label={`${nameLabel} 상세`}>
        <header className="pb-drawer-head">
          <input defaultValue={item.name} placeholder={`${nameLabel} 입력`}
            onBlur={(e) => onSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="pb-drawer-name" />
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
                ? <a href={n.file_url} target="_blank" rel="noopener noreferrer" className="pb-note-file">📎 {n.file_name || "첨부파일"}</a>
                : <p className="pb-note-body">{n.body}</p>}
              <button type="button" onClick={() => removeNote(n)} title="지우기">✕</button>
            </div>
          ))}
        </section>

        <footer className="pb-drawer-foot">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="메모 남기기"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote(); }} />
          <div className="pb-drawer-actions">
            <label className="pb-drawer-file">
              📎 파일
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addFile(f); e.target.value = ""; }} />
            </label>
            <button type="button" className="pb-drawer-send" disabled={busy || !text.trim()} onClick={addNote}>
              {busy ? "저장 중…" : "남기기"}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

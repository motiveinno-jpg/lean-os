"use client";

// ── 상단바 도구 — 계산기 · 화면 캡처 · 메모 (2026-08-27 사장님: "상단바 알림 왼쪽으로 계산기, 화면캡쳐, 메모 아이콘") ──
//   2차(같은 날): "상단 기능들 팝업으로. 메모는 스티커 메모 형식 — 목록도 주고, 여러 개 클릭해서 열 수 있게."
//   · 아이콘을 누르면 아래로 뜨는 판이 아니라 **떠 있는 창**(FloatingWindow) — 끌어서 옮기고, 다른 곳을 눌러도 안 닫힌다.
//   · 메모: '메모 목록' 창(제목·색·핀·검색·새 메모) + 목록에서 누르는 만큼 **스티커 창이 따로** 뜬다. 스티커는 쓰다 멈추면 저장(0.8초).
//     개인 메모(quick_notes 표) — PC 2대 어디서든 같다.
//   · 계산기: 키보드로 다 된다(숫자·+−×÷·괄호·%·Enter·Esc). 결과 클릭 복사. 최근 10줄.
//   · 화면 캡처: 브라우저 화면 공유 API 로 지금 탭을 PNG 내려받기 + 클립보드(외부 라이브러리 없음).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import { FloatingWindow } from "@/components/floating-window";

/* ── 계산 — eval 없이 (숫자 · + − × ÷ · 괄호 · %) ── */
function calc(expr: string): number | null {
  const s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "").replace(/\s+/g, "");
  if (!s || /[^0-9+\-*/().%]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const num = (): number => {
    let j = i; if (s[j] === "-" || s[j] === "+") j++;
    while (j < s.length && /[0-9.]/.test(s[j])) j++;
    const v = Number(s.slice(i, j)); if (Number.isNaN(v) || j === i) throw new Error("bad");
    i = j; return v;
  };
  //   % 는 뒤에 붙는 연산 — 숫자든 괄호든 값 뒤에 오면 ÷100 (예: (300-50)% = 2.5)
  const factor = (): number => {
    let v: number;
    if (peek() === "(") { i++; v = expr3(); if (peek() !== ")") throw new Error("paren"); i++; }
    else if (peek() === "-") { i++; v = -factor(); }
    else if (peek() === "+") { i++; v = factor(); }
    else v = num();
    while (peek() === "%") { i++; v = v / 100; }
    return v;
  };
  const term = (): number => { let v = factor(); while (peek() === "*" || peek() === "/") { const op = s[i++]; const r = factor(); v = op === "*" ? v * r : v / r; } return v; };
  const expr3 = (): number => { let v = term(); while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; } return v; };
  try { const v = expr3(); if (i !== s.length || !Number.isFinite(v)) return null; return v; } catch { return null; }
}
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 6 }));

function Calculator() {
  const { toast } = useToast();
  const [expr, setExpr] = useState("");
  const [hist, setHist] = useState<{ e: string; r: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const result = useMemo(() => calc(expr), [expr]);
  const push = (t: string) => { setExpr((e) => e + t); inputRef.current?.focus(); };
  const equals = () => { if (result == null) return; setHist((h) => [{ e: expr, r: result }, ...h].slice(0, 10)); setExpr(fmt(result).replace(/,/g, "")); };
  const copy = async (v: number) => { try { await navigator.clipboard.writeText(String(v)); toast("복사했습니다", "success"); } catch { /* noop */ } };
  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "%", "+"];
  return (
    <div className="ht-calc">
      <input ref={inputRef} className="ht-calc-in mono-number" value={expr} placeholder="예: 1,250,000 × 1.1"
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); equals(); } else if (e.key === "Escape") { e.stopPropagation(); setExpr(""); } }} />
      <div className={result == null ? "ht-calc-out ht-calc-out-none mono-number" : "ht-calc-out mono-number"} title="누르면 결과 복사" onClick={() => result != null && copy(result)}>
        {result == null ? (expr ? "…" : "0") : `= ${fmt(result)}`}
      </div>
      <div className="ht-calc-keys">
        <button type="button" className="ht-key ht-key-fn" onClick={() => setExpr("")}>C</button>
        <button type="button" className="ht-key ht-key-fn" onClick={() => push("(")}>(</button>
        <button type="button" className="ht-key ht-key-fn" onClick={() => push(")")}>)</button>
        <button type="button" className="ht-key ht-key-fn" onClick={() => setExpr((e) => e.slice(0, -1))}>⌫</button>
        {keys.map((k) => <button key={k} type="button" className={/[0-9.]/.test(k) ? "ht-key" : "ht-key ht-key-op"} onClick={() => push(k === "−" ? "-" : k)}>{k}</button>)}
        <button type="button" className="ht-key ht-key-eq" onClick={equals}>=</button>
      </div>
      {hist.length > 0 && (
        <div className="ht-calc-hist">
          {hist.map((h, i) => <button key={i} type="button" className="ht-calc-hist-row" onClick={() => setExpr(String(h.r))} title="누르면 결과를 이어서 계산"><span className="ev-dim">{h.e}</span><b className="mono-number">= {fmt(h.r)}</b></button>)}
        </div>
      )}
      <p className="ht-hint">키보드로 바로 칩니다 · Enter = 계산 · Esc = 지우기 · 결과를 누르면 복사</p>
    </div>
  );
}

function Capture({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const shoot = async () => {
    if (busy) return;
    const md: any = navigator.mediaDevices;
    if (!md?.getDisplayMedia) { toast("이 브라우저는 화면 캡처를 지원하지 않습니다 — Chrome·Edge 에서 쓰세요", "error"); return; }
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      stream = await md.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
      const stamp = `${todayKst().replace(/-/g, "")}_${new Date().toTimeString().slice(0, 5).replace(":", "")}`;
      const name = `오너뷰_캡처_${stamp}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      let clip = false;
      try { if ((window as any).ClipboardItem && navigator.clipboard?.write) { await navigator.clipboard.write([new (window as any).ClipboardItem({ "image/png": blob })]); clip = true; } } catch { /* 클립보드는 덤 */ }
      setLast(name);
      toast(clip ? `${name} 내려받고 클립보드에도 넣었습니다 — 카톡·메일에 바로 붙여넣기` : `${name} 내려받았습니다`, "success");
      onDone();
    } catch (e: any) {
      if (String(e?.name || "").includes("NotAllowed")) toast("캡처를 취소했습니다", "info");
      else toast(`캡처 실패 — ${e?.message || "알 수 없는 오류"}`, "error");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setBusy(false);
    }
  };
  return (
    <div className="ht-capture">
      <p className="ht-hint">지금 보고 있는 화면을 PNG 로 저장하고 클립보드에도 넣습니다. 브라우저가 <b>어느 화면을 찍을지</b> 한 번 묻습니다 — "이 탭"을 고르세요(브라우저 보안이라 건너뛸 수 없습니다). 이 창은 캡처에 찍히지 않게 잠깐 닫힙니다.</p>
      <button type="button" className="btn-primary btn-sm ht-capture-btn" disabled={busy} onClick={shoot}>{busy ? "찍는 중…" : "이 화면 캡처"}</button>
      {last && <p className="ht-hint">마지막: {last}</p>}
    </div>
  );
}

/* ── 스티커 메모 ── */
type Note = { id: string; title: string | null; body: string; color: string; pinned: boolean; updated_at: string };
export const NOTE_COLORS: { key: string; label: string }[] = [
  { key: "yellow", label: "노랑" }, { key: "green", label: "초록" }, { key: "blue", label: "파랑" }, { key: "pink", label: "분홍" }, { key: "gray", label: "회색" },
];
const when = (iso: string) => { const d = new Date(iso); return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function useNotes() {
  const { user } = useUser();
  const qc = useQueryClient();
  const userId = user?.id ?? null, companyId = user?.company_id ?? null;
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["quick-notes", userId],
    enabled: !!userId,
    queryFn: async () => (logRead("quick-notes:list", await (supabase as any).from("quick_notes").select("id, title, body, color, pinned, updated_at").eq("user_id", userId).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(300)) || []) as Note[],
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["quick-notes", userId] });
  const create = async (color = "yellow"): Promise<Note | null> => {
    if (!userId || !companyId) return null;
    const { data, error } = await (supabase as any).from("quick_notes").insert({ user_id: userId, company_id: companyId, body: "", color }).select("id, title, body, color, pinned, updated_at").single();
    if (error) throw error; refresh(); return data as Note;
  };
  const update = async (id: string, patch: Partial<Pick<Note, "title" | "body" | "color" | "pinned">>) => {
    const { error } = await (supabase as any).from("quick_notes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error; refresh();
  };
  const remove = async (id: string) => { await (supabase as any).from("quick_notes").delete().eq("id", id); refresh(); };
  return { notes, create, update, remove, ready: !!userId };
}

function Sticky({ note, onClose, onDelete, api }: { note: Note; onClose: () => void; onDelete: () => void; api: ReturnType<typeof useNotes> }) {
  const [title, setTitle] = useState(note.title || "");
  const [body, setBody] = useState(note.body);
  const [color, setColor] = useState(note.color);
  const [saved, setSaved] = useState<"idle" | "saving" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  //   쓰다 멈추면 저장(0.8초) — 저장 버튼을 찾을 필요가 없다
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    setSaved("saving");
    timer.current = setTimeout(async () => { try { await api.update(note.id, { title: title.trim() || null, body, color }); setSaved("done"); } catch { setSaved("idle"); } }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [title, body, color]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FloatingWindow title={<input className="sn-title" value={title} placeholder="제목" onChange={(e) => setTitle(e.target.value)} />} onClose={onClose} width={300} className={`sn sn-${color}`}
      initial={{ x: 120 + Math.floor(Math.random() * 240), y: 110 + Math.floor(Math.random() * 160) }}
      headExtra={<span className="sn-colors">{NOTE_COLORS.map((c) => <button key={c.key} type="button" className={`sn-dot sn-dot-${c.key} ${color === c.key ? "sn-dot-on" : ""}`} title={c.label} onClick={() => setColor(c.key)} />)}</span>}>
      <textarea className="sn-body" value={body} autoFocus={!note.body} placeholder="메모…" onChange={(e) => setBody(e.target.value)} />
      <div className="sn-foot">
        <span className="ev-dim">{saved === "saving" ? "저장 중…" : saved === "done" ? "저장됨" : when(note.updated_at)}</span>
        <span className="doc-sums-sp" />
        <button type="button" className="ht-note-act" onClick={() => api.update(note.id, { pinned: !note.pinned })} title={note.pinned ? "핀 해제" : "목록 위에 고정"}>{note.pinned ? "📌" : "📍"}</button>
        <button type="button" className="ht-note-act" onClick={() => navigator.clipboard?.writeText(body)} title="복사">⧉</button>
        <button type="button" className="ht-note-act" onClick={onDelete} title="삭제">🗑</button>
      </div>
    </FloatingWindow>
  );
}

function NoteList({ open, onOpen, onNew }: { open: Set<string>; onOpen: (n: Note) => void; onNew: () => void }) {
  const { notes } = useNotes();
  const [q, setQ] = useState("");
  const shown = notes.filter((n) => !q || (n.title || "").includes(q) || n.body.includes(q));
  return (
    <div className="ht-notes">
      <div className="ht-note-bar">
        <input className="ht-calc-in sn-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·내용 검색" />
        <button type="button" className="btn-primary btn-sm" onClick={onNew}>+ 새 메모</button>
      </div>
      <p className="ht-hint">누르면 스티커로 뜹니다 — 여러 장을 같이 열어 두고 끌어서 옮길 수 있습니다. {notes.length}장 · 핀은 위로</p>
      <div className="sn-list">
        {shown.map((n) => (
          <button key={n.id} type="button" className={`sn-card sn-${n.color} ${open.has(n.id) ? "sn-card-open" : ""}`} onClick={() => onOpen(n)} title={open.has(n.id) ? "열려 있음 — 누르면 맨 위로" : "누르면 스티커로 열기"}>
            <b className="sn-card-title">{n.pinned ? "📌 " : ""}{n.title || (n.body.split("\n")[0].slice(0, 24) || "(빈 메모)")}</b>
            <span className="sn-card-body">{n.body.slice(0, 80)}</span>
            <span className="sn-card-when mono-number">{when(n.updated_at)}</span>
          </button>
        ))}
        {!shown.length && <div className="ht-hint ht-note-empty">{q ? "맞는 메모가 없습니다" : "아직 메모가 없습니다 — + 새 메모"}</div>}
      </div>
    </div>
  );
}

const TOOLS: { key: "calc" | "capture" | "note"; label: string; icon: React.ReactNode }[] = [
  { key: "calc", label: "계산기", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0" /></svg> },
  { key: "capture", label: "화면 캡처", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" /><circle cx="12" cy="12" r="3" /></svg> },
  { key: "note", label: "메모", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg> },
];

export function HeaderTools() {
  const { toast } = useToast();
  const api = useNotes();
  const [calcOpen, setCalcOpen] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [stickies, setStickies] = useState<Note[]>([]);      // 열려 있는 스티커들 — 여러 장
  const openIds = useMemo(() => new Set(stickies.map((n) => n.id)), [stickies]);
  const openSticky = (n: Note) => setStickies((s) => (s.some((x) => x.id === n.id) ? [...s.filter((x) => x.id !== n.id), n] : [...s, n]));
  const closeSticky = (id: string) => setStickies((s) => s.filter((x) => x.id !== id));
  const newSticky = async () => { try { const n = await api.create(); if (n) openSticky(n); } catch (e: any) { toast(e?.message || "메모를 만들지 못했습니다", "error"); } };
  const delSticky = async (id: string) => { await api.remove(id); closeSticky(id); };
  //   목록의 최신 값으로 스티커 머리(핀 상태 등)를 맞춘다
  useEffect(() => { setStickies((s) => s.map((x) => api.notes.find((n) => n.id === x.id) ? { ...x, pinned: api.notes.find((n) => n.id === x.id)!.pinned } : x)); }, [api.notes]);
  const onOf: Record<string, boolean> = { calc: calcOpen, capture: capOpen, note: listOpen || stickies.length > 0 };
  const toggle = (k: "calc" | "capture" | "note") => { if (k === "calc") setCalcOpen((v) => !v); else if (k === "capture") setCapOpen((v) => !v); else setListOpen((v) => !v); };
  return (
    <>
      {TOOLS.map((t) => (
        <button key={t.key} type="button" onClick={() => toggle(t.key)} className={onOf[t.key] ? "notification-bell-btn ht-btn ht-btn-on" : "notification-bell-btn ht-btn"} aria-label={t.label} title={t.label}>
          {t.icon}
          {t.key === "note" && stickies.length > 0 && <span className="ht-cnt">{stickies.length}</span>}
        </button>
      ))}
      {calcOpen && <FloatingWindow title="계산기" onClose={() => setCalcOpen(false)} width={320}><Calculator /></FloatingWindow>}
      {capOpen && <FloatingWindow title="화면 캡처" onClose={() => setCapOpen(false)} width={340}><Capture onDone={() => setCapOpen(false)} /></FloatingWindow>}
      {listOpen && <FloatingWindow title="메모 목록" onClose={() => setListOpen(false)} width={380}><NoteList open={openIds} onOpen={openSticky} onNew={newSticky} /></FloatingWindow>}
      {stickies.map((n) => <Sticky key={n.id} note={n} api={api} onClose={() => closeSticky(n.id)} onDelete={() => delSticky(n.id)} />)}
    </>
  );
}

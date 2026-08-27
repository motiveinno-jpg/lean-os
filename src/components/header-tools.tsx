"use client";

// ── 상단바 도구 — 계산기 · 화면 캡처 · 메모 (2026-08-27 사장님: "상단바 알림 왼쪽으로 계산기, 화면캡쳐, 메모 아이콘") ──
//   알림 벨과 같은 모양(둥근 아이콘 버튼 + 아래로 뜨는 판). 판은 하나만 열린다.
//   · 계산기: 키보드로 다 된다(숫자·+−×÷·괄호·Enter·Esc·Backspace). 결과 복사. 최근 10줄.
//   · 화면 캡처: 브라우저 화면 공유 API 로 지금 탭을 찍어 PNG 로 내려받고 클립보드에도 넣는다 — 외부 라이브러리 없음.
//     (브라우저가 "무엇을 공유할지" 한 번 묻는다 — 그건 브라우저 보안이라 건너뛸 수 없다.)
//   · 메모: 개인 메모(quick_notes, 표) — PC 2대 어디서 열어도 같다. 고정(핀)·삭제, 쓰다 멈추면 저장.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";

type Tool = "calc" | "capture" | "note";

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
  const push = (t: string) => setExpr((e) => e + t);
  const equals = () => { if (result == null) return; setHist((h) => [{ e: expr, r: result }, ...h].slice(0, 10)); setExpr(fmt(result).replace(/,/g, "")); };
  const copy = async (v: number) => { try { await navigator.clipboard.writeText(String(v)); toast("복사했습니다", "success"); } catch { /* noop */ } };
  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "%", "+"];
  return (
    <div className="ht-calc">
      <input ref={inputRef} className="ht-calc-in mono-number" value={expr} placeholder="예: 1,250,000 × 1.1"
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); equals(); } else if (e.key === "Escape") { setExpr(""); } }} />
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
      await new Promise((r) => setTimeout(r, 250));   // 첫 프레임이 들어올 때까지
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
      <p className="ht-hint">지금 보고 있는 화면을 PNG 로 저장하고 클립보드에도 넣습니다. 브라우저가 <b>어느 화면을 찍을지</b> 한 번 묻습니다 — "이 탭"을 고르세요(브라우저 보안이라 건너뛸 수 없습니다).</p>
      <button type="button" className="btn-primary btn-sm ht-capture-btn" disabled={busy} onClick={shoot}>{busy ? "찍는 중…" : "이 화면 캡처"}</button>
      {last && <p className="ht-hint">마지막: {last}</p>}
    </div>
  );
}

type Note = { id: string; body: string; pinned: boolean; updated_at: string };
function Notes() {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id ?? null, companyId = user?.company_id ?? null;
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["quick-notes", userId],
    enabled: !!userId,
    queryFn: async () => (logRead("quick-notes:list", await (supabase as any).from("quick_notes").select("id, body, pinned, updated_at").eq("user_id", userId).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(200)) || []) as Note[],
  });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["quick-notes", userId] });
  const add = async () => {
    const body = draft.trim(); if (!body || !userId || !companyId) return;
    const { error } = await (supabase as any).from("quick_notes").insert({ user_id: userId, company_id: companyId, body });
    if (error) { toast(error.message, "error"); return; }
    setDraft(""); refresh();
  };
  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) { await remove(editing.id); setEditing(null); return; }
    const { error } = await (supabase as any).from("quick_notes").update({ body, updated_at: new Date().toISOString() }).eq("id", editing.id);
    if (error) toast(error.message, "error"); setEditing(null); refresh();
  };
  const pin = async (n: Note) => { await (supabase as any).from("quick_notes").update({ pinned: !n.pinned }).eq("id", n.id); refresh(); };
  const remove = async (id: string) => { await (supabase as any).from("quick_notes").delete().eq("id", id); refresh(); };
  const when = (iso: string) => { const d = new Date(iso); return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  return (
    <div className="ht-notes">
      <textarea className="ht-note-in" rows={3} value={draft} placeholder="메모 — Ctrl+Enter 로 저장. 어느 PC 에서 열어도 같습니다" autoFocus
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); add(); } }} />
      <div className="ht-note-bar"><span className="ht-hint">{notes.length}개 · 핀은 위로</span><span className="doc-sums-sp" /><button type="button" className="btn-primary btn-sm" disabled={!draft.trim()} onClick={add}>저장</button></div>
      <div className="ht-note-list">
        {notes.map((n) => (
          <div key={n.id} className={n.pinned ? "ht-note ht-note-pin" : "ht-note"}>
            {editing?.id === n.id ? (
              <textarea className="ht-note-in" rows={3} value={editing.body} autoFocus onChange={(e) => setEditing({ id: n.id, body: e.target.value })} onBlur={saveEdit}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(null); }} />
            ) : (
              <div className="ht-note-body" onClick={() => setEditing({ id: n.id, body: n.body })} title="누르면 고칩니다">{n.body}</div>
            )}
            <div className="ht-note-foot">
              <span className="ev-dim mono-number">{when(n.updated_at)}</span>
              <span className="doc-sums-sp" />
              <button type="button" className="ht-note-act" onClick={() => pin(n)} title={n.pinned ? "핀 해제" : "위에 고정"}>{n.pinned ? "📌" : "📍"}</button>
              <button type="button" className="ht-note-act" onClick={() => navigator.clipboard?.writeText(n.body).then(() => toast("복사했습니다", "success"))} title="복사">⧉</button>
              <button type="button" className="ht-note-act" onClick={() => remove(n.id)} title="삭제">✕</button>
            </div>
          </div>
        ))}
        {!notes.length && <div className="ht-hint ht-note-empty">아직 메모가 없습니다</div>}
      </div>
    </div>
  );
}

const TOOLS: { key: Tool; label: string; icon: React.ReactNode }[] = [
  { key: "calc", label: "계산기", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0" /></svg> },
  { key: "capture", label: "화면 캡처", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" /><circle cx="12" cy="12" r="3" /></svg> },
  { key: "note", label: "메모", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg> },
];

export function HeaderTools() {
  const [open, setOpen] = useState<Tool | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const toggle = (t: Tool) => {
    if (open === t) { setOpen(null); return; }
    const r = refs.current[t]?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(t);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const cur = TOOLS.find((t) => t.key === open);
  return (
    <>
      {TOOLS.map((t) => (
        <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} type="button" onClick={() => toggle(t.key)}
          className={open === t.key ? "notification-bell-btn ht-btn ht-btn-on" : "notification-bell-btn ht-btn"} aria-label={t.label} title={t.label} aria-expanded={open === t.key}>
          {t.icon}
        </button>
      ))}
      {open && pos && cur && typeof document !== "undefined" && createPortal(
        <div className="notification-panel-backdrop fixed inset-0" onClick={() => setOpen(null)}>
          <div className={`notification-panel glass-card ht-panel ht-panel-${open}`} style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))" }} onClick={(e) => e.stopPropagation()}>
            <div className="notification-panel-header"><b>{cur.label}</b><button type="button" className="inv-modal-x" onClick={() => setOpen(null)} aria-label="닫기">✕</button></div>
            <div className="ht-panel-body">
              {open === "calc" && <Calculator />}
              {open === "capture" && <Capture onDone={() => setOpen(null)} />}
              {open === "note" && <Notes />}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

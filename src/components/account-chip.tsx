"use client";

// 헤더 우측 프로필 칩 — 클릭 시 현재 페이지를 유지한 채 내 계정 상태를 팝오버로 간소하게 보여줌
//   (기존엔 /mypage 로 즉시 이동해버려 지금 보던 화면을 잃었음). "마이페이지로 이동" 버튼으로 이동.
//   2026-09-04 사장님: "내 이름을 눌렀을 때 현재 상태(회의중·자리비움 등)를 설정, 메신저에도 표시" —
//   팝오버 안 '내 상태' 절: 상태 6개 중 하나 + 언제까지 + 한 줄 메모. users 행에 저장(lib/presence.ts), 메신저는 같은 값을 읽는다.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/avatar";
import { useUser } from "@/components/user-context";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { PRESENCE, PRESENCE_UNTIL, effectivePresence, presenceText, untilFromChoice, type PresenceStatus } from "@/lib/presence";
import { PresenceDot } from "@/components/presence-badge";

export function AccountChip() {
  const { user, role, refresh } = useUser();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // (2026-08-03 역할 폐지 반영) 표시는 마스터/멤버/파트너 3종 — 관리자·직원 구분 표기 제거.
  const roleLabel = (user as any)?.is_master ? "마스터" : role === "partner" ? "파트너" : "멤버";

  //   내 상태 — 저장값을 화면 기준(만료 반영)으로 읽는다
  const presence = effectivePresence(user as any);
  const [saving, setSaving] = useState(false);
  const [untilChoice, setUntilChoice] = useState<string>("1h");
  const [note, setNote] = useState<string>("");
  useEffect(() => { setNote(presence.note || ""); }, [presence.note]);

  useEffect(() => { setOpen(false); }, []);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useModalKeys(open, () => setOpen(false), () => { setOpen(false); router.push("/mypage"); });

  //   저장 — 본인 users 행만(RLS auth_id = auth.uid()). 근무중으로 돌리면 메모·해제 시각도 지운다.
  const savePresence = async (status: PresenceStatus, opts?: { until?: string | null; note?: string | null }) => {
    if (!user?.id || saving) return;
    setSaving(true);
    const patch = status === "available"
      ? { presence_status: "available", presence_note: null, presence_until: null, presence_set_at: new Date().toISOString() }
      : { presence_status: status, presence_note: (opts?.note ?? note).trim().slice(0, 30) || null, presence_until: opts?.until === undefined ? untilFromChoice(untilChoice) : opts.until, presence_set_at: new Date().toISOString() };
    const { error } = await (supabase as any).from("users").update(patch).eq("id", user.id);
    setSaving(false);
    if (error) { toast("상태를 저장하지 못했습니다: " + (error.message || ""), "error"); return; }
    await refresh();
    //   메신저 구성원 목록·참가자 목록이 같은 칸을 읽는다 — 바로 갱신
    qc.invalidateQueries({ queryKey: ["company-users"] });
    qc.invalidateQueries({ queryKey: ["chat-participants"] });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="account-chip-button"
        aria-label="내 계정"
        aria-expanded={open}
      >
        <span className="account-chip-avatar-wrap">
          <Avatar name={user?.name || user?.email} src={user?.avatar_url} size={30} />
          <PresenceDot row={user as any} className="account-chip-dot" />
        </span>
        <span className="hidden md:block min-w-0 text-left">
          <span className="block text-xs font-bold text-[var(--text)] leading-4 truncate max-w-[110px]">
            {user?.name || user?.email?.split("@")[0] || ""}
          </span>
          <span className="block text-[10px] text-[var(--text-dim)] leading-3 truncate max-w-[110px]">{presence.status === "available" ? roleLabel : presenceText(presence)}</span>
        </span>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div className="account-chip-popover-overlay fixed inset-0" onClick={() => setOpen(false)}>
          <div
            className="account-chip-popover glass-card"
            style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="account-chip-popover-header">
              <span className="text-sm font-bold text-[var(--text)]">내 계정</span>
              <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none px-1" aria-label="닫기">✕</button>
            </div>

            <div className="account-chip-identity">
              <span className="account-chip-avatar-wrap">
                <Avatar name={user?.name || user?.email} src={user?.avatar_url} size={44} />
                <PresenceDot row={user as any} className="account-chip-dot is-lg" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--text)] truncate">{user?.name || user?.email?.split("@")[0] || ""}</div>
                <div className="text-[11px] text-[var(--text-dim)] truncate">{user?.email}</div>
              </div>
            </div>

            {/* ── 내 상태 (2026-09-04) — 상태 칩 하나 고르면 바로 저장. 근무중이 기본이라 메신저엔 예외 상태만 보인다 ── */}
            <div className="account-chip-presence">
              <div className="account-chip-presence-head">
                <span>내 상태</span>
                {presence.status !== "available" && <span className="account-chip-presence-now"><PresenceDot row={user as any} />{presenceText(presence)}</span>}
              </div>
              <div className="presence-chips">
                {PRESENCE.map((p) => (
                  <button key={p.id} type="button" disabled={saving} title={p.hint}
                    className={`presence-chip ${presence.status === p.id ? "is-on" : ""}`}
                    onClick={() => savePresence(p.id)}>
                    <i className={`presence-dot presence-dot-${p.id}`} />{p.label}
                  </button>
                ))}
              </div>
              <div className="presence-opts">
                <label className="presence-opt">
                  <span>언제까지</span>
                  <select className="presence-select" value={untilChoice} onChange={(e) => { setUntilChoice(e.target.value); if (presence.status !== "available") void savePresence(presence.status, { until: untilFromChoice(e.target.value) }); }}>
                    {PRESENCE_UNTIL.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </label>
                <label className="presence-opt">
                  <span>메모</span>
                  <input className="presence-input" value={note} maxLength={30} placeholder="예: 14시 복귀"
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => { if (presence.status !== "available" && (note.trim() || "") !== (presence.note || "")) void savePresence(presence.status, { note, until: presence.until }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                </label>
              </div>
              <p className="presence-hint">{presence.status === "available" ? "상태를 고르면 위 시간 동안 메신저의 내 이름 옆에 표시됩니다." : "시간이 지나면 자동으로 근무중이 됩니다. '근무중'을 누르면 바로 해제됩니다."}</p>
            </div>

            <div className="account-chip-details">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">역할</span>
                <span className="font-semibold text-[var(--text)]">{roleLabel}</span>
              </div>
              {user?.companies?.name && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-dim)]">회사</span>
                  <span className="font-semibold text-[var(--text)] truncate max-w-[160px]">{user.companies.name}</span>
                </div>
              )}
            </div>

            <div className="account-chip-footer">
              <button
                onClick={() => { setOpen(false); router.push("/mypage"); }}
                className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[var(--primary)] hover:underline"
              >
                마이페이지로 이동 →
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

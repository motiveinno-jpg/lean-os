"use client";

// 헤더 우측 프로필 칩 — 클릭 시 현재 페이지를 유지한 채 내 계정 상태를 팝오버로 간소하게 보여줌
//   (기존엔 /mypage 로 즉시 이동해버려 지금 보던 화면을 잃었음). "마이페이지로 이동" 버튼으로 이동.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { useUser } from "@/components/user-context";
import { useModalKeys } from "@/hooks/use-modal-keys";

const ROLE_LABEL: Record<string, string> = {
  owner: "대표",
  admin: "관리자",
  partner: "파트너",
  employee: "직원",
};

export function AccountChip() {
  const { user, role } = useUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const roleLabel = ROLE_LABEL[role] || "직원";

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

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="account-chip-button flex items-center gap-2 md:pl-2 md:pr-3 md:py-1.5 rounded-full md:bg-[var(--bg-card)] md:border md:border-[var(--border)] hover:opacity-85 transition shrink-0"
        aria-label="내 계정"
        aria-expanded={open}
      >
        <Avatar name={user?.name || user?.email} src={user?.avatar_url} size={30} />
        <span className="hidden md:block min-w-0 text-left">
          <span className="block text-xs font-bold text-[var(--text)] leading-4 truncate max-w-[110px]">
            {user?.name || user?.email?.split("@")[0] || ""}
          </span>
          <span className="block text-[10px] text-[var(--text-dim)] leading-3">{roleLabel}</span>
        </span>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div className="account-chip-popover-overlay fixed inset-0 z-[998]" onClick={() => setOpen(false)}>
          <div
            className="account-chip-popover glass-card fixed z-[999] w-[min(92vw,300px)] animate-[slide-in_0.15s_ease]"
            style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="account-chip-popover-header flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <span className="text-sm font-bold text-[var(--text)]">내 계정</span>
              <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none px-1" aria-label="닫기">✕</button>
            </div>

            <div className="account-chip-identity flex items-center gap-3 px-4 py-4">
              <Avatar name={user?.name || user?.email} src={user?.avatar_url} size={44} />
              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--text)] truncate">{user?.name || user?.email?.split("@")[0] || ""}</div>
                <div className="text-[11px] text-[var(--text-dim)] truncate">{user?.email}</div>
              </div>
            </div>

            <div className="account-chip-details px-4 pb-3 space-y-1.5 text-[12px]">
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

            <div className="account-chip-footer px-4 py-2.5 border-t border-[var(--border)]">
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

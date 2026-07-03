"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

export function AccountTab() {
  const { toast } = useToast();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email);
    });
  }, []);

  function pwStrength(pw: string) {
    if (!pw) return null;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-zA-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 2) return { label: "약함", color: "var(--danger)", w: "33%" };
    if (score <= 3) return { label: "보통", color: "#f59e0b", w: "66%" };
    return { label: "강함", color: "var(--success, #22c55e)", w: "100%" };
  }

  const strength = pwStrength(newPw);

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (newPw.length < 8) return setMsg({ type: "err", text: "비밀번호는 8자 이상이어야 합니다." });
    if (!/[a-zA-Z]/.test(newPw)) return setMsg({ type: "err", text: "영문자를 포함해주세요." });
    if (!/[0-9]/.test(newPw)) return setMsg({ type: "err", text: "숫자를 포함해주세요." });
    if (!/[^A-Za-z0-9]/.test(newPw)) return setMsg({ type: "err", text: "특수기호를 포함해주세요." });
    if (newPw !== confirmPw) return setMsg({ type: "err", text: "새 비밀번호가 일치하지 않습니다." });

    setSaving(true);

    // 현재 비밀번호 검증 (재로그인)
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPw,
    });
    if (signInErr) {
      setSaving(false);
      return setMsg({ type: "err", text: "현재 비밀번호가 올바르지 않습니다." });
    }

    // 새 비밀번호 설정
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setSaving(false);

    if (error) {
      const errMsg = error.message.includes("same_password") || error.message.includes("should be different")
        ? "새 비밀번호는 기존과 달라야 합니다."
        : error.message;
      return setMsg({ type: "err", text: errMsg });
    }

    setMsg({ type: "ok", text: "비밀번호가 변경되었습니다." });
    toast("비밀번호가 변경되었습니다.", "success");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  }

  return (
    <div className="space-y-6">
      {/* 계정 정보 */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="kpi-icon">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM5 21a7 7 0 0114 0" /></svg>
          </span>
          <div>
            <div className="text-sm font-bold text-[var(--text)]">계정 정보</div>
            <div className="text-xs text-[var(--text-muted)]">{userEmail}</div>
          </div>
        </div>
      </div>

      {/* 비밀번호 변경 */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="kpi-icon warning">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M17 11V7a5 5 0 00-10 0v4M6 11h12v9a1 1 0 01-1 1H7a1 1 0 01-1-1z" /></svg>
          </span>
          <div>
            <div className="text-sm font-bold text-[var(--text)]">비밀번호 변경</div>
            <div className="text-xs text-[var(--text-muted)]">영문+숫자+특수기호 조합 8자 이상</div>
          </div>
        </div>

        {msg && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${msg.type === "ok" ? "bg-green-500/10 border border-green-500/20 text-green-600" : "bg-red-500/10 border border-red-500/20 text-red-500"}`}>
            {msg.text}
          </div>
        )}

        <form onSubmit={handleChangePw} className="space-y-4">
          <div>
            <label className="field-label">현재 비밀번호</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="현재 비밀번호를 입력하세요"
              className="field-input"
              required
            />
          </div>
          <div>
            <label className="field-label">새 비밀번호</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="영문+숫자+특수기호 8자 이상"
              className="field-input"
              required
            />
            {strength && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[var(--text-muted)]">비밀번호 강도</span>
                  <span className="text-xs font-semibold" style={{ color: strength.color }}>{strength.label}</span>
                </div>
                <div className="h-1.5 bg-[var(--bg-surface,#f1f5f9)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: strength.w, backgroundColor: strength.color }} />
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="field-label">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="새 비밀번호를 다시 입력하세요"
              className="field-input"
              required
            />
            {confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-red-500 mt-1.5">비밀번호가 일치하지 않습니다</p>
            )}
          </div>
          <button
            type="submit"
            disabled={saving || !currentPw || !newPw || newPw !== confirmPw}
            className="btn-primary w-full"
          >
            {saving ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </div>
    </div>
  );
}

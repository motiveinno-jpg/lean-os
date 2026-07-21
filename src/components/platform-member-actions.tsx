"use client";

// 플랫폼 운영자 — 사용자 계정 지원 액션 패널 (사용자 관리 · 고객사 상세 공용)
//   비밀번호 임시발급/재설정링크 · 이메일 변경 · 역할 변경 · 계정 잠금.
//   모든 조치는 /api/platform/admin-action 을 통해 감사 기록됨.

import { appConfirm } from "@/components/global-confirm";
import { useState } from "react";
import { platformAdminAction, type AdminActionPayload } from "@/lib/platform-admin";

export type PlatformMemberTarget = {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
};

export const PLATFORM_ROLE_META: Record<string, { label: string; cls: string }> = {
  owner: { label: "대표", cls: "bg-[var(--primary-light)] text-[var(--primary)]" },
  admin: { label: "관리자", cls: "bg-[var(--info-dim)] text-[var(--info)]" },
  employee: { label: "직원", cls: "bg-[var(--bg-surface)] text-[var(--text-muted)]" },
  partner: { label: "파트너", cls: "bg-[var(--warning-dim)] text-[var(--warning)]" },
};

export function PlatformMemberActions({ member, onChanged }: { member: PlatformMemberTarget; onChanged?: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async (payload: AdminActionPayload, confirmMsg?: string) => {
    if (confirmMsg && !(await appConfirm(confirmMsg))) return;
    setPending(payload.action);
    setError("");
    try {
      const res = await platformAdminAction(payload);
      if (res.error) { setError(res.error); return; }
      if (res.tempPassword) {
        setResult({ label: "임시 비밀번호 (한 번만 표시 — 고객에게 전달 후 창을 닫으세요)", value: res.tempPassword });
      } else if (res.link) {
        setResult({ label: "재설정 링크 (복사해서 고객에게 전달)", value: res.link });
      } else {
        setResult(null);
      }
      if (payload.action === "change-email" || payload.action === "set-role") {
        setEmailDraft("");
        onChanged?.();
      }
    } finally {
      setPending(null);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard 권한 없음 — 수동 복사 */ }
  };

  return (
    <div className="platform-member-actions-panel">
      {/* 비밀번호 지원 */}
      <div className="platform-admin-action-group">
        <div className="platform-admin-action-group-title">비밀번호 지원</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => run({ action: "reset-password", userId: member.id }, `${member.email} 의 비밀번호를 임시 비밀번호로 즉시 교체합니다. 기존 비밀번호는 무효화됩니다. 진행할까요?`)}
            disabled={pending === "reset-password"}
            className="btn-primary text-xs"
          >
            {pending === "reset-password" ? "발급 중…" : "임시 비밀번호 발급"}
          </button>
          <button
            onClick={() => run({ action: "reset-link", userId: member.id })}
            disabled={pending === "reset-link"}
            className="btn-secondary text-xs"
          >
            {pending === "reset-link" ? "생성 중…" : "재설정 링크 생성"}
          </button>
        </div>
      </div>

      {/* 이메일 변경 */}
      <div className="platform-admin-action-group">
        <div className="platform-admin-action-group-title">이메일 변경</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            placeholder="새 이메일 주소"
            className="field-input max-w-xs"
          />
          <button
            onClick={() => run({ action: "change-email", userId: member.id, newEmail: emailDraft }, `${member.email} → ${emailDraft} 로 로그인 이메일을 변경합니다. 진행할까요?`)}
            disabled={!emailDraft.trim() || pending === "change-email"}
            className="btn-secondary text-xs"
          >
            {pending === "change-email" ? "변경 중…" : "변경"}
          </button>
        </div>
      </div>

      {/* 역할 변경 */}
      <div className="platform-admin-action-group">
        <div className="platform-admin-action-group-title">역할</div>
        <div className="seg-bar">
          {(["owner", "admin", "employee", "partner"] as const).map((r) => (
            <button
              key={r}
              onClick={() => member.role !== r && run({ action: "set-role", userId: member.id, role: r }, `${member.email} 의 역할을 ${PLATFORM_ROLE_META[r].label}(으)로 변경할까요?`)}
              disabled={pending === "set-role"}
              className={`seg-item ${member.role === r ? "seg-item-active" : ""}`}
            >
              {PLATFORM_ROLE_META[r].label}
            </button>
          ))}
        </div>
      </div>

      {/* 계정 잠금 */}
      <div className="platform-admin-action-group">
        <div className="platform-admin-action-group-title">계정 잠금</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => run({ action: "ban", userId: member.id }, `${member.email} 계정을 잠급니다. 로그인이 차단됩니다. 진행할까요?`)}
            disabled={pending === "ban"}
            className="btn-danger text-xs"
          >
            {pending === "ban" ? "잠금 중…" : "로그인 잠금"}
          </button>
          <button
            onClick={() => run({ action: "unban", userId: member.id })}
            disabled={pending === "unban"}
            className="btn-secondary text-xs"
          >
            {pending === "unban" ? "해제 중…" : "잠금 해제"}
          </button>
        </div>
      </div>

      {/* 결과 / 에러 */}
      {result && (
        <div className="platform-admin-result-box">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">{result.label}</div>
          <div className="flex items-center gap-2">
            <code className="platform-admin-result-value">{result.value}</code>
            <button onClick={() => copy(result.value)} className="btn-secondary text-xs shrink-0">
              {copied ? "복사됨 ✓" : "복사"}
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-xs text-[var(--danger)] font-medium">{error}</div>}

      <div className="text-[11px] text-[var(--text-dim)]">모든 조치는 감사로그에 기록됩니다</div>
    </div>
  );
}

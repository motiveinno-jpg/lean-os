"use client";

// 기존 회원 재동의 관문 (2026-07-27).
//   동의 기록이 없거나(기존 회원), 동의한 약관 버전이 개정된 경우 한 번 더 동의를 받는다.
//   기록은 append-only 라 개정 이력이 그대로 쌓인다.
//   조회 실패 시에는 통과시킨다 — 일시적 오류로 사용자를 서비스에서 막지 않는다.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { needsSignupConsent, recordConsent, LEGAL_DOC_VERSIONS } from "@/lib/legal";

export function ConsentGate({ children }: { children: React.ReactNode }) {
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    needsSignupConsent().then((v) => { if (alive) setNeeded(v); });
    return () => { alive = false; };
  }, []);

  // 판정 전에는 화면을 가리지 않는다(깜빡임 방지). 필요 없으면 그대로 통과.
  if (needed !== true) return <>{children}</>;

  const handleAgree = async () => {
    setSaving(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      await recordConsent({ authId: user.id, consentType: "signup" });
      // 기록이 실제로 남았는지 확인한 뒤에만 통과시킨다(조용한 실패 방지).
      const still = await needsSignupConsent();
      if (still) throw new Error("동의 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      setNeeded(false);
    } catch (e: any) {
      setError(e?.message || "동의 저장에 실패했습니다.");
    }
    setSaving(false);
  };

  return (
    <div className="consent-gate-overlay fixed inset-0">
      <div className="consent-gate-panel glass-card animate-count-up">
        <h2 className="text-lg font-bold mb-1.5">약관 동의가 필요합니다</h2>
        <p className="text-sm text-[var(--text-muted)] leading-6 mb-4">
          서비스 이용을 계속하시려면 아래 약관에 동의해 주세요. 이미 이용 중이시더라도
          동의 내역을 확인·보관하기 위해 한 번 확인받고 있습니다.
        </p>

        <div className="consent-gate-docs">
          {([
            ["이용약관", "/terms", LEGAL_DOC_VERSIONS.terms],
            ["개인정보처리방침", "/privacy", LEGAL_DOC_VERSIONS.privacy],
            ["환불규정", "/refund", LEGAL_DOC_VERSIONS.refund],
          ] as const).map(([label, href, version]) => (
            <div key={href} className="flex items-center justify-between gap-3 py-2">
              <Link
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--primary)] hover:underline font-medium"
              >
                {label} 보기
              </Link>
              <span className="text-[11px] text-[var(--text-dim)] mono-number">시행일 {version}</span>
            </div>
          ))}
        </div>

        <label className="consent-gate-check">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-sm leading-6">
            위 이용약관·개인정보처리방침·환불규정을 확인했으며 이에 동의합니다.
            <b className="text-[var(--danger)] ml-1">(필수)</b>
          </span>
        </label>

        {error && <div className="text-xs text-[var(--danger)] mt-2">{error}</div>}

        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => supabase.auth.signOut()}
            className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            로그아웃
          </button>
          <button
            onClick={handleAgree}
            disabled={!agreed || saving}
            className="btn-primary flex-1"
          >
            {saving ? "저장 중..." : "동의하고 계속하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

// 회사 완전 삭제 (2026-08-10 사장님 요청) — 마스터 전용 탭.
//   DataResetTab(데이터 초기화 — 회사·구성원 보존)과 다르다: companies 행까지 지워
//   회사가 오너뷰에서 완전히 사라진다. 구성원 auth 계정은 남아 재로그인 시 회사 설정부터.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";

export function CompanyDeleteTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<"idle" | "confirm" | "processing" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const data = logRead(
        "CompanyDeleteTab:name",
        await supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      );
      setCompanyName((data as { name?: string } | null)?.name ?? "");
    })();
  }, [companyId]);

  // 회사명이 비어 있으면(온보딩 중단 등) '회사 삭제' 문구 입력으로 대체 — RPC 도 같은 규칙.
  const expectedName = companyName.trim() || "회사 삭제";
  const nameMatches = confirmName.trim() !== "" && confirmName.trim() === expectedName;

  async function handleDelete() {
    setStep("processing");
    setError("");
    try {
      const res = await fetch("/api/company/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: confirmName.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "회사 삭제에 실패했습니다.");
        setStep("confirm");
        return;
      }
      setStep("done");
      toast("회사가 삭제되었습니다.", "success");
      // 회사가 사라졌으므로 세션을 정리하고 처음으로 — 남은 화면들이 죽은 company_id 를 조회하지 않게.
      queryClient.clear();
      await supabase.auth.signOut();
      window.location.href = "/auth";
    } catch {
      setError("네트워크 오류로 삭제하지 못했습니다. 다시 시도해주세요.");
      setStep("confirm");
    }
  }

  return (
    <div className="space-y-6">
      <div className="company-delete-banner">
        <div className="flex items-start gap-3">
          <div className="company-delete-banner-icon">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-red-500">회사 삭제 — 되돌릴 수 없습니다</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              회사와 회사에 속한 모든 데이터(거래·직원·근태·급여·계약·결재·문서·채팅 등)가 완전히 삭제되고,
              오너뷰에서 이 회사가 사라집니다. 유료 요금제를 쓰고 있다면 결제 구독도 함께 해지됩니다.
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              구성원의 로그인 계정 자체는 남지만 회사 소속이 사라져, 다시 로그인하면 새 회사 만들기부터 시작하게 됩니다.
              데이터만 비우고 회사는 유지하려면 <b>시스템 &gt; 데이터 관리</b>를 사용하세요.
            </p>
          </div>
        </div>
      </div>

      {step === "idle" && (
        <button type="button" onClick={() => setStep("confirm")} className="company-delete-open-btn">
          회사 삭제 진행
        </button>
      )}

      {(step === "confirm" || step === "processing") && (
        <div className="company-delete-confirm-card">
          <p className="text-sm font-semibold text-[var(--text)]">
            정말 삭제하시려면 회사명 <span className="text-red-500 font-bold">{expectedName}</span> 을(를) 똑같이 입력하세요.
          </p>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={expectedName}
            disabled={step === "processing"}
            className="company-delete-confirm-input"
          />
          <label className="company-delete-agree-row">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={step === "processing"} />
            <span>모든 데이터가 영구 삭제되며 복구할 수 없다는 것을 이해했습니다.</span>
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setStep("idle"); setConfirmName(""); setAgreed(false); setError(""); }}
              disabled={step === "processing"} className="btn-ghost text-xs">
              취소
            </button>
            <button type="button" onClick={handleDelete}
              disabled={!nameMatches || !agreed || step === "processing"}
              className="company-delete-execute-btn">
              {step === "processing" ? "삭제 중… (수십 초 걸릴 수 있습니다)" : "회사를 영구 삭제"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="company-delete-done">회사가 삭제되었습니다. 로그인 화면으로 이동합니다…</div>
      )}
    </div>
  );
}

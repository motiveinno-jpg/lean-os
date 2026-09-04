"use client";

// 샘플 회사 체험 배너 — 가입 직후 샘플 자료를 넣은 회사에만 뜬다.
//   "지금 보는 건 샘플"임을 늘 보이게 하고, 내 통장 연결(설정 > 연동)과 샘플 지우기를 바로 잇는다.
//   실제 금융 연결이 생기면 DB 트리거가 샘플을 치우므로, 여기서는 상태를 읽고 보여 주기만 한다.
//   상태 조회가 실패하면 조용히 안 보인다 — 배너 때문에 화면이 멈추는 일은 없어야 한다.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";

export type SampleStatus = { active: boolean; rows?: number; since?: string | null; allowed?: boolean };

export function useSampleStatus(companyId?: string | null) {
  return useQuery<SampleStatus>({
    queryKey: ["sample-company-status", companyId],
    enabled: !!companyId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("sample_company_status", { p_company: companyId });
      if (error || !data) return { active: false, allowed: false };
      return data as SampleStatus;
    },
  });
}

/** RPC 오류 메시지를 사람 말로 — 함수가 던지는 짧은 코드(SAMPLE_EXISTS 등)를 안내문으로 바꾼다 */
export function sampleErrorText(message: string | undefined): string {
  const m = String(message || "");
  if (m.includes("SAMPLE_EXISTS")) return "이미 샘플 자료가 들어 있어요.";
  if (m.includes("HAS_DATA") || m.includes("CONNECTED")) return "이미 실제 자료가 있는 회사라 샘플을 넣지 않아요.";
  if (m.includes("FEATURE_OFF")) return "지금은 샘플 체험을 쓸 수 없어요. 바로 내 통장을 연결해도 돼요.";
  if (m.includes("FORBIDDEN")) return "회사 관리자(마스터)만 샘플을 넣거나 지울 수 있어요.";
  if (m.includes("NO_SOURCE")) return "샘플 원본이 준비되지 않았어요. 바로 내 통장을 연결해도 돼요.";
  return "샘플을 준비하지 못했어요. 바로 내 통장을 연결해도 돼요.";
}

export function SampleDataBanner({ companyId }: { companyId?: string | null }) {
  const { data } = useSampleStatus(companyId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!companyId || !data?.active) return null;

  const clear = async () => {
    if (!(await appConfirm("샘플 자료를 모두 지울까요? 내 통장을 연결하면 자동으로 지워지니 지금 꼭 지우지 않아도 돼요.", { danger: true }))) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("sample_company_clear", { p_company: companyId });
      if (error) throw error;
      toast("샘플 자료를 지웠어요. 이제 내 자료로 채워 보세요.", "success");
      await qc.invalidateQueries();
    } catch (e: any) {
      toast(sampleErrorText(e?.message), "error");
    } finally { setBusy(false); }
  };

  return (
    <div className="sample-banner" role="status">
      <span className="sample-banner-tag">샘플</span>
      <span className="sample-banner-text">
        지금 보시는 숫자는 <b>샘플 회사</b> 자료예요. 내 통장·카드를 연결하면 샘플은 자동으로 지워지고 내 자료로 바뀝니다.
      </span>
      <span className="sample-banner-actions">
        <Link href="/settings?tab=bank" className="btn-primary btn-sm">내 통장 연결하기</Link>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void clear()}>{busy ? "지우는 중…" : "샘플 지우기"}</button>
      </span>
    </div>
  );
}

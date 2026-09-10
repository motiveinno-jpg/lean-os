"use client";

import { useState } from "react";
import { getSignedUrl } from "@/lib/file-storage";
import { useToast } from "@/components/toast";

/** 발급 이력의 영구 주소를 클릭 시점의 private 다운로드 주소로 바꾼다. */
export function CertificatePdfButton({ url, number }: { url: string | null; number: string }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  if (!url) return <span className="text-xs text-[var(--text-muted)]">보관본 없음</span>;
  const download = async () => {
    setBusy(true);
    try {
      const match = url.match(/\/object\/(?:public|sign|authenticated)\/documents\/([^?]+)/);
      if (!match) throw new Error("증명서 보관 경로를 확인할 수 없습니다.");
      const signed = await getSignedUrl("documents", decodeURIComponent(match[1]), 300, `${number}.pdf`);
      if (!signed) throw new Error("증명서를 열 수 없습니다. 파일 보관 상태와 열람 권한을 확인해 주세요.");
      const a = document.createElement("a");
      a.href = signed;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      toast(error instanceof Error ? error.message : "증명서 다운로드 실패", "error");
    } finally { setBusy(false); }
  };
  return <button type="button" disabled={busy} onClick={download} className="text-xs text-[var(--primary)] hover:underline">{busy ? "불러오는 중…" : "PDF"}</button>;
}

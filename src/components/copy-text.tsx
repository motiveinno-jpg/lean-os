"use client";

// 값 옆에 붙는 복사 단추 — 누르면 클립보드에 넣고 잠깐 "복사됨" 으로 바뀐다.
//   이메일·전화번호처럼 그대로 옮겨 적을 값에 쓴다. 토스트로도 알린다.

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";

export function CopyButton({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); }, [done]);
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast(`${label ? label + " " : ""}복사했습니다.`, "success");
    } catch {
      toast("복사하지 못했습니다. 직접 선택해 복사해 주세요.", "error");
    }
  };
  return (
    <button type="button" onClick={copy} className={`copy-btn ${done ? "is-done" : ""} ${className}`} title={done ? "복사됨" : `${label || "값"} 복사`} aria-label={`${label || "값"} 복사`}>
      {done ? (
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg>
      )}
    </button>
  );
}

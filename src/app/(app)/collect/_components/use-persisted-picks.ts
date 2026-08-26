"use client";

// 수집·전표 줄별 선택(계정과목·거래처·적요·부가세 유형)을 새로고침해도 유지 (2026-08-26 사장님 제보).
//   전표처리 전의 임시 선택이라 DB 가 아니라 기기 로컬(localStorage)에 둔다.
//   행이 전표처리되면 목록에서 사라지지만 저장 항목은 남으므로, 처음 저장된 시점(at)을 기억해
//   30일 지난 항목은 로드 때 버린다(무한 증식 방지). 빈 상태는 저장하지 않는다 —
//   복원 setState 가 반영되기 전 첫 렌더에서 빈 값으로 덮어쓰는 사고 방지.

import { useEffect, useRef } from "react";

const KEEP_MS = 30 * 86400000; // 30일

export function usePersistedPicks<V>(
  storageKey: string | null,
  value: Record<string, V>,
  restore: (saved: Record<string, V>) => void,
) {
  const atRef = useRef<Record<string, number>>({});
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!storageKey || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const { at = {}, data = {} } = JSON.parse(raw) as { at?: Record<string, number>; data?: Record<string, V> };
      const cutoff = Date.now() - KEEP_MS;
      const fresh: Record<string, V> = {};
      for (const [id, v] of Object.entries(data)) {
        if ((at[id] ?? 0) >= cutoff) { fresh[id] = v; atRef.current[id] = at[id] ?? Date.now(); }
      }
      if (Object.keys(fresh).length) restore(fresh);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || !restoredRef.current || Object.keys(value).length === 0) return;
    try {
      const now = Date.now();
      const at: Record<string, number> = {};
      for (const id of Object.keys(value)) at[id] = atRef.current[id] ?? now;
      atRef.current = at;
      localStorage.setItem(storageKey, JSON.stringify({ at, data: value }));
    } catch { /* ignore */ }
  }, [storageKey, value]);
}

"use client";

// 탭 상태를 URL 쿼리(?tab=...)에 동기화하는 훅.
//   useState 로만 두면 하위 라우트(예: 견적서 → /documents)로 이동했다 '뒤로가기' 시
//   페이지가 재마운트되며 탭이 기본값으로 리셋된다. URL 에 남기면 history 복원 시 탭도 복원됨.
//   - useState 드롭인 대체: const [tab, setTab] = useTabParam<TabKey>("overview")
//   - 한 페이지에 탭 상태가 여러 개면 opts.key 로 파라미터 이름을 구분(?tab=, ?sub=).
//   - opts.valid 를 주면 URL 의 잘못된 값은 무시하고 기본값 사용.
import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useTabParam<T extends string>(
  defaultValue: T,
  opts?: { key?: string; valid?: readonly T[] },
): [T, (v: T) => void] {
  const key = opts?.key ?? "tab";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tab, setTabState] = useState<T>(() => {
    const raw = searchParams?.get(key) as T | null;
    if (raw && (!opts?.valid || opts.valid.includes(raw))) return raw;
    return defaultValue;
  });

  const setTab = useCallback(
    (v: T) => {
      setTabState(v);
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set(key, v);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, key],
  );

  return [tab, setTab];
}

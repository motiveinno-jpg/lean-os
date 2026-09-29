"use client";

// 탭 상태를 URL 쿼리(?tab=...)에 동기화하는 훅.
//   useState 로만 두면 하위 라우트(예: 견적서 → /documents)로 이동했다 '뒤로가기' 시
//   페이지가 재마운트되며 탭이 기본값으로 리셋된다. URL 에 남기면 history 복원 시 탭도 복원됨.
//   - useState 드롭인 대체: const [tab, setTab] = useTabParam<TabKey>("overview")
//   - 한 페이지에 탭 상태가 여러 개면 opts.key 로 파라미터 이름을 구분(?tab=, ?sub=).
//   - opts.valid 를 주면 URL 의 잘못된 값은 무시하고 기본값 사용.
import { useCallback, useEffect, useRef, useState } from "react";
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

  //   주소의 탭이 바뀌면(같은 화면으로 ?tab= 링크를 눌렀거나, 옛 주소에서 넘어왔거나) 따라간다
  useUrlTabSync(opts?.valid ?? null, setTabState, key);

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

/** 주소의 ?tab= 값이 바뀔 때마다 화면 탭에 반영한다.
 *  useState(() => window.location…) 로 처음 뜰 때 한 번만 읽으면 두 경우에 탭이 안 열린다 —
 *  ① 옛 주소 리다이렉트(router.replace)는 새 화면이 먼저 그려지고 주소가 나중에 바뀐다
 *  ② 이미 그 화면에 있을 때 ?tab= 링크를 누르면 화면이 다시 뜨지 않는다.
 *  valid 에 없는 값은 무시한다. 탭을 눌러 바꾼 뒤 주소가 그대로면 되돌리지 않는다(값이 바뀔 때만 반영).
 *  ⚠️ useSearchParams 를 쓰므로 부르는 화면은 <Suspense> 안에 있어야 한다(정적 빌드 규칙). */
export function useUrlTabSync<T extends string>(
  valid: readonly T[] | null,
  apply: (v: T) => void,
  key = "tab",
) {
  const raw = useSearchParams()?.get(key) ?? null;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const validRef = useRef(valid);
  validRef.current = valid;
  useEffect(() => {
    if (!raw) return;
    if (validRef.current && !validRef.current.includes(raw as T)) return;
    applyRef.current(raw as T);
  }, [raw]);
}

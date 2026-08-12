"use client";

// 표 머리단 정렬 — 모든 표가 **같은 모양**으로 정렬되게 (2026-08-12 사장님 지시)
//
//   지시: "제목에 정렬기준 넣어주고 항상 제목(머리)단은 가운데 위치하게. 다른메뉴 다 동일"
//
//   그전엔 방식이 두 갈래였다 — 현금영수증은 헤더 클릭(▲▼↕), 매입매출전표는 작은 버튼(▲▼).
//   같은 일을 두 벌로 두면 한쪽만 고쳐진다. 여기 하나로 모으고 화면들이 이걸 쓴다.
//
//   ★ **머리단은 언제나 가운데**, 몸통 칸은 제 정렬을 지킨다(금액은 오른쪽, 이름은 왼쪽).
//     머리를 값에 맞춰 좌우로 흩으면 훑을 때 눈이 걸린다 — 사장님이 짚은 부분이다.

import type { ReactNode } from "react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** 다음 정렬 상태 — 같은 칸을 다시 누르면 방향만 뒤집는다 */
export function nextSort<K extends string>(cur: SortState<K>, key: K, firstDir: SortDir = "asc"): SortState<K> {
  return cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir };
}

/** 두 값 비교 — 문자는 한글 사전순, 숫자는 크기순. 빈 값은 늘 뒤로 보낸다. */
export function cmp(a: unknown, b: unknown): number {
  const na = a === null || a === undefined || a === "";
  const nb = b === null || b === undefined || b === "";
  if (na && nb) return 0;
  if (na) return 1;          // 빈 값은 방향과 무관하게 뒤 — 위에 몰리면 목록이 쓸모없어진다
  if (nb) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ko");
}

export function SortableTh<K extends string>({
  label, sortKey, sort, onSort, style, title,
}: {
  label: ReactNode;
  /** 이 칸의 정렬 열쇠. 없으면 정렬 못 하는 칸(선택칸 등) */
  sortKey?: K;
  sort?: SortState<K>;
  onSort?: (key: K) => void;
  style?: React.CSSProperties;
  title?: string;
}) {
  const on = !!sortKey && sort?.key === sortKey;
  if (!sortKey || !onSort) return <th style={style} className="th-c">{label}</th>;
  return (
    <th style={style} className="th-c th-sort" onClick={() => onSort(sortKey)} title={title ?? "눌러서 정렬"}>
      <span className="th-sort-in">
        {label}
        <em className={on ? "th-mark th-mark-on" : "th-mark"}>{on ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</em>
      </span>
    </th>
  );
}

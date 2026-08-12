// 표를 엑셀로 내보내는 공통 함수 (2026-08-12 UI 정리 2차수)
//
//   화면마다 제각각 CSV 를 만들고 있었다 — 매입매출전표는 자기 안에, 두존 내보내기는 또 따로.
//   그때마다 같은 두 가지를 틀리기 쉬워서 한 곳으로 모은다.
//
//   ⚠️ ① **BOM(﻿)을 앞에 붙인다** — 없으면 엑셀이 UTF-8 로 안 읽어 한글이 전부 깨진다.
//     ② 값은 **항상 따옴표로 감싸고** 안의 따옴표는 두 번 쓴다 — 쉼표·줄바꿈이 든 적요·상호가
//        칸을 밀어 표가 통째로 어긋나는 사고를 막는다(거래처명에 쉼표가 흔하다).

/** 한 줄 = 한 행. 숫자는 서식 없는 그대로(엑셀이 숫자로 읽게), 날짜는 YYYY-MM-DD 문자열. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 파일명 꼬리 — 조회기간을 붙여 어느 기간을 뽑은 건지 파일만 봐도 알게 한다 */
export function rangeSuffix(from?: string, to?: string): string {
  if (!from && !to) return "전체기간";
  if (from && to) return from === to ? from : `${from}_${to}`;
  return from || to || "";
}

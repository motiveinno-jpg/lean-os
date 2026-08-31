//   구성원 정렬 규칙 (2026-08-27 사장님) — 사번 있는 사람이 사번 순으로 먼저, 사번 없으면 이름 가나다 → 영문 ABC 순.
//   사번은 숫자를 숫자답게 비교한다("A-2" < "A-10"). 이름은 한글이 먼저, 그다음 영문, 그 밖은 마지막.
export type SortablePerson = { name?: string | null; employee_number?: string | null };
const numAware = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
const nameGroup = (n: string) => (/^[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(n) ? 0 : /^[A-Za-z]/.test(n) ? 1 : 2);
export function comparePeople(a: SortablePerson, b: SortablePerson): number {
  const an = (a.employee_number || "").trim(), bn = (b.employee_number || "").trim();
  if (an && bn) { const c = numAware(an, bn); if (c !== 0) return c; }
  else if (an) return -1;
  else if (bn) return 1;
  return compareByName(a, b);
}

//   ★ 이름 정렬 전용 — 사번을 보지 않고 **이름 가나다 → 영문 ABC** 로만 정렬한다 (2026-08-31 사장님).
//     "이름" 열/정렬을 눌렀는데 사번 순으로 나오던 문제를 고친다. 동명이인만 사번으로 안정 정렬.
export function compareByName(a: SortablePerson, b: SortablePerson): number {
  const x = (a.name || "").trim(), y = (b.name || "").trim();
  const g = nameGroup(x) - nameGroup(y); if (g !== 0) return g;
  const c = nameGroup(x) === 1 ? x.localeCompare(y, "en", { sensitivity: "base" }) : x.localeCompare(y, "ko");
  if (c !== 0) return c;
  return numAware((a.employee_number || "").trim(), (b.employee_number || "").trim());
}

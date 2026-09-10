//   직책 정렬 규칙 (2026-09-10 사장님) — 구성원 디렉토리의 '직책' 열은 가나다가 아니라 **직책급 순**으로 선다.
//     가나다로 세우면 과장·대리·대표·부장·사원·주임… 순서라 조직도를 읽을 수 없었다.
//   무엇을 기준으로 판단하는가 (기획 규칙):
//     ① 표준 직책 사다리(아래 POSITION_LADDER)에 걸리면 그 자리. 이름이 길게 걸리는 쪽이 이긴다
//        ("대표이사"는 '이사'가 아니라 '대표이사', "영업본부장"은 '본부장").
//     ② 사다리에 없고 회사가 설정에 넣어 둔 직책 목록(company_settings.settings.position_options)에
//        있으면 그 목록 순서. 회사가 만든 직책(CTO·PM 등)은 회사가 정한 차례를 따른다.
//     ③ 둘 다 모르면 가나다. ④ 직책이 비어 있으면 맨 뒤.
//   오름차순(▲)이 높은 직책부터다 — 조직도는 위가 높다.

//   높은 직책 → 낮은 직책. 같은 이름이 여러 회사에서 다른 급일 수 있으나(예: 실장),
//   국내 일반 기업의 통상 서열을 따른다. 회사가 다르게 쓰면 ②의 회사 목록으로 덮는다.
export const POSITION_LADDER: string[] = [
  "회장", "부회장", "대표이사", "대표", "사장", "부사장", "전무", "상무", "이사",
  "본부장", "실장", "센터장", "소장", "지점장", "부장", "수석", "팀장", "파트장",
  "차장", "책임", "과장", "대리", "선임", "주임", "사원", "인턴", "수습",
];

type Rank = { tier: number; idx: number; label: string };

export function positionRank(raw: string | null | undefined, companyOptions?: string[] | null): Rank {
  const v = String(raw ?? "").trim();
  if (!v || v === "—") return { tier: 4, idx: 0, label: "" };
  //   ① 표준 사다리 — 가장 긴 이름으로 맞춘다("대표이사"가 "대표"·"이사"보다 먼저 잡히게)
  let best = -1, bestLen = 0;
  POSITION_LADDER.forEach((p, i) => {
    if (v.includes(p) && p.length > bestLen) { best = i; bestLen = p.length; }
  });
  if (best >= 0) return { tier: 1, idx: best, label: v };
  //   ② 회사가 정한 직책 목록의 순서
  const oi = companyOptions?.indexOf(v) ?? -1;
  if (oi >= 0) return { tier: 2, idx: oi, label: v };
  //   ③ 모르는 직책
  return { tier: 3, idx: 0, label: v };
}

export function comparePosition(
  a: string | null | undefined,
  b: string | null | undefined,
  companyOptions?: string[] | null,
): number {
  const ra = positionRank(a, companyOptions), rb = positionRank(b, companyOptions);
  if (ra.tier !== rb.tier) return ra.tier - rb.tier;
  if (ra.idx !== rb.idx) return ra.idx - rb.idx;
  return ra.label.localeCompare(rb.label, "ko");
}

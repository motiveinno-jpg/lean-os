// 표준 계정과목 세트 (일반기업회계 기준 흔한 계정) (2026-07-02)
//   기존 시드 11개(101·108·135·136·251·255·401·901·501·831·980)는 코드·명 동일하게 포함
//   (전표 엔진 generate_voucher_drafts 가 코드로 조회 → 보존 필수). 나머지는 코드 충돌 없이 추가.
//   회사설정 > 계정과목 관리의 "표준 계정과목 채우기" + 마이그레이션 시드가 이 목록을 사용.

import type { AccountType } from "@/lib/ledger";

export interface StandardAccount { code: string; name: string; type: AccountType }

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "자산", liability: "부채", equity: "자본", revenue: "수익", expense: "비용",
};
export const ACCOUNT_TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

export const STANDARD_ACCOUNTS: StandardAccount[] = [
  // ── 자산 ──
  { code: "100", name: "현금", type: "asset" },
  { code: "101", name: "보통예금", type: "asset" },       // 기존
  { code: "102", name: "당좌예금", type: "asset" },
  { code: "104", name: "정기예금", type: "asset" },
  { code: "105", name: "정기적금", type: "asset" },
  { code: "106", name: "단기매매증권", type: "asset" },
  { code: "108", name: "외상매출금", type: "asset" },     // 기존
  { code: "109", name: "대손충당금", type: "asset" },
  { code: "110", name: "받을어음", type: "asset" },
  { code: "114", name: "단기대여금", type: "asset" },
  { code: "116", name: "미수금", type: "asset" },
  { code: "120", name: "미수수익", type: "asset" },
  { code: "122", name: "선급금", type: "asset" },
  { code: "124", name: "선급비용", type: "asset" },
  { code: "135", name: "부가세대급금", type: "asset" },   // 기존
  { code: "136", name: "선납세금", type: "asset" },       // 기존
  { code: "138", name: "가지급금", type: "asset" },
  { code: "141", name: "현금과부족", type: "asset" },
  { code: "146", name: "상품", type: "asset" },
  { code: "147", name: "제품", type: "asset" },
  { code: "150", name: "원재료", type: "asset" },
  { code: "153", name: "재공품", type: "asset" },
  { code: "179", name: "장기대여금", type: "asset" },
  { code: "201", name: "토지", type: "asset" },
  { code: "202", name: "건물", type: "asset" },
  { code: "203", name: "건물감가상각누계액", type: "asset" },
  { code: "206", name: "기계장치", type: "asset" },
  { code: "207", name: "기계장치감가상각누계액", type: "asset" },
  { code: "208", name: "차량운반구", type: "asset" },
  { code: "209", name: "차량운반구감가상각누계액", type: "asset" },
  { code: "212", name: "비품", type: "asset" },
  { code: "213", name: "비품감가상각누계액", type: "asset" },
  { code: "226", name: "개발비", type: "asset" },
  { code: "227", name: "소프트웨어", type: "asset" },
  { code: "232", name: "특허권", type: "asset" },
  { code: "240", name: "임차보증금", type: "asset" },
  // ── 부채 ──
  { code: "251", name: "외상매입금", type: "liability" }, // 기존
  { code: "252", name: "지급어음", type: "liability" },
  { code: "253", name: "미지급금", type: "liability" },
  { code: "254", name: "예수금", type: "liability" },
  { code: "255", name: "부가세예수금", type: "liability" }, // 기존
  { code: "257", name: "가수금", type: "liability" },
  { code: "259", name: "선수금", type: "liability" },
  { code: "260", name: "단기차입금", type: "liability" },
  { code: "261", name: "미지급비용", type: "liability" },
  { code: "263", name: "선수수익", type: "liability" },
  { code: "265", name: "미지급세금", type: "liability" },
  { code: "293", name: "장기차입금", type: "liability" },
  { code: "294", name: "임대보증금", type: "liability" },
  { code: "295", name: "퇴직급여충당부채", type: "liability" },
  // ── 자본 ──
  { code: "331", name: "자본금", type: "equity" },
  { code: "335", name: "자본잉여금", type: "equity" },
  { code: "341", name: "주식발행초과금", type: "equity" },
  { code: "351", name: "이익준비금", type: "equity" },
  { code: "375", name: "이월이익잉여금", type: "equity" },
  { code: "377", name: "미처분이익잉여금", type: "equity" },
  // ── 수익 ──
  { code: "401", name: "매출", type: "revenue" },          // 기존
  { code: "404", name: "제품매출", type: "revenue" },
  { code: "901", name: "잡이익", type: "revenue" },        // 기존
  { code: "902", name: "이자수익", type: "revenue" },
  { code: "903", name: "배당금수익", type: "revenue" },
  { code: "904", name: "임대료수익", type: "revenue" },
  { code: "905", name: "수수료수익", type: "revenue" },
  { code: "906", name: "외환차익", type: "revenue" },
  { code: "910", name: "유형자산처분이익", type: "revenue" },
  // ── 비용 ──
  { code: "451", name: "매출원가", type: "expense" },
  { code: "501", name: "매입", type: "expense" },          // 기존
  { code: "801", name: "급여", type: "expense" },
  { code: "802", name: "상여금", type: "expense" },
  { code: "806", name: "퇴직급여", type: "expense" },
  { code: "811", name: "복리후생비", type: "expense" },
  { code: "812", name: "여비교통비", type: "expense" },
  { code: "813", name: "접대비", type: "expense" },
  { code: "814", name: "통신비", type: "expense" },
  { code: "815", name: "수도광열비", type: "expense" },
  { code: "817", name: "세금과공과", type: "expense" },
  { code: "818", name: "감가상각비", type: "expense" },
  { code: "819", name: "임차료", type: "expense" },
  { code: "820", name: "수선비", type: "expense" },
  { code: "821", name: "보험료", type: "expense" },
  { code: "822", name: "차량유지비", type: "expense" },
  { code: "824", name: "운반비", type: "expense" },
  { code: "825", name: "교육훈련비", type: "expense" },
  { code: "826", name: "도서인쇄비", type: "expense" },
  { code: "830", name: "소모품비", type: "expense" },
  { code: "831", name: "지급수수료", type: "expense" },    // 기존
  { code: "833", name: "광고선전비", type: "expense" },
  { code: "835", name: "대손상각비", type: "expense" },
  { code: "848", name: "잡비", type: "expense" },
  { code: "931", name: "이자비용", type: "expense" },
  { code: "932", name: "외환차손", type: "expense" },
  { code: "933", name: "기부금", type: "expense" },
  { code: "951", name: "유형자산처분손실", type: "expense" },
  { code: "980", name: "잡손실", type: "expense" },        // 기존
  { code: "998", name: "법인세비용", type: "expense" },
];

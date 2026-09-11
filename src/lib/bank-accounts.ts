//   통장이 '연동'인지 '직접 등록'인지 가르는 규칙 한 곳 (2026-09-11 사장님 제보).
//   왜 한곳으로 모으나 — 화면마다 source 를 직접 비교하다 보니, 은행연동 탭은 갈래를 나누지 않은
//   전체 목록을 받아 '직접 등록한 통장' 칸에 연동 통장 8개를 그대로 세고 있었다(모티브). 규칙이
//   흩어져 있으면 한 화면만 빠뜨려도 같은 일이 다시 난다. 이름(라벨)도 여기서 정한다 —
//   같은 것을 화면마다 '미연동 통장'·'직접 적어 넣은 통장'으로 달리 불러 무엇이 다른지 알기 어려웠다.
import type { BankAccount } from "@/types/models";

/** 자동 수집으로 만들어진 통장의 source 값. bank_accounts.source 는 not null 이고 기본값이 'manual'. */
export const AUTO_BANK_SOURCE = "codef";

/** 은행에서 잔고·거래내역을 자동으로 가져오는 통장인가. */
export function isAutoBankAccount(a: Pick<BankAccount, "source"> | null | undefined): boolean {
  return a?.source === AUTO_BANK_SOURCE;
}

/** 연동 통장과 직접 등록한 통장으로 가른다. 화면은 이 함수만 쓴다(직접 filter 금지). */
export function splitBankAccounts<T extends Pick<BankAccount, "source">>(list: T[]): { auto: T[]; manual: T[] } {
  const auto: T[] = [], manual: T[] = [];
  for (const a of list || []) (isAutoBankAccount(a) ? auto : manual).push(a);
  return { auto, manual };
}

/** 잔고 합계 — 두 갈래의 합을 같은 방식으로 낸다. */
export function sumBankBalance(list: Pick<BankAccount, "balance">[]): number {
  return (list || []).reduce((s, a) => s + Number(a.balance || 0), 0);
}

/**  화면에 적는 이름. 한 개념에 한 이름 — 여기를 고치면 설정의 두 탭이 같이 바뀐다. */
export const BANK_GROUP_LABEL = {
  auto: "연동 통장",
  /**   '직접 적어 넣은 통장'(2026-09-11 사장님: "이름이 이상하다")·'미연동 통장'을 이 이름으로 통일 */
  manual: "직접 등록한 통장",
} as const;

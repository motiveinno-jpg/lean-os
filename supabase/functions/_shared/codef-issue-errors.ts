//   세금계산서 발행(CODEF·팝빌) 실패 판정 — hometax-issue · issue-request-public 이 같은 기준을 쓴다.
//
//   CF-05001 은 "API 요청 처리중 오류" 라는 뭉뚱그린 코드라 원인은 result.extraMessage 에 있다.
//   CF-05001 인데 실제로는 팝빌이 발행한 일이 있어(같은 건 재시도 5회 → 실발행 5건) 재발행을 막는데,
//   팝빌이 제출 전에 거절한 것(검증 반려·인증서 문제)은 발행될 수가 없으므로 막지 않는다.

//   팝빌이 서명·제출 전에 거절한 것 — 발행됐을 가능성이 없다
//   · 검증 반려: 세액 불일치·필수항목·형식 ([-1100xxxx])
//   · 인증서: 만료([-10004003] 인증서가 만료되었습니다) — 인증서로 서명을 못 하면 국세청에 갈 수 없다
export function isPreSubmitRejection(extra: string): boolean {
  return /동일하지\s*않|필수|형식|올바르지|유효하지|누락|\[-1100/.test(extra) || isCertExpired(extra);
}

export function isCertExpired(extra: string): boolean {
  return /\[-10004003\]|인증서가\s*만료/.test(extra);
}

//   extraMessage 로 원인이 분명한 경우의 안내 — 없으면 null(코드별 기본 안내를 쓴다)
export function issueHintFromExtra(extra: string): string | null {
  if (isCertExpired(extra)) {
    return "팝빌에 등록된 공동인증서가 만료됐습니다. 인증서를 갱신했다면 새 인증서를 다시 등록해야 합니다 — " +
      "'① 발행 등록 (회원가입+인증서)'에서 새 인증서를 등록한 뒤 다시 발행하세요. 이 건은 발행되지 않았으니 다시 보내도 중복되지 않습니다.";
  }
  return null;
}

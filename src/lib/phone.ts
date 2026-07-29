// 휴대전화번호 정규화·검증 공용 유틸 (2026-07-29).
//   카카오 알림톡은 숫자만 받으므로(하이픈 불가), 저장은 하이픈 포함 표시형으로 하되
//   발송 직전 digits() 로 변환한다. 입력 화면이 여러 곳(회원가입·직원초대·직원상세)이라
//   같은 규칙이 흩어지지 않도록 한 곳에 모은다.

/** 숫자만 남긴다 (알림톡 API 전달용) */
export function phoneDigits(v?: string | null): string {
  return (v || "").replace(/\D/g, "");
}

/**
 * 휴대폰 번호 유효성 — 010/011/016/017/018/019 로 시작하는 10~11자리.
 * 빈 값은 "유효하지 않음"이 아니라 "미입력"이므로 호출측이 필수 여부를 판단한다.
 */
export function isValidMobile(v?: string | null): boolean {
  const d = phoneDigits(v);
  return /^01[016789]\d{7,8}$/.test(d);
}

/** 표시·저장용 하이픈 포맷. 입력 중에도 자연스럽게 끊기도록 부분 입력도 처리. */
export function formatPhone(v?: string | null): string {
  const d = phoneDigits(v).slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  // 010-1234-5678 (11자리) / 011-123-4567 (10자리)
  return d.length === 10
    ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
    : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

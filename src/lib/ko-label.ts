// 내부 코드값(영문 enum·스네이크)이 화면에 그대로 새는 것 방지 (2026-09-02 사장님 "이런류 싹 다")
//   라벨 맵에 없는 값의 폴백: 한글이 섞여 있으면(사용자가 지은 이름) 그대로, 아니면 '기타'.
//   알림 종류에서 payment_due 가 영어로 떴던 것과 같은 부류를 전 화면에서 막는 공용 폴백.
export const koFallback = (v: unknown, alt = "기타"): string => {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  return /[가-힣]/.test(s) ? s : alt;
};

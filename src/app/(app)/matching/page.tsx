// /matching 라우트 폐지 → /partners/reconciliation(매칭허브) 통일 (2026-06-25).
//   입금 자동매칭·3-Way 매칭 기능은 매칭허브로 이전 완료. 옛 북마크·딥링크 안전망용 서버 리다이렉트.
import { redirect } from "next/navigation";

export default function MatchingRedirect() {
  redirect("/partners/reconciliation");
}

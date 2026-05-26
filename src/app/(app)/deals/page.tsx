// /deals 라우트 폐지 → /projects 통일 (2026-05-26, 사장님 요청 "그냥 없애").
//   옛 북마크·알림·딥링크 안전망: 서버 리다이렉트. ?id= / ?detail= → /projects/<id>.
//   프로그램 뷰(ProgramDashboard)는 진입로 폐지 — programs 테이블·deals.program_id 데이터는 보존(유실 0).
//   칸반/상세/캘린더 기능은 /projects(칸반) + /projects/[id](상세)가 대체.
import { redirect } from "next/navigation";

export default async function DealsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; detail?: string; program?: string }>;
}) {
  const sp = await searchParams;
  const target = sp.id || sp.detail;
  redirect(target ? `/projects/${target}` : "/projects");
}

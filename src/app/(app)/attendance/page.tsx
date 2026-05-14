import { redirect } from "next/navigation";

// 근태 관리 — 직원 페이지의 근태 탭으로 이동
export default function AttendancePage() {
  redirect("/employees?tab=attendance");
}

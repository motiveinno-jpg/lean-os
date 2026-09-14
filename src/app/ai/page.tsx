// `/ai` — 2026-09-14 부터 **메인 AI 구간(`/#ai`)으로 영구(308) 넘긴다** (랜딩 v8 이관 4단계, 사장님 결정 233).
//   옛 AI 자동화 페이지(07-27)의 7가지는 메인 §6 「AI와 자동 대조가 먼저 해 두는 일」로 옮겼다(landing-v8/content.ts AI_TASKS).
//   「4개 엔진」 묶음은 옮기지 않았다 — 자동화를 묶은 이름일 뿐이고 옛 보험 요율·"CFO 대체" 문구가 남아 있었다.
//   색인·공유된 링크가 있어 라우트는 남긴다 — 지우면 404 가 된다(/landing-v7 과 같은 방식). middleware PUBLIC_ROUTES 의 '/ai' 도 그래서 둔다.
import { permanentRedirect } from "next/navigation";

export default function AiPage(): never {
  permanentRedirect("/#ai");
}

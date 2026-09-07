// `/landing-v7` — 2026-09-07 부터 **`/` 로 영구(308) 넘긴다.**
//   v7 이 정식 랜딩이 되었으므로(사장님 지시), 같은 화면이 두 주소로 뜨면 검색엔진에 중복 문서가 된다.
//   시안 기간에 공유된 링크가 있어 라우트 자체는 남겨 둔다 — 지우면 그 링크가 404 가 된다.
//   화면·문구는 `src/app/page.tsx` 와 `src/components/landing-v7/**` 에 있다.
import { permanentRedirect } from "next/navigation";

export default function LandingV7Page(): never {
  permanentRedirect("/");
}

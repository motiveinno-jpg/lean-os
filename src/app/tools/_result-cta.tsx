// 계산기 결과 바로 아래 맥락 가입 유도 (2026-09-15, 랜딩 후속 ⑥)
//   왜: 계산기 방문 86·계산 22(30일)인데 가입 버튼은 페이지 맨 아래 한 곳뿐이었다 — 결과를 본 그 자리에서
//       「이 계산을 오너뷰가 매달 대신 한다」를 보여 줘야 이어진다.
//   ▸ 문구는 앱에 실제로 있는 기능만 적는다(없는 자동화를 약속하지 않는다 — 주휴수당 자동 계산은 없음).
//   ▸ 버튼 이름은 data-cta="signup:tool_<도구>_result" — 맨 아래 CTA(signup:tool_<도구>)와 갈라 어느 쪽이 눌리는지 본다.
//   ▸ 모양은 landing-v8.css 의 .tl8-rcta.
import Link from "next/link";
import { SIGNUP_HREF } from "@/components/landing-v8/content";

export function ResultCta({ tool, children, menuHref, menuLabel }: {
  tool: string;
  children: React.ReactNode;
  menuHref: string;
  menuLabel: string;
}) {
  return (
    <div className="tl8-rcta">
      <p className="tl8-rcta-t">{children}</p>
      <div className="tl8-rcta-b">
        <Link className="btn btn-fill btn-sm" href={SIGNUP_HREF} data-cta={`signup:tool_${tool}_result`}>무료로 시작하기</Link>
        <Link className="tl8-rcta-l" href={menuHref}>{menuLabel} →</Link>
      </div>
    </div>
  );
}

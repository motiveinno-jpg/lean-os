"use client";
// 사업자번호가 있어야 열리는 기능 앞에 세우는 안내 (2026-08-20 사장님 지시).
//
// 배경: 가입 관문에서 사업자번호를 필수로 받다가 소셜 가입자의 80% 를 잃었다(운영 실측).
//   그래서 가입은 회사명만으로 통과시키고, **번호가 실제로 필요한 자리**에서 받는다.
//   여기가 그 자리다 — 통장·카드 자동수집 / 세금계산서 발행 / 결제.
//   이 시점엔 사용자가 스스로 그 기능을 쓰려고 들어온 것이라 등록증을 찾아올 동기가 분명하다.
//
// "나중에 하면 영영 안 한다"에 대한 답: 이 안내는 닫을 수 없다. 기능 자체를 대신 차지하고 있어
//   그 기능을 쓰려면 반드시 지나가야 한다. 대신 앱의 나머지는 막지 않는다.

import Link from "next/link";
import { Ico } from "@/components/ui-icon";

export function BizNoRequired({ feature, why }: {
  /** 무엇을 하려다 막혔는지 — "통장 연결" 처럼 사용자의 말로 */
  feature: string;
  /** 왜 번호가 필요한지 한 줄 */
  why: string;
}) {
  return (
    <div className="bizno-required">
      <div className="bizno-required-icon" aria-hidden><Ico e="🧾" /></div>
      <div className="bizno-required-title">{feature}에는 사업자등록번호가 필요해요</div>
      <p className="bizno-required-desc">{why}</p>
      <Link href="/settings?tab=company-info" className="btn-primary btn-sm bizno-required-cta">
        사업자번호 등록하러 가기
      </Link>
      <p className="bizno-required-note">
        회사 설정 → 회사정보에서 1분이면 끝납니다. 등록하면 이 기능이 바로 열려요.
      </p>
    </div>
  );
}

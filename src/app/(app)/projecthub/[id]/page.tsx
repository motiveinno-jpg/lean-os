"use client";

// 프로젝트 상세 — 게이트 스위처 (2026-08-31 기획 v2.6 1단계)
//   feature_on('projecthub_items_v3') 켜진 회사(모티브 먼저)는 새 "한 장"(HubV3),
//   나머지는 기존 화면(legacy-detail) 그대로였다. CLAUDE.md 규칙: 데이터 만드는 변화는 모티브 먼저,
//   사장님 확인 후 feature_rollout 에 company_id null 행을 넣어 전체로 올린다.
//   2026-09-03 v3 5단계(사장님 승인): 두 게이트 모두 company_id null 행으로 전체 오픈 — 옛 화면(legacy-detail)과
//   부품 22개 삭제. 회사 "오너뷰"의 옛 보드 항목 30건은 이관 블록(20260831140000 §F, 멱등) 재실행으로 project_items 에 옮겼다.

import { HubV3 } from "./_v3/HubV3";
import { TableV3 } from "./_v3/TableV3";
import { useFeature } from "@/lib/use-feature";
import { useUser } from "@/components/user-context";

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  //   프로젝트 v3(먼데이식 표, 결정 130) — 켜진 회사는 표가 기본 화면(지금은 전체). 게이트를 끄면 한 장(HubV3)으로 내려간다.
  //   같은 project_items 모델이라 한 장(HubV3)과 데이터 충돌 없음 (2026-08-31 구현 1단계, 이 도메인은 연준호 PC 전담)
  const featTable = useFeature("projecthub_v3", companyId);
  // 게이트 확인 전에는 아무것도 그리지 않는다 — 화면이 깜빡이며 바뀌면 더 혼란스럽다
  if (!companyId || featTable.isLoading) return null;
  return featTable.data ? <TableV3 /> : <HubV3 />;
}

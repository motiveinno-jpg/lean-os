"use client";

// 프로젝트 상세 — 게이트 스위처 (2026-08-31 기획 v2.6 1단계)
//   feature_on('projecthub_items_v3') 켜진 회사(모티브 먼저)는 새 "한 장"(HubV3),
//   나머지는 기존 화면(legacy-detail) 그대로. CLAUDE.md 규칙: 데이터 만드는 변화는 모티브 먼저,
//   사장님 확인 후 feature_rollout 에 company_id null 행을 넣어 전체로 올린다.

import LegacyProjectDetail from "./legacy-detail";
import { HubV3 } from "./_v3/HubV3";
import { TableV3 } from "./_v3/TableV3";
import { useFeature } from "@/lib/use-feature";
import { useUser } from "@/components/user-context";

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const feat = useFeature("projecthub_items_v3", companyId);
  //   프로젝트 v3(먼데이식 표, 결정 130) — 켜진 회사는 표가 기본 화면.
  //   같은 project_items 모델이라 한 장(HubV3)과 데이터 충돌 없음 (2026-08-31 구현 1단계, 이 도메인은 연준호 PC 전담)
  const featTable = useFeature("projecthub_v3", companyId);
  // 게이트 확인 전에는 아무것도 그리지 않는다 — 새/옛 화면이 깜빡이며 바뀌면 더 혼란스럽다
  if (!companyId || feat.isLoading || featTable.isLoading) return null;
  if (featTable.data) return <TableV3 />;
  return feat.data ? <HubV3 /> : <LegacyProjectDetail />;
}

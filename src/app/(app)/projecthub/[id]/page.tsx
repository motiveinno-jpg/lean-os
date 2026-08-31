"use client";

// 프로젝트 상세 — 게이트 스위처 (2026-08-31 기획 v2.6 1단계)
//   feature_on('projecthub_items_v3') 켜진 회사(모티브 먼저)는 새 "한 장"(HubV3),
//   나머지는 기존 화면(legacy-detail) 그대로. CLAUDE.md 규칙: 데이터 만드는 변화는 모티브 먼저,
//   사장님 확인 후 feature_rollout 에 company_id null 행을 넣어 전체로 올린다.

import LegacyProjectDetail from "./legacy-detail";
import { HubV3 } from "./_v3/HubV3";
import { useFeature } from "@/lib/use-feature";
import { useUser } from "@/components/user-context";

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const feat = useFeature("projecthub_items_v3", companyId);
  // 게이트 확인 전에는 아무것도 그리지 않는다 — 새/옛 화면이 깜빡이며 바뀌면 더 혼란스럽다
  if (!companyId || feat.isLoading) return null;
  return feat.data ? <HubV3 /> : <LegacyProjectDetail />;
}

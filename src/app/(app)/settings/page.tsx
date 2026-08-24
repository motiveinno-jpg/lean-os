"use client";
//   /settings — 이제 화면이 아니라 **길잡이**다 (2026-08-24 설정 IA 재편).
//   설정 항목은 사이드바 '회사 관리' 그룹의 다섯 줄(/settings/company 등)로 폈고,
//   이 주소로 들어온 사람은 아래 순서로 보낸다.
//     ① 다른 화면으로 이관된 옛 키(계정·알림·결재정책) → 그 화면으로
//     ② 옛 딥링크 /settings?tab=X → 그 leaf 를 담은 그룹 주소로 (앱 안 28곳 + 알림·즐겨찾기)
//     ③ 그 밖 → 권한이 있는 첫 그룹으로
//   ★ 이 표는 지우지 않는다. 사장님 즐겨찾기와 이미 나간 알림 주소가 여기에 산다.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { SETTINGS_GROUPS, TAB_MOVED, groupPermKeys, settingsHrefForTab } from "@/lib/settings-nav";

export default function SettingsIndexPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get("tab") || "";
  const { isMaster, hasPerm, loading } = useMyPermissions();

  //   권한이 있는 첫 그룹 — 마스터는 첫 그룹, 멤버는 그룹 안 leaf 를 하나라도 받은 첫 그룹.
  const firstAllowed = SETTINGS_GROUPS.find(
    (g) => isMaster || groupPermKeys(g).some((k) => hasPerm(k)),
  );

  useEffect(() => {
    if (rawTab && TAB_MOVED[rawTab]) { router.replace(TAB_MOVED[rawTab]); return; }
    const href = rawTab ? settingsHrefForTab(rawTab) : undefined;
    if (href) { router.replace(href); return; }
    if (loading) return;                       // 권한을 아직 읽는 중이면 기다린다
    if (firstAllowed) router.replace(firstAllowed.route);
  }, [rawTab, router, loading, firstAllowed]);

  if (!loading && !firstAllowed && !rawTab) {
    return <AccessDenied detail="회사 설정에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--text-muted)]">설정 여는 중...</p>
      </div>
    </div>
  );
}

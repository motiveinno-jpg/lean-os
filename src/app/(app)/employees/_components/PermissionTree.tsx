"use client";

// 메뉴·세부탭 권한 체크박스 트리 — 구성원 권한 화면과 템플릿 관리 팝업이 함께 쓴다.
//   (2026-08-06 템플릿 관리를 팝업으로 분리하면서 PermissionSection 에서 그대로 추출 — 렌더 결과 무변경)
import { useMemo } from "react";
import { PERMISSION_CATALOG } from "@/lib/permissions";

// 부여 가능한 전체 권한 키 (기본 제공 메뉴는 라우트 키 없이 세부탭만)
export function useAllPermissionKeys() {
  return useMemo(() => {
    const keys: string[] = [];
    for (const g of PERMISSION_CATALOG) for (const m of g.menus) {
      if (!m.always) keys.push(m.route);
      for (const t of m.tabs || []) keys.push(`${m.route}:${t.key}`); // always 메뉴의 세부탭도 부여 대상
    }
    return keys;
  }, []);
}

export function PermissionTree({ checked, onToggle, viewerIsMaster = true }: {
  checked: Set<string>;
  onToggle: (keys: string[], on: boolean) => void;
  viewerIsMaster?: boolean;
}) {
  return (
    <div className="member-permission-groups">
      {PERMISSION_CATALOG.map((g) => {
        const groupKeys = g.menus.flatMap((m) => [...(m.always ? [] : [m.route]), ...(m.tabs || []).map((t) => `${m.route}:${t.key}`)]);
        if (groupKeys.length === 0) return null;
        const groupAll = groupKeys.every((k) => checked.has(k));
        return (
          <div key={g.group} className="member-permission-group glass-card">
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" checked={groupAll} onChange={(e) => onToggle(groupKeys, e.target.checked)} className="accent-[var(--primary)]" />
              <span className="text-xs font-bold text-[var(--text)]">{g.group}</span>
            </label>
            <div className="space-y-2">
              {g.menus.filter((m) => !m.always || (m.tabs || []).length > 0).map((m) => {
                const menuKeys = [...(m.always ? [] : [m.route]), ...(m.tabs || []).map((t) => `${m.route}:${t.key}`)];
                const menuOn = m.always ? true : checked.has(m.route); // 기본 제공 메뉴는 항상 열림 — 세부탭만 부여
                return (
                  <div key={m.route} className="member-permission-menu">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={menuOn} disabled={!!m.always}
                        onChange={(e) => onToggle(menuKeys, e.target.checked)}
                        className="accent-[var(--primary)]" />
                      <span className="text-xs font-semibold text-[var(--text)]">{m.label}</span>
                      {m.always && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-dim)] text-[var(--success)]">기본 제공</span>}
                      <span className="text-[10px] text-[var(--text-dim)] mono-number">{m.route}</span>
                    </label>
                    {(m.tabs || []).length > 0 && (
                      <div className="member-permission-tabs">
                        {(m.tabs || []).map((t) => {
                          const k = `${m.route}:${t.key}`;
                          // 위임 권한 자체는 마스터만 조작(서버에서도 강제) — 위임받은 부여자는 비활성 표시
                          const masterOnlyKey = k === "/employees:permissions" && !viewerIsMaster;
                          return (
                            <label key={k} className={`flex items-center gap-1.5 cursor-pointer ${!menuOn || masterOnlyKey ? "opacity-50" : ""}`} title={masterOnlyKey ? "이 권한은 마스터만 부여/회수할 수 있습니다" : undefined}>
                              <input type="checkbox" checked={checked.has(k)} disabled={!menuOn || masterOnlyKey}
                                onChange={(e) => onToggle([k], e.target.checked)} className="accent-[var(--primary)]" />
                              <span className="text-[11px] text-[var(--text-muted)]">{t.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

// 메뉴·세부 기능 권한 표 — 구성원 권한 화면과 템플릿 관리 팝업이 함께 쓴다.
//   2026-08-19 재편(docs/20260819_PLAN_permission_tab_redesign.md): 2열 카드 + 체크박스 44개 → **표 한 장**.
//   그룹 구분 줄(오른쪽 '이 그룹 전부' 스위치) · 메뉴 줄 = 이름(₩ = 금액 보임) · 접근 스위치 · 세부 기능 칩.
//   접근이 꺼지면 칩은 흐려지고, 칩을 켜면 접근이 같이 켜진다(모순 자동 보정). 경로는 툴팁으로만.
//   키(perm_key)는 그대로 — 그리는 방법만 바뀌었다.
import { useMemo } from "react";
import { PERMISSION_CATALOG, type PermMenu } from "@/lib/permissions";

// 부여 가능한 전체 권한 키 (기본 제공 메뉴는 라우트 키 없이 세부탭만). hidden(사이드바에서 내린 옛 메뉴)도 포함 — 키 호환
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

/** 메뉴 한 줄이 가진 부여 키(접근 + 세부) */
export const menuKeysOf = (m: PermMenu) => [...(m.always ? [] : [m.route]), ...(m.tabs || []).map((t) => `${m.route}:${t.key}`)];

/** 키 → 사람이 읽는 이름 ("통장 › 거래내역") */
export function permKeyLabel(key: string): string {
  for (const g of PERMISSION_CATALOG) for (const m of g.menus) {
    if (m.route === key) return m.label;
    for (const t of m.tabs || []) if (`${m.route}:${t.key}` === key) return `${m.label} › ${t.label}`;
  }
  //   카탈로그에 없는 키 = 옛 메뉴·탭 권한(예: /settings:certificate). 화면에선 아무것도 안 열지만 저장돼 있을 수 있다
  return `옛 권한 · ${key}`;
}
/** 금액이 보이는 키인가 */
export function permKeyIsMoney(key: string): boolean {
  for (const g of PERMISSION_CATALOG) for (const m of g.menus) {
    if (m.route === key) return !!m.money;
    for (const t of m.tabs || []) if (`${m.route}:${t.key}` === key) return !!(t.money || m.money);
  }
  return false;
}

function Switch({ on, disabled, onChange, title, label }: { on: boolean; disabled?: boolean; onChange?: (v: boolean) => void; title?: string; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled}
      onClick={() => onChange?.(!on)} className={`perm-sw ${on ? "perm-sw-on" : ""}`}>
      <span className="perm-sw-knob" />
    </button>
  );
}

export function PermissionTree({ checked, onToggle, viewerIsMaster = true, savedKeys }: {
  checked: Set<string>;
  onToggle: (keys: string[], on: boolean) => void;
  viewerIsMaster?: boolean;
  /** 저장돼 있는 키 — 있으면 바뀐 줄에 표시를 단다 */
  savedKeys?: Set<string>;
}) {
  const alwaysMenus = PERMISSION_CATALOG.flatMap((g) => g.menus).filter((m) => m.always && !(m.tabs || []).length);
  return (
    <div className="perm-table-wrap">
      <table className="ev-table ev-lined perm-table">
        <thead>
          <tr>
            <th className="text-left">메뉴</th>
            <th style={{ width: 72 }}>접근</th>
            <th className="text-left">세부 기능 <span className="font-normal text-[var(--text-dim)]">(누르면 허용)</span></th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_CATALOG.map((g) => {
            const menus = g.menus.filter((m) => !m.hidden && (!m.always || (m.tabs || []).length > 0));
            if (menus.length === 0) return null;
            const groupKeys = menus.flatMap(menuKeysOf);
            const groupAll = groupKeys.every((k) => checked.has(k));
            const grantable = menus.filter((m) => !m.always);
            const onCnt = grantable.filter((m) => checked.has(m.route)).length;
            return [
              <tr key={`g-${g.group}`} className="perm-group-row">
                <td colSpan={3}>
                  <span className="perm-group-name">{g.group}</span>
                  {grantable.length > 0 && <span className="perm-group-cnt mono-number">{onCnt}/{grantable.length}</span>}
                  <span className="perm-group-all">
                    <span className="text-[11px] text-[var(--text-dim)] mr-1.5">이 그룹 전부</span>
                    <Switch on={groupAll} label={`${g.group} 전부`} onChange={(v) => onToggle(groupKeys, v)} />
                  </span>
                </td>
              </tr>,
              ...menus.map((m) => {
                const keys = menuKeysOf(m);
                const menuOn = m.always ? true : checked.has(m.route);
                const changed = !!savedKeys && keys.some((k) => checked.has(k) !== savedKeys.has(k));
                return (
                  <tr key={m.route} className={changed ? "perm-row perm-row-changed" : "perm-row"}>
                    <td className={`perm-menu ${m.sub ? "perm-menu-sub" : ""}`} title={`${m.route}${m.desc ? ` — ${m.desc}` : ""}`}>
                      {m.label}
                      {m.money && <span className="perm-won" title="금액 정보가 보이는 메뉴">₩</span>}
                      {m.always && <span className="perm-always">기본 제공</span>}
                    </td>
                    <td className="text-center">
                      {m.always
                        ? <Switch on disabled label={`${m.label} 접근`} title="기본 제공 — 항상 열림" />
                        : <Switch on={menuOn} label={`${m.label} 접근`} onChange={(v) => onToggle(keys, v)} />}
                    </td>
                    <td className="perm-tabs">
                      {(m.tabs || []).length === 0 ? <span className="text-[var(--text-dim)]">—</span> : (m.tabs || []).map((t) => {
                        const k = `${m.route}:${t.key}`;
                        // 위임 권한 자체는 마스터만 조작(서버에서도 강제) — 위임받은 부여자는 잠금 표시
                        const lock = !!t.masterOnly && !viewerIsMaster;
                        const on = checked.has(k);
                        return (
                          <button key={k} type="button" disabled={lock}
                            onClick={() => {
                              if (on) onToggle([k], false);
                              else onToggle(m.always || menuOn ? [k] : [k, m.route], true);  // 칩을 켜면 접근도 같이
                            }}
                            className={`perm-chip ${on ? "perm-chip-on" : ""} ${!menuOn ? "perm-chip-dim" : ""} ${lock ? "perm-chip-lock" : ""}`}
                            title={`${t.desc || t.label}${lock ? " · 마스터만 부여/회수할 수 있습니다" : ""}`}>
                            {t.label}{t.money && <span className="perm-won">₩</span>}
                          </button>
                        );
                      })}
                    </td>
                  </tr>
                );
              }),
            ];
          })}
          <tr className="perm-foot-row">
            <td colSpan={3}>기본 제공(항상 열림): {alwaysMenus.map((m) => m.label).join(" · ")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

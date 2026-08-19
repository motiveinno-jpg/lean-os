"use client";

// ── 마스터 권한 부여 (2026-07-30 개편 P1 → 2026-08-19 재편) ──
//   마스터가 구성원에게 메뉴·세부 기능 권한을 부여. 저장은 set_member_permissions RPC(전체 교체).
//   2026-08-19 재편(docs/20260819_PLAN_permission_tab_redesign.md, 사장님 "아주 좋아 진행"):
//     · 표 위 템플릿 칩(누르면 체크 교체, 저장 전) + 요약 줄(메뉴 n/N · 세부 n/N · 템플릿과의 차이 · ₩ 금액 · 바뀜 +a −b · 되돌리기)
//     · 표 한 장(PermissionTree) + 오른쪽 '이 사람이 보게 될 메뉴' 미리보기
//     · 저장 = 바뀐 것 확인 팝업(추가/해제 목록, 금액은 ₩) → RPC. 바뀐 게 없으면 저장 비활성.
//     · 화면 전체 선택/해제 버튼은 없앴다(그룹 스위치로 대체 — 전체 선택 한 번에 금액 메뉴까지 켜지던 실수 방지).
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { PERMISSION_CATALOG } from "@/lib/permissions";
import { PermissionTree, permKeyLabel, permKeyIsMoney } from "./PermissionTree";
import { PermissionTemplateModal } from "./PermissionTemplateModal";

/** 오른쪽 미리보기 — 이 권한이면 사이드바에 무엇이 보이나 (그룹별, 꺼진 메뉴는 취소선) */
function SidebarPreview({ checked }: { checked: Set<string> }) {
  const moneyOn = PERMISSION_CATALOG.some((g) => g.menus.some((m) => m.money && !m.hidden && checked.has(m.route))) || checked.has("/dashboard:finance");
  return (
    <div className="perm-preview">
      <div className="perm-preview-title">이 사람이 보게 될 메뉴</div>
      {moneyOn && <div className="perm-preview-money">₩ 금액 정보 포함</div>}
      {PERMISSION_CATALOG.map((g) => {
        const menus = g.menus.filter((m) => !m.hidden && !m.sub);
        if (menus.length === 0) return null;
        return (
          <div key={g.group}>
            <div className="perm-preview-group">{g.group}</div>
            {menus.map((m) => {
              const on = m.always || checked.has(m.route);
              const tabs = m.tabs || [];
              const n = tabs.filter((t) => checked.has(`${m.route}:${t.key}`)).length;
              return (
                <div key={m.route} className={`perm-preview-menu ${on ? "" : "perm-preview-off"}`}>
                  <span className="perm-preview-ico" aria-hidden />
                  <span className="truncate">{m.label}</span>
                  {on && tabs.length > 0 && <small className="mono-number">{n}/{tabs.length}</small>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function PermissionSection({ targetUserId, empName, viewerIsMaster = true }: { targetUserId: string | null; empName: string; viewerIsMaster?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { data: saved, isLoading } = useQuery({
    queryKey: ["member-permissions", targetUserId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("member_permissions").select("perm_key").eq("user_id", targetUserId!);
      return new Set<string>((data || []).map((r: any) => r.perm_key));
    },
    enabled: !!targetUserId,
  });
  useEffect(() => { if (saved && !dirty) setChecked(new Set(saved)); }, [saved, dirty]);

  // 권한 템플릿 (2026-07-30 사장님) — 팀별 세트. 만들기·수정·삭제는 별도 팝업(PermissionTemplateModal).
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const { data: templates = [] } = useQuery({
    queryKey: ["permission-templates"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("permission_templates").select("id, name, perm_keys").order("name");
      return data || [];
    },
  });

  // 템플릿 칩 = 체크 상태만 교체(미리보기) — **저장을 눌러야** 실제 적용 (2026-08-19 사장님: 즉시 적용되던 것 수정)
  const [tplId, setTplId] = useState<string>("");
  const stageTemplate = (tpl: { id: string; name: string; perm_keys: string[] }) => {
    setChecked(new Set(tpl.perm_keys || []));
    setTplId(tpl.id);
    setDirty(true);
  };
  //   현재 체크와 정확히 일치하는 템플릿이 있으면 그 칩이 켜진다 — "무엇이 적용돼 있는지" 보인다 (2026-08-19 사장님)
  const matchedTplId = useMemo(() => {
    const hit = (templates as any[]).find((t) => {
      const keys: string[] = t.perm_keys || [];
      return keys.length === checked.size && keys.every((k) => checked.has(k));
    });
    return hit?.id || "";
  }, [templates, checked]);
  const baseTpl = (templates as any[]).find((t) => t.id === (matchedTplId || tplId)) || null;
  const tplDiff = useMemo(() => {
    if (!baseTpl) return null;
    const keys = new Set<string>(baseTpl.perm_keys || []);
    return { add: [...checked].filter((k) => !keys.has(k)).length, rm: [...keys].filter((k) => !checked.has(k)).length };
  }, [baseTpl, checked]);

  const { data: targetIsMaster = false } = useQuery({
    queryKey: ["target-is-master", targetUserId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("users").select("is_master").eq("id", targetUserId!).maybeSingle();
      return !!data?.is_master;
    },
    enabled: !!targetUserId,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("set_member_permissions", {
        p_user_id: targetUserId, p_perm_keys: Array.from(checked),
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "저장 실패");
      return data;
    },
    onSuccess: () => {
      toast(`${empName}님의 권한이 저장되었습니다`, "success");
      setDirty(false); setConfirming(false);
      qc.invalidateQueries({ queryKey: ["member-permissions", targetUserId] });
    },
    onError: (e: any) => toast(friendlyError(e, "권한 저장 실패"), "error"),
  });

  const toggle = (keys: string[], on: boolean) => {
    setChecked((cur) => {
      const next = new Set(cur);
      for (const k of keys) { if (on) next.add(k); else next.delete(k); }
      //   모순 보정 — 메뉴 접근을 껐으면 그 메뉴의 세부 키도 끈다 (세부만 켜진 상태는 화면에서 아무것도 안 연다)
      if (!on) {
        for (const g of PERMISSION_CATALOG) for (const m of g.menus) {
          if (!m.always && keys.includes(m.route)) for (const t of m.tabs || []) next.delete(`${m.route}:${t.key}`);
        }
      }
      return next;
    });
    setDirty(true);
  };
  const revert = () => { setChecked(new Set(saved || [])); setDirty(false); setTplId(""); };

  //   요약 숫자 — 메뉴(접근 키) · 세부 기능 · 바뀐 것
  const stat = useMemo(() => {
    const menus = PERMISSION_CATALOG.flatMap((g) => g.menus).filter((m) => !m.hidden);
    const grantable = menus.filter((m) => !m.always);
    const tabKeys = menus.flatMap((m) => (m.tabs || []).map((t) => `${m.route}:${t.key}`));
    const add = saved ? [...checked].filter((k) => !saved.has(k)) : [];
    const rm = saved ? [...saved].filter((k) => !checked.has(k)) : [];
    return { menuOn: grantable.filter((m) => checked.has(m.route)).length, menuTot: grantable.length, tabOn: tabKeys.filter((k) => checked.has(k)).length, tabTot: tabKeys.length, add, rm };
  }, [checked, saved]);
  const moneyOn = PERMISSION_CATALOG.some((g) => g.menus.some((m) => m.money && !m.hidden && checked.has(m.route))) || checked.has("/dashboard:finance");
  const hasChange = stat.add.length + stat.rm.length > 0;

  if (!targetUserId) {
    return <div className="text-xs text-[var(--text-dim)] py-4">아직 계정에 연결되지 않은 구성원입니다 — 초대 수락 후 권한을 부여할 수 있습니다.</div>;
  }
  if (targetIsMaster) {
    return <div className="text-xs text-[var(--text-muted)] py-4">이 구성원은 <b>마스터</b>입니다 — 모든 메뉴·기능 권한을 항상 보유합니다.</div>;
  }
  if (isLoading) return <div className="text-xs text-[var(--text-dim)] py-4">권한 불러오는 중...</div>;

  return (
    <div className="member-permission-tree perm-section">
      {/* 머리 — 이름 · 템플릿으로 시작 칩 · 템플릿 관리 */}
      <div className="perm-head">
        <div>
          <div className="text-sm font-bold text-[var(--text)]">메뉴·기능 권한</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">켜진 메뉴와 세부 기능만 {empName}님에게 보입니다. 기본 제공(마이페이지·알림·일정·게시판 등)은 항상 열립니다.</div>
        </div>
        <div className="perm-tpls">
          <span className="text-[11px] text-[var(--text-dim)]">템플릿으로 시작</span>
          {templates.length === 0
            ? <span className="text-[11px] text-[var(--text-dim)]">만들어 둔 템플릿 없음</span>
            : (templates as any[]).map((t) => (
              <button key={t.id} type="button" onClick={() => stageTemplate(t)} title={`${(t.perm_keys || []).length}개 권한 — 누르면 체크가 이 템플릿으로 바뀝니다(저장 전)`}
                className={matchedTplId === t.id ? "qk-quick qk-quick-on" : "qk-quick"}>{t.name}</button>
            ))}
          <button onClick={() => setShowTemplateModal(true)} className="btn-secondary btn-sm">템플릿 관리</button>
        </div>
      </div>

      {/* 요약 줄 — 숫자 · 템플릿과의 차이 · ₩ · 바뀜/되돌리기 */}
      <div className="perm-sum">
        <span>메뉴 <b className="mono-number">{stat.menuOn}/{stat.menuTot}</b></span>
        <span>세부 기능 <b className="mono-number">{stat.tabOn}/{stat.tabTot}</b></span>
        {baseTpl && (
          <span>템플릿 &lsquo;{baseTpl.name}&rsquo;{tplDiff && (tplDiff.add || tplDiff.rm) ? <span className="perm-sum-warn"> +{tplDiff.add} · −{tplDiff.rm}</span> : "과 같음"}</span>
        )}
        {moneyOn && <span className="perm-money-chip">₩ 금액 정보를 봅니다</span>}
        <span className="flex-1" />
        {hasChange ? (
          <>
            <span className="perm-sum-warn">바뀜 +{stat.add.length} · −{stat.rm.length}</span>
            <button type="button" className="text-[11.5px] font-semibold text-[var(--primary)] hover:underline" onClick={revert}>되돌리기</button>
          </>
        ) : <span className="text-[var(--text-dim)]">바뀐 것 없음</span>}
      </div>

      {/* 몸통 — 표 + 미리보기 */}
      <div className="perm-body">
        <PermissionTree checked={checked} onToggle={toggle} viewerIsMaster={viewerIsMaster} savedKeys={saved} />
        <SidebarPreview checked={checked} />
      </div>

      {/* 바닥 — 저장(확인 팝업) */}
      <div className="perm-foot">
        {hasChange && <span className="perm-sum-warn text-[11.5px] mr-auto">저장을 눌러야 반영됩니다 — 누르면 바뀐 것을 한 번 더 보여 드립니다</span>}
        <button onClick={() => setConfirming(true)} disabled={!hasChange || saveMut.isPending} className="btn-primary btn-sm disabled:opacity-40">
          {saveMut.isPending ? "저장 중..." : "저장"}
        </button>
      </div>

      {/* 저장 확인 — 추가/해제 목록, 금액은 ₩ */}
      {confirming && (
        <div className="approval-detail-modal" onClick={() => setConfirming(false)}>
          <div className="pnl-drill perm-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="pnl-drill-head"><h3 className="text-sm font-bold">권한 변경 확인 — {empName}</h3><button type="button" className="btn-secondary btn-sm" onClick={() => setConfirming(false)}>취소</button></div>
            <div className="pay-form-body space-y-2">
              <ul className="perm-confirm-list">
                {stat.add.map((k) => <li key={`a-${k}`} className="perm-confirm-add">+ 추가 <b>{permKeyLabel(k)}</b>{permKeyIsMoney(k) && <span className="perm-won">₩ 금액</span>}</li>)}
                {stat.rm.map((k) => <li key={`r-${k}`} className="perm-confirm-rm">− 해제 <b>{permKeyLabel(k)}</b></li>)}
              </ul>
              <p className="text-[12px] text-[var(--text-muted)]">저장하면 바로 {empName}님 화면에 반영됩니다.</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirming(false)}>취소</button>
                <button type="button" className="btn-primary btn-sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>{saveMut.isPending ? "저장 중..." : "저장"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PermissionTemplateModal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        viewerIsMaster={viewerIsMaster}
        currentChecked={checked}
        currentEmpName={empName}
      />
    </div>
  );
}

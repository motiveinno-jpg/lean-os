"use client";

// 회사별 접속 허용 IP 제한 — 옵션 기능 (2026-08-11 사장님: "쓰는 회사들에게만 적용").
//   회사 설정(company_settings.settings.ip_restriction = { enabled, ips: [] })을 켠 회사만,
//   허용 목록에 없는 IP 로 접속하면 전체 화면 차단.
//   · IP 는 /api/my-ip(서버가 본 x-forwarded-for)로 판정 — 클라이언트가 위조할 수 없다.
//   · 마스터는 잠금 사고(사무실 IP 변경 등) 탈출용으로 차단 화면에서 제한을 끌 수 있다.
//   · 판정 불가(API 실패·설정 조회 실패) 시에는 막지 않는다(fail-open — 장애로 전 직원이 잠기지 않게).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useMyPermissions } from "@/lib/permissions";
import { appConfirm } from "@/components/global-confirm";

type IpRestriction = { enabled?: boolean; ips?: string[] };

export function IpGate() {
  const { isMaster } = useMyPermissions();
  const [blocked, setBlocked] = useState<{ ip: string; settingsRowId: string; settings: Record<string, unknown> } | null>(null);
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data: row } = await (supabase as any)
          .from("company_settings").select("id, settings").maybeSingle();
        const conf = (row?.settings as { ip_restriction?: IpRestriction } | null)?.ip_restriction;
        if (!conf?.enabled || !Array.isArray(conf.ips) || conf.ips.length === 0) return;
        const res = await fetch("/api/my-ip");
        const { ip } = await res.json();
        if (!alive || !ip) return;
        if (!conf.ips.map((s) => String(s).trim()).includes(ip)) {
          setBlocked({ ip, settingsRowId: row.id, settings: (row.settings as Record<string, unknown>) || {} });
        }
      } catch { /* 판정 불가 — 막지 않음 */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!blocked) return null;

  const releaseRestriction = async () => {
    if (!(await appConfirm("이 회사의 IP 접속 제한을 해제할까요? 모든 네트워크에서 접속이 가능해집니다.", { title: "IP 제한 해제", confirmLabel: "해제" }))) return;
    setReleasing(true);
    try {
      const nextSettings = { ...blocked.settings, ip_restriction: { ...(blocked.settings.ip_restriction as IpRestriction || {}), enabled: false } };
      const { error } = await (supabase as any).from("company_settings").update({ settings: nextSettings }).eq("id", blocked.settingsRowId);
      if (error) throw error;
      setBlocked(null);
    } catch { setReleasing(false); }
  };

  return (
    <div className="ip-gate-overlay" role="dialog" aria-label="접속 제한">
      <div className="ip-gate-card glass-card">
        <div className="text-[15px] font-bold text-[var(--text)] mb-1.5">허용되지 않은 네트워크입니다</div>
        <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed break-keep">
          회사 보안 설정에 따라 등록된 IP에서만 접속할 수 있습니다.<br />
          현재 접속 IP: <b className="mono-number text-[var(--text)]">{blocked.ip}</b>
        </p>
        <p className="text-[11px] text-[var(--text-dim)] mt-2">회사 네트워크(사무실 인터넷)에서 다시 접속하거나, 마스터에게 이 IP 등록을 요청하세요.</p>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => supabase.auth.signOut({ scope: "local" }).then(() => { window.location.href = "/auth"; })} className="btn-secondary btn-sm flex-1">로그아웃</button>
          {isMaster && (
            <button onClick={releaseRestriction} disabled={releasing} className="btn-primary btn-sm flex-1">
              {releasing ? "해제 중..." : "IP 제한 해제(마스터)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

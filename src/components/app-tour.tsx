"use client";

// 첫 가입 탭 투어 (2026-08-10 사장님 — 온보딩 개편).
//   온보딩을 마치고 대시보드에 처음 도착하면(?tour=1) 사이드바의 각 탭을 하나씩
//   하이라이트하며 사용 방법을 설명한다. 완료·건너뛰기는 계정별(user_preferences)로
//   기억해 다시 보여주지 않는다(기기별 localStorage 는 보조).
//
//   사이드바 항목을 못 찾는 화면(모바일·접힘)에서는 하이라이트 없이 카드만 가운데에 띄운다.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const LS_KEY = "ov-app-tour-done";

type TourStep = { href: string | null; title: string; desc: string };

// 사이드바 메뉴 기준 핵심 탭 — 메뉴가 바뀌면 여기도 갱신 (href 는 sidebar.tsx NAV_GROUPS 와 동일해야 하이라이트된다)
const TOUR_STEPS: TourStep[] = [
  { href: "/dashboard", title: "대시보드", desc: "회사 잔고·매출·오늘 할 일을 한 화면에서 봅니다. 위젯은 마우스로 자유롭게 배치할 수 있어요." },
  { href: "/copilot", title: "AI 참모", desc: "회사 데이터를 아는 AI에게 자금·매출·인사 현황을 바로 물어보세요. 결재 상신 같은 실행도 대신 해줘요." },
  { href: "/tax-invoices", title: "세금·증빙", desc: "세금계산서를 여기서 바로 발행하고, 인증서를 연결해두면 홈택스 매입·매출 자료가 자동으로 모여요." },
  { href: "/transactions", title: "거래 장부", desc: "은행·카드 거래가 자동 수집되고 계정과목까지 자동 분류됩니다. 손대지 않아도 장부가 채워져요." },
  { href: "/schedule", title: "일정 / 할 일", desc: "회사 일정과 할 일을 한곳에서 관리합니다. 팀원과 공유돼요." },
  { href: "/projecthub", title: "프로젝트", desc: "수주부터 계약 → 발행 → 입금 → 마진까지, 프로젝트 손익 흐름을 추적합니다." },
  { href: "/approvals", title: "결재 허브", desc: "지출결의·휴가 같은 사내 결재를 전자로 처리합니다. 양식은 회사에 맞게 직접 만들 수 있어요." },
  { href: "/board", title: "게시판 · 메신저", desc: "공지와 소통은 게시판·메신저에서. 직원을 초대하면 바로 함께 쓸 수 있어요." },
  { href: "/employees", title: "구성원", desc: "직원 등록·초대와 근로계약, 급여명세서, 연차 관리까지. 권한도 여기서 부여합니다." },
  { href: "/bank", title: "통장 · 카드", desc: "연결된 계좌 잔액과 거래내역, 법인카드 승인내역을 실시간으로 확인합니다." },
  { href: "/settings", title: "회사 설정", desc: "인증서 연동, 회사 문서, 결재 정책 등 회사 운영 설정을 관리합니다." },
  { href: null, title: "준비 끝!", desc: "더 자세한 사용법은 사이드바 아래 '사용 가이드'에서 언제든 볼 수 있어요. 이제 시작해 볼까요?" },
];

export function shouldStartTour(searchParams: URLSearchParams | null): boolean {
  if (!searchParams || searchParams.get("tour") !== "1") return false;
  if (typeof window !== "undefined" && localStorage.getItem(LS_KEY)) return false;
  return true;
}

export function AppTour({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [ready, setReady] = useState(false);
  const closedRef = useRef(false);

  const step = TOUR_STEPS[idx];

  // 계정에 이미 완료 기록이 있으면 바로 닫는다 (URL 재방문·다른 기기 대비)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setReady(true); return; }
        const { data } = await (supabase as any)
          .from("user_preferences").select("app_tour_done_at")
          .eq("user_id", session.user.id).maybeSingle();
        if (!alive) return;
        if (data?.app_tour_done_at) { finish(false); return; }
        setReady(true);
      } catch { if (alive) setReady(true); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 스텝의 사이드바 항목 위치 계산
  const measure = useCallback(() => {
    if (!step?.href) { setRect(null); return; }
    // 같은 href 가 여러 개다(예: 상단 로고도 /dashboard) — 메뉴 라벨 텍스트가 있는 쪽을 고르고,
    // 없으면 마지막 매치(사이드바 메뉴가 로고보다 뒤에 렌더된다). 첫 매치를 쓰면 로고가 잡힌다(2026-08-10 prod 확인).
    const els = Array.from(document.querySelectorAll(`a[href="${step.href}"], a[href="${step.href}/"]`)) as HTMLElement[];
    const label = step.title.split(" ")[0];
    const el = els.find((e) => e.textContent?.includes(label)) || els[els.length - 1] || null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    if (!ready) return;
    // scrollIntoView 후 자리가 잡히도록 두 번 측정
    measure();
    const t = setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [ready, idx, measure]);

  // 완료·건너뛰기 — 계정(user_preferences) + 기기(localStorage) 양쪽에 기록
  const finish = useCallback(async (persist = true) => {
    if (closedRef.current) return;
    closedRef.current = true;
    try { localStorage.setItem(LS_KEY, "1"); } catch { /* ignore */ }
    if (persist) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && companyId) {
          // 유니크 제약은 (user_id, company_id) — onConflict 를 user_id 만 주면 42P10 으로 조용히 실패한다.
          await (supabase as any).from("user_preferences").upsert(
            { user_id: session.user.id, company_id: companyId, app_tour_done_at: new Date().toISOString(), updated_at: new Date().toISOString() },
            { onConflict: "user_id,company_id" },
          );
        }
      } catch { /* 기록 실패해도 투어 종료는 진행 */ }
    }
    // URL 의 ?tour=1 제거 — 새로고침 시 재시작 방지
    router.replace("/dashboard");
    onClose();
  }, [companyId, onClose, router]);

  if (!ready) return null;

  const isLast = idx === TOUR_STEPS.length - 1;
  // 말풍선 위치 — 하이라이트 오른쪽(사이드바 옆). 못 찾으면 화면 가운데.
  const tipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.min(rect.left + rect.width + 16, window.innerWidth - 340),
        top: Math.max(16, Math.min(rect.top - 8, window.innerHeight - 240)),
      }
    : { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="app-tour-root" role="dialog" aria-label="사용 안내 투어">
      {/* 어두운 배경 — 하이라이트가 있으면 구멍(박스섀도 트릭), 없으면 전체 덮개 */}
      {rect ? (
        <div
          className="app-tour-highlight"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="app-tour-backdrop" />
      )}

      <div className="app-tour-tip glass-card" style={tipStyle}>
        <div className="app-tour-tip-step">{idx + 1} / {TOUR_STEPS.length}</div>
        <div className="app-tour-tip-title">{step.title}</div>
        <p className="app-tour-tip-desc">{step.desc}</p>
        <div className="app-tour-tip-actions">
          <button onClick={() => finish()} className="app-tour-skip">건너뛰기</button>
          <div className="flex gap-2">
            {idx > 0 && (
              <button onClick={() => setIdx(idx - 1)} className="btn-secondary btn-sm">이전</button>
            )}
            <button onClick={() => (isLast ? finish() : setIdx(idx + 1))} className="btn-primary btn-sm">
              {isLast ? "시작하기" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

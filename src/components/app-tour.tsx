"use client";

// 첫 가입 탭 투어 (2026-08-10 사장님 — 온보딩 개편).
//   온보딩을 마치고 대시보드에 처음 도착하면(?tour=1) 사이드바의 각 탭을 하나씩
//   하이라이트하며 사용 방법을 설명한다. 완료·건너뛰기는 계정별(user_preferences)에 기록.
//
//   투어는 앱 셸(AppTourHost)에 상주한다 — 투어 중 사이드바로 다른 화면에 가도 유지되고,
//   진행 스텝은 sessionStorage 에 남겨 새로고침해도 그 자리에서 이어간다. (2026-08-10 사장님 제보:
//   대시보드 안에만 마운트돼 있어 다른 탭을 누르면 사라지고 다시 안 나타나던 것 수정)
//   ?tour=1 은 명시적 요청이므로 완료 기록과 무관하게 항상 시작한다 — 기기 localStorage 게이트는
//   같은 브라우저의 다른 계정(QA 등)까지 막아서 제거했다.
//
//   사이드바 항목을 못 찾는 화면(모바일·접힘)에서는 하이라이트 없이 카드만 가운데에 띄운다.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useMyPermissions } from "@/lib/permissions";
import { useUser } from "@/components/user-context";

// 진행 중 스텝 번호 — 있으면 "투어 진행 중"이라는 뜻. 탭이 닫히면 자연 소멸(sessionStorage).
const SS_KEY = "ov-app-tour-step";

type TourStep = {
  href: string | null;
  title: string;
  desc: string;
  /** 인증·등록이 필요한 탭 — 어떻게 등록하는지 단계별 안내 (2026-08-10 사장님 요청) */
  howTo?: { label: string; steps: string[]; link?: { label: string; href: string } };
};

// 사이드바 메뉴 기준 핵심 탭 — 메뉴가 바뀌면 여기도 갱신 (href 는 sidebar.tsx NAV_GROUPS 와 동일해야 하이라이트된다)
const TOUR_STEPS: TourStep[] = [
  { href: "/dashboard", title: "대시보드", desc: "회사 잔고·매출·오늘 할 일을 한 화면에서 봅니다. 위젯은 마우스로 자유롭게 배치할 수 있어요." },
  { href: "/copilot", title: "AI 참모", desc: "회사 데이터를 아는 AI에게 자금·매출·인사 현황을 바로 물어보세요. 결재 상신 같은 실행도 대신 해줘요." },
  {
    href: "/tax-invoices", title: "세금·증빙",
    desc: "세금계산서를 여기서 바로 발행하고, 인증서를 연결해두면 홈택스 매입·매출 자료가 자동으로 모여요.",
    howTo: {
      label: "홈택스 자동 수집 등록 방법",
      steps: [
        "설정 > 연동·인증에서 「홈택스」를 선택하세요",
        "「PC 인증서 자동 선택」을 누르면 PC의 공동인증서 목록이 뜹니다 (처음이면 안내에 따라 보안 프로그램 설치)",
        "회사 인증서를 고르고 인증서 비밀번호를 입력하세요",
        "「홈택스 연결하기」를 누르면 끝 — 이후 세금계산서가 자동으로 모입니다",
      ],
      link: { label: "설정 > 연동·인증 바로 가기", href: "/settings?tab=bank" },
    },
  },
  {
    href: "/transactions", title: "거래 장부",
    desc: "은행·카드 거래가 자동 수집되고 계정과목까지 자동 분류됩니다. 손대지 않아도 장부가 채워져요.",
    howTo: {
      label: "은행·카드 자동 수집 등록 방법",
      steps: [
        "설정 > 연동·인증에서 「은행」 또는 「카드」를 선택하세요",
        "거래 은행(카드사)을 고르고, 공동인증서 또는 인터넷뱅킹 아이디/비밀번호 중 편한 방식을 선택하세요",
        "인증서면 「PC 인증서 자동 선택」 → 인증서 선택 → 비밀번호 입력",
        "「연결하기」를 누르면 거래내역이 자동으로 수집되기 시작합니다",
      ],
      link: { label: "설정 > 연동·인증 바로 가기", href: "/settings?tab=bank" },
    },
  },
  { href: "/schedule", title: "일정 / 할 일", desc: "회사 일정과 할 일을 한곳에서 관리합니다. 팀원과 공유돼요." },
  { href: "/projecthub", title: "프로젝트", desc: "수주부터 계약 → 발행 → 입금 → 마진까지, 프로젝트 손익 흐름을 추적합니다." },
  {
    href: "/approvals", title: "결재 허브",
    desc: "지출결의·휴가 같은 사내 결재를 전자로 처리합니다. 양식은 회사에 맞게 직접 만들 수 있어요.",
    howTo: {
      label: "회사 결재 양식 만드는 방법",
      steps: [
        "결재 허브 상단의 「양식 관리」 탭으로 이동하세요",
        "「+ 새 양식 추가」로 이름·입력 필드·내용 템플릿을 정하세요",
        "결재선(누가 승인할지)을 단계별로 지정하면 완성 — 새 요청에서 바로 쓸 수 있어요",
      ],
      link: { label: "양식 관리 바로 가기", href: "/approvals?tab=forms" },
    },
  },
  { href: "/board", title: "게시판 · 메신저", desc: "공지와 소통은 게시판·메신저에서. 직원을 초대하면 바로 함께 쓸 수 있어요." },
  {
    href: "/employees", title: "구성원",
    desc: "직원 등록·초대와 근로계약, 급여명세서, 연차 관리까지. 권한도 여기서 부여합니다.",
    howTo: {
      label: "직원 초대·등록 방법",
      steps: [
        "구성원에서 「+ 직원 초대」를 누르고 이름·이메일을 입력하세요",
        "직원에게 초대 메일이 발송되고, 수락하면 직원이 직접 로그인해 출퇴근·급여명세서를 볼 수 있어요",
        "직원 상세의 「탭 권한」에서 보여줄 메뉴를 체크하세요 (자주 쓰는 조합은 템플릿으로 저장)",
      ],
      link: { label: "구성원 바로 가기", href: "/employees" },
    },
  },
  {
    href: "/bank", title: "통장 · 카드",
    desc: "연결된 계좌 잔액과 거래내역, 법인카드 승인내역을 실시간으로 확인합니다.",
    howTo: {
      label: "계좌·카드 연결 방법",
      steps: [
        "설정 > 연동·인증에서 공동인증서 또는 뱅킹 아이디로 은행·카드를 연결하세요",
        "연결하면 전 계좌 잔액과 거래가 하루 2회 자동 동기화됩니다",
        "「지금 동기화」 버튼으로 언제든 즉시 갱신할 수도 있어요",
      ],
      link: { label: "설정 > 연동·인증 바로 가기", href: "/settings?tab=bank" },
    },
  },
  {
    href: "/settings", title: "회사 설정",
    desc: "인증서 연동, 회사 문서, 결재 정책 등 회사 운영 설정을 관리합니다.",
    howTo: {
      label: "먼저 해두면 좋은 등록 3가지",
      steps: [
        "연동·인증: 공동인증서로 통장·카드·홈택스 연결 (자동 수집의 시작점)",
        "회사 정보: 사업자등록증·통장사본 등 회사 문서 업로드 (계약서·증명서 발급에 쓰여요)",
        "직인 등록: 회사 직인을 올려두면 세금계산서·계약서에 자동 날인됩니다",
      ],
      link: { label: "회사 설정 바로 가기", href: "/settings" },
    },
  },
  { href: null, title: "준비 끝!", desc: "더 자세한 사용법은 사이드바 아래 '사용 가이드'에서 언제든 볼 수 있어요. 이제 시작해 볼까요?" },
];

export function shouldStartTour(searchParams: URLSearchParams | null): boolean {
  return !!searchParams && searchParams.get("tour") === "1";
}

/** 투어가 진행 중인가 — 다른 화면(대시보드 온보딩 팝업 등)이 투어와 겹치지 않게 확인용 */
export function isTourActive(): boolean {
  if (typeof window === "undefined") return false;
  try { return sessionStorage.getItem(SS_KEY) !== null; } catch { return false; }
}

/** 앱 셸 상주 호스트 — ?tour=1(시작) 또는 진행 중 스텝(새로고침 재개)을 감지해 투어를 띄운다.
 *  2026-08-11 사장님: 신기능이니 **기존 사용자 포함 전원**에게 로그인 후 1회 자동 표시 —
 *  user_preferences.app_tour_done_at 이 없는 계정은 자동 시작(완료·건너뛰기 시 기록돼 다시 안 뜸). */
export function AppTourHost({ companyId }: { companyId: string | null }) {
  const pathname = usePathname();
  const { role } = useUser();
  const [show, setShow] = useState(false);
  const autoCheckedRef = useRef(false);
  // 세무사 열람 세션은 투어 제외 (2026-08-11 사장님: 무한 반복 제보) — users 행이 없어
  //   user_preferences 완료 기록이 저장되지 않고(쓰기 전면 차단) 매번 다시 떴다.
  //   세무사는 회사 온보딩 대상이 아니므로 표시하지 않는 게 맞다.
  const isAdvisor = role === "advisor";
  useEffect(() => {
    if (show || isAdvisor) return;
    // 온보딩 완료가 router.replace("/dashboard?tour=1") 로 보내면 pathname 변경으로 여기 걸린다
    const sp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    if (shouldStartTour(sp) || isTourActive()) { setShow(true); return; }

    // 자동 1회 노출 — 신규 가입 온보딩(/onboarding)과 겹치지 않게 그 화면에서는 시작하지 않는다.
    //   온보딩을 마치면 ?tour=1 로 오므로 위 분기가 잡고, 여기는 기존 계정의 첫 로그인용.
    if (autoCheckedRef.current || !companyId || pathname?.startsWith("/onboarding")) return;
    autoCheckedRef.current = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await (supabase as any)
          .from("user_preferences")
          .select("app_tour_done_at")
          .eq("user_id", session.user.id)
          .eq("company_id", companyId)
          .maybeSingle();
        if (!data?.app_tour_done_at) setShow(true);
      } catch { /* 조회 실패 시 자동 노출 생략 — 다음 로그인에 다시 시도 */ }
    })();
  }, [pathname, show, companyId, isAdvisor]);
  if (!show || isAdvisor) return null;
  return <AppTour companyId={companyId} onClose={() => setShow(false)} />;
}

export function AppTour({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  // 권한별 스텝 필터 (2026-08-11 사장님) — 일반 직원은 부여받은 메뉴의 스텝만 본다.
  //   마스터는 전체, 멤버는 hasMenu(기본 제공 포함) 기준. 마지막 안내(href null)는 항상 표시.
  const { isMaster, hasMenu, loading: permLoading } = useMyPermissions();

  // 스텝별 '다시 보지 않기' (2026-08-11 사장님 — "건마다 누르면 그 건만 안 나오게") —
  //   숨긴 스텝 href 를 user_preferences.app_tour_hidden_steps(jsonb 배열)에 계정별로 기록.
  const [hiddenSteps, setHiddenSteps] = useState<string[] | null>(null); // null = 로딩 중
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !companyId) { if (alive) setHiddenSteps([]); return; }
        const { data } = await (supabase as any)
          .from("user_preferences")
          .select("app_tour_hidden_steps")
          .eq("user_id", session.user.id)
          .eq("company_id", companyId)
          .maybeSingle();
        if (alive) setHiddenSteps(Array.isArray(data?.app_tour_hidden_steps) ? data.app_tour_hidden_steps : []);
      } catch { if (alive) setHiddenSteps([]); }
    })();
    return () => { alive = false; };
  }, [companyId]);

  const hideCurrentStep = useCallback(async (href: string) => {
    const next = [...(hiddenSteps || []), href];
    setHiddenSteps(next);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && companyId) {
        await (supabase as any).from("user_preferences").upsert(
          { user_id: session.user.id, company_id: companyId, app_tour_hidden_steps: next, updated_at: new Date().toISOString() },
          { onConflict: "user_id,company_id" },
        );
      }
    } catch { /* 기록 실패해도 이번 세션에선 숨김 유지 */ }
  }, [hiddenSteps, companyId]);

  const steps = permLoading || hiddenSteps === null
    ? TOUR_STEPS
    : TOUR_STEPS.filter((s) => !s.href || ((isMaster || hasMenu(s.href)) && !hiddenSteps.includes(s.href)));

  // 진행 스텝 복원 — 새로고침·재로그인해도 보던 자리에서 이어간다
  const [idx, setIdx] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const saved = Number(sessionStorage.getItem(SS_KEY));
      return Number.isInteger(saved) && saved > 0 && saved < TOUR_STEPS.length ? saved : 0;
    } catch { return 0; }
  });
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  // '다시 보지 않기' 체크박스 (2026-08-11 사장님) — 체크한 상태로 닫으면(건너뛰기·시작하기 모두) 영구 미노출
  const [neverShow, setNeverShow] = useState(false);
  const closedRef = useRef(false);

  // 필터로 스텝 수가 줄었을 때 저장된 진행 위치가 범위를 넘지 않게
  const safeIdx = Math.min(idx, steps.length - 1);
  const step = steps[safeIdx];
  const loadingPrefs = permLoading || hiddenSteps === null;
  // 안내할 스텝이 하나도 안 남았으면(전부 개별 숨김) 자동 노출을 조용히 접는다
  const noContent = !loadingPrefs && steps.every((st) => !st.href);
  useEffect(() => {
    if (noContent && !closedRef.current) {
      closedRef.current = true;
      try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
      onClose();
    }
  }, [noContent, onClose]);

  // 스텝 저장 — 마운트 직후 0부터 기록해 isTourActive() 가 곧바로 참이 되게
  useEffect(() => {
    try { sessionStorage.setItem(SS_KEY, String(safeIdx)); } catch { /* ignore */ }
  }, [safeIdx]);

  // 현재 스텝의 사이드바 항목 위치 계산 — scrollIntoView 는 스텝 진입 때 한 번만(scroll=true)
  const measure = useCallback((scroll = false) => {
    if (!step?.href) { setRect(null); return; }
    // 같은 href 가 여러 개다(예: 상단 로고도 /dashboard) — 메뉴 라벨 텍스트가 있는 쪽을 고르고,
    // 없으면 마지막 매치(사이드바 메뉴가 로고보다 뒤에 렌더된다). 첫 매치를 쓰면 로고가 잡힌다(2026-08-10 prod 확인).
    const els = Array.from(document.querySelectorAll(`a[href="${step.href}"], a[href="${step.href}/"]`)) as HTMLElement[];
    const label = step.title.split(" ")[0];
    const el = els.find((e) => e.textContent?.includes(label)) || els[els.length - 1] || null;
    if (!el) { setRect(null); return; }
    if (scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    measure(true);
    // smooth 스크롤이 끝난 뒤 자리 확정 + 스크롤(사이드바 내부 포함, 캡처) 동안 하이라이트가 따라간다
    //   — 스텝 표시 때 사이드바가 부드럽게 움직이는 중에 한 번만 측정하면 어긋난 자리에 그려진다(2026-08-10 prod 확인)
    const t = setTimeout(() => measure(), 400);
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
  }, [idx, measure]);

  // 종료 — persist=true('다시 보지 않기' 체크)일 때만 계정(user_preferences)에 기록해 영구 미노출.
  //   체크 없이 닫으면(건너뛰기·시작하기 모두) 다음 로그인에 다시 뜬다 (2026-08-11 사장님).
  const finish = useCallback(async (persist = true) => {
    if (closedRef.current) return;
    closedRef.current = true;
    try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
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
    // URL 에 ?tour=1 이 남아 있으면 떼어낸다 — 새로고침 시 재시작 방지 (지금 있는 화면은 유지).
    //   router.replace 는 비동기라 onClose 직후 호스트가 아직 ?tour=1 인 주소를 읽고 곧장 재시작한다 —
    //   네이티브 replaceState 로 주소를 즉시 바꾼다 (Next 14+ 셸로우 URL 갱신 공식 지원).
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("tour")) {
        sp.delete("tour");
        const qs = sp.toString();
        window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
    } catch { /* ignore */ }
    onClose();
  }, [companyId, onClose]);

  const isLast = safeIdx === steps.length - 1;
  // 말풍선 위치 — 하이라이트 오른쪽(사이드바 옆). 못 찾으면 화면 가운데.
  const tipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.min(rect.left + rect.width + 16, window.innerWidth - 340),
        top: Math.max(16, Math.min(rect.top - 8, window.innerHeight - 240)),
      }
    : { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  if (loadingPrefs || noContent) return null;

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
        {/* 모바일 전용 닫기 (2026-08-12 사장님) — 모바일에선 '다음'만 11번 눌러야 끝나던 것.
            체크 없이 닫는 것과 동일(persist=false) — 다음 로그인에 다시 뜬다. 데스크톱은
            건너뛰기 제거(2026-08-11 지시) 유지라 sm 이상에선 숨김. */}
        <button
          type="button"
          className="app-tour-close-m"
          aria-label="투어 닫기"
          onClick={() => finish(false)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="app-tour-tip-step">{safeIdx + 1} / {steps.length}</div>
        <div className="app-tour-tip-title">{step.title}</div>
        <p className="app-tour-tip-desc">{step.desc}</p>
        {step.howTo && (
          <div className="app-tour-howto">
            <div className="app-tour-howto-label">{step.howTo.label}</div>
            <ol className="app-tour-howto-list">
              {step.howTo.steps.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
            {step.howTo.link && (
              // 새 탭으로 연다 — 현재 탭에서 이동하면 투어가 끊긴다
              <a href={step.howTo.link.href} target="_blank" rel="noopener noreferrer" className="app-tour-howto-link">
                {step.howTo.link.label} ↗
              </a>
            )}
          </div>
        )}
        <div className="app-tour-tip-actions">
          {/* 스텝마다: '이 안내 다시 보지 않기' → 그 스텝만 다음부터 제외.
              마지막(완료) 옆 체크박스 → 투어 전체 영구 미노출. 건너뛰기 버튼은 제거 (2026-08-11 사장님). */}
          <div className="flex items-center gap-2.5 min-w-0">
            {!isLast && step.href && (
              <button
                onClick={() => hideCurrentStep(step.href!)}
                className="app-tour-skip shrink-0"
                title="이 안내만 다음 투어에서 표시하지 않습니다"
              >
                이 안내 다시 보지 않기
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {isLast && (
              <label className="app-tour-never" title="체크하면 투어 전체가 다시 나오지 않습니다">
                <input type="checkbox" checked={neverShow} onChange={(e) => setNeverShow(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-[var(--primary)] cursor-pointer" />
                다시 보지 않기
              </label>
            )}
            {safeIdx > 0 && (
              <button onClick={() => setIdx(safeIdx - 1)} className="btn-secondary btn-sm">이전</button>
            )}
            <button onClick={() => (isLast ? finish(neverShow) : setIdx(safeIdx + 1))} className="btn-primary btn-sm">
              {isLast ? "시작하기" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

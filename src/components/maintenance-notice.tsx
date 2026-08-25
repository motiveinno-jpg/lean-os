"use client";

// 데이터 제공사(헥토데이터) 점검 안내 팝업 (2026-08-25).
//   앱을 열면 점검 종료 시각 전까지 모달로 안내한다. /announcements 의 점검 공지(656c5bcd)와 같은 내용.
//   - "오늘 하루 보지 않기": localStorage 에 KST 날짜를 적어 그날 하루만 숨긴다(자정 지나면 다시 뜬다).
//   - 점검 종료(2026-08-27 09:00 KST) 이후에는 배포를 기다리지 않아도 저절로 안 뜬다.
//   일회성 안내라 DB 를 읽지 않는다 — 다음 점검 때는 아래 상수 세 개만 갈아끼운다.

import { useEffect, useState } from "react";
import Link from "next/link";

const NOTICE_KEY = "ov:maint-popup:hecto-20260826"; // 공지 건별 키 — 건이 바뀌면 키도 바꾼다(이전 dismiss 무효화)
const NOTICE_ENDS_AT = new Date("2026-08-27T09:00:00+09:00").getTime();

/** KST 기준 오늘 날짜(YYYY-MM-DD) — "오늘 하루" 판정용. 기기 시간대와 무관하게 한국 날짜로 접는다. */
function todayKst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function MaintenanceNoticeHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Date.now() >= NOTICE_ENDS_AT) return;
    try {
      if (localStorage.getItem(NOTICE_KEY) === todayKst()) return;
    } catch { /* ignore */ }
    setOpen(true);
  }, []);

  if (!open) return null;

  const hideToday = () => {
    try { localStorage.setItem(NOTICE_KEY, todayKst()); } catch { /* ignore */ }
    setOpen(false);
  };

  return (
    <div className="maint-popup-overlay fixed inset-0">
      <div className="maint-popup-panel glass-card animate-count-up">
        <div className="maint-popup-badge">점검 안내</div>
        <h2 className="text-lg font-bold mb-1.5">금융데이터 수집 서비스 점검 안내</h2>
        <p className="text-sm text-[var(--text-muted)] leading-6">
          통장·카드 등 금융데이터 수집을 담당하는 외부 데이터 제공사(헥토데이터)의
          시스템 자원 보강 작업이 진행됩니다.
        </p>
        <div className="maint-popup-rows">
          <div className="maint-popup-row">
            <span className="maint-popup-row-label">작업 일시</span>
            <span>2026-08-26(수) 18:00 ~ 2026-08-27(목) 09:00</span>
          </div>
          <div className="maint-popup-row">
            <span className="maint-popup-row-label">서비스 영향</span>
            <span>작업 시간 동안 금융데이터 수집이 일시적으로 지연되거나 실패할 수 있습니다.</span>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] leading-5 mt-3">
          작업 시간 중 수집되지 못한 데이터는 작업 종료 후 자동 수집 시 정상 반영됩니다.
          자세한 내용은{" "}
          <Link
            href="/announcements"
            onClick={() => setOpen(false)}
            className="text-[var(--primary)] hover:underline font-medium"
          >
            공지사항
          </Link>
          에서 확인하실 수 있습니다.
        </p>
        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={hideToday}
            className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            오늘 하루 보지 않기
          </button>
          <button onClick={() => setOpen(false)} className="btn-primary flex-1">
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

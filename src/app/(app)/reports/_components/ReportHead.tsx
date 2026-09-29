"use client";

// 리포트 표준 상자 머리에 페이지가 끼워 넣는 것 (2026-08-19 리포트 표준 2차).
//   상자·탭·설명 줄은 reports/layout 이 그리고, 각 리포트는 [조회 줄(기간·비교 ‖ 엑셀·인쇄)] 과
//   [결과 요약(핵심 지표)] 만 이 부품으로 넘긴다 → layout 의 #report-head-slot 에 포털로 들어간다.
//   페이지 본문(스크롤)과 머리(고정)가 갈라지므로 기간을 바꿔도 조회 줄은 제자리.
//
//   엑셀·인쇄는 페이지가 버튼을 직접 그리지 않고 excel·print 로 넘긴다 — 이 부품이 조회 줄 오른쪽 끝에
//   늘 같은 순서·같은 모양으로 붙인다. 탭마다 버튼을 따로 그리던 때는 이름(CSV/엑셀)·아이콘·폭이 달라
//   탭을 옮길 때마다 인쇄 버튼이 20px 씩 옆으로 뛰었다.

import { type ReactNode } from "react";
import { SlotHead } from "@/components/slot-head";
import { ExcelMenu, type ExcelItem } from "@/components/query-kit";
import { DateField } from "@/components/date-field";
import { isolatePrintArea } from "@/lib/use-print-isolation";

export function ReportHead({ excel, print, right, ...props }: {
  /** 조회 줄 왼쪽 — 기간·비교 칩 */
  bar?: ReactNode;
  /** 조회 줄 오른쪽 — 엑셀·인쇄 앞에 놓일 것(마감 확정본·비교 기준 등) */
  right?: ReactNode;
  /** 엑셀 내려받기 — 한 가지면 버튼 하나, 여럿이면 고르는 메뉴. 빈 배열이면 누를 수 없는 버튼(자리 유지) */
  excel?: ExcelItem[];
  /** 인쇄 버튼 — 본문(표·차트)만 인쇄한다 */
  print?: boolean;
  /** 결과 요약 — 핵심 지표(Stat) */
  stats?: ReactNode;
  statsRight?: ReactNode;
}) {
  const hasActions = !!right || excel !== undefined || !!print;
  //   2026-08-19 공용 SlotHead 로 — 같은 슬롯 방식이 정기 지출·통장·카드에도 쓰인다
  return (
    <SlotHead slotId="report-head-slot" {...props}
      right={hasActions ? <>
        {right}
        {excel !== undefined && <ReportExcel items={excel} />}
        {print && <ReportPrintButton />}
      </> : undefined} />
  );
}

/** 엑셀 — 내려받을 것이 하나면 누르자마자 받는다(메뉴를 한 번 더 여는 수고를 없앤다) */
function ReportExcel({ items }: { items: ExcelItem[] }) {
  if (items.length > 1) return <ExcelMenu items={items} />;
  const it = items[0];
  return (
    <button type="button" className="qk-xls-btn rpt-xls-btn" disabled={!it || it.disabled}
      onClick={() => it?.onClick()} title={it ? [it.label, it.hint].filter(Boolean).join(" · ") : "내려받을 자료가 없습니다"}>
      <svg className="rpt-act-ico" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      엑셀
    </button>
  );
}

/**
 * 인쇄 — 리포트 본문(.report-body)만 종이에 싣는다.
 *   전역 인쇄 규칙은 .print-area 밖을 모두 숨긴다. 예전 버튼은 window.print() 만 불러 print-area 가 없는
 *   탭에서는 빈 종이가 나왔다. 누를 때 본문에 print-area 를 달고, 나머지 형제를 흐름에서 빼고, 끝나면 되돌린다.
 */
export function printReportBody() {
  const body = document.querySelector(".report-body");
  if (!body) { window.print(); return; }
  body.classList.add("print-area");
  const restore = isolatePrintArea(body);
  let done = false;
  const undo = () => {
    if (done) return;
    done = true;
    body.classList.remove("print-area");
    restore();
    window.removeEventListener("afterprint", undo);
  };
  window.addEventListener("afterprint", undo);
  window.print();
  //   afterprint 를 안 쏘는 브라우저가 있어 한 번 더 되돌린다(이미 되돌렸으면 아무 일도 안 한다)
  setTimeout(undo, 1000);
}

export function ReportPrintButton() {
  return (
    <button type="button" onClick={printReportBody} className="btn-secondary btn-sm rpt-print-btn" aria-label="인쇄">
      <svg className="rpt-act-ico" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
      </svg>
      인쇄
    </button>
  );
}

/** 연도 고르기 — 비용 분석·인원별 급여·부가세·월별 표가 같은 모양(라벨 + 한 줄 셀렉트) */
export function ReportYearSelect({ value, onChange, years, label = "연도" }: {
  value: number; onChange: (y: number) => void; years: number[]; label?: string | null;
}) {
  return (
    <span className="rpt-field">
      {label && <span className="drf-label">{label}</span>}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="qk-input rpt-select" aria-label={label || "연도"}>
        {years.map((y) => <option key={y} value={y}>{y}년</option>)}
      </select>
    </span>
  );
}

/** 기준일 하나 — 조회 기간(DateRangeField)과 같은 라벨·높이·글자 */
export function ReportDateField({ label, value, max, onChange }: {
  label: string; value: string; max?: string; onChange: (v: string) => void;
}) {
  return (
    <span className="rpt-field">
      <span className="drf-label">{label}</span>
      <DateField value={value} max={max} onChange={(e) => onChange(e.target.value)} className="rpt-date" />
    </span>
  );
}

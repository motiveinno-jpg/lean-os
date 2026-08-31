// 프로젝트 v3 — 가로형 템플릿 (2026-08-31 사장님: "업무형식이 가로로 —
//   한 태스크당 업무처리를 하려면 가로로 업무를 보는 게 편함")
//
//   세로(할 일을 여러 줄로 나열)가 아니라 **한 줄 = 한 건, 열 = 처리 단계**.
//   사장님 monday 운영 시트(소상공인 한 줄 × 광고ID·소통일·플랫폼·시작/종료일 열)와 같은 문법.
//   그래서 템플릿이 시드하는 것은 항목이 아니라 **컬럼 정의**(project_item_columns) + 예시 한 줄.
//   그룹(단계)은 건드리지 않는다 — 그룹은 사용자가 ＋ 새 그룹으로 늘리는 영역.

import type { FieldType } from "@/lib/project-items";

export type TplOption = { id: string; label: string; color?: string };
export type TplCol = { name: string; type: FieldType; options?: TplOption[] };
export type Tpl = {
  key: string; icon: string; name: string; desc: string;
  cols: TplCol[];
  /** 예시 줄 — 첫 컬럼부터 순서대로 채울 값(선택). 이름 칸은 example 로 */
  example: string;
};

//   진행 단계 옵션 공용 색 — 상태 셀과 같은 5색 톤(회색=아직, 주황=하는 중, 초록=끝)
const C = { wait: "#9aa0b5", doing: "#FDAB3D", done: "#00C875", danger: "#E2445C" };

export const TEMPLATES: Tpl[] = [
  {
    key: "service", icon: "🤝", name: "고객 용역·납품",
    desc: "한 줄 = 수주 건 하나. 견적→계약→청구가 열로 나란히 — 줄만 훑으면 어디까지 갔는지 보입니다.",
    cols: [
      { name: "거래처", type: "partner" },
      { name: "견적", type: "select", options: [
        { id: "wait", label: "대기", color: C.wait }, { id: "sent", label: "보냄", color: C.doing }, { id: "ok", label: "확정", color: C.done }] },
      { name: "계약", type: "select", options: [
        { id: "wait", label: "대기", color: C.wait }, { id: "sign", label: "서명 중", color: C.doing }, { id: "done", label: "완료", color: C.done }] },
      { name: "청구", type: "select", options: [
        { id: "todo", label: "예정", color: C.wait }, { id: "billed", label: "발행", color: C.doing }, { id: "paid", label: "입금", color: C.done }] },
      { name: "검수일", type: "date" },
    ],
    example: "예시 — ○○상사 홈페이지 제작 건",
  },
  {
    key: "event", icon: "🎪", name: "행사·전시 준비",
    desc: "한 줄 = 준비 건(부스·인쇄물·물품) 하나. 예약→제작→완료와 비용이 열로.",
    cols: [
      { name: "업체", type: "partner" },
      { name: "진행", type: "select", options: [
        { id: "wait", label: "대기", color: C.wait }, { id: "book", label: "예약·발주", color: C.doing }, { id: "done", label: "완료", color: C.done }] },
      { name: "비용", type: "number" },
      { name: "확정일", type: "date" },
    ],
    example: "예시 — 부스 임차",
  },
  {
    key: "campaign", icon: "📣", name: "마케팅 캠페인",
    desc: "한 줄 = 소재·채널 하나. 제작→집행→종료와 광고비가 열로.",
    cols: [
      { name: "채널", type: "select", options: [
        { id: "insta", label: "인스타", color: "#5559DF" }, { id: "naver", label: "네이버", color: C.done }, { id: "youtube", label: "유튜브", color: C.danger }, { id: "etc", label: "기타", color: C.wait }] },
      { name: "소재", type: "select", options: [
        { id: "plan", label: "기획", color: C.wait }, { id: "making", label: "제작 중", color: C.doing }, { id: "done", label: "완료", color: C.done }] },
      { name: "집행", type: "select", options: [
        { id: "wait", label: "대기", color: C.wait }, { id: "live", label: "집행 중", color: C.doing }, { id: "end", label: "종료", color: C.done }] },
      { name: "광고비", type: "number" },
      { name: "시작일", type: "date" },
    ],
    example: "예시 — 9월 신제품 인스타 광고",
  },
  {
    key: "grant", icon: "🏛", name: "정부 지원사업",
    desc: "한 줄 = 사업(공고) 하나. 신청→선정→증빙→정산이 열로 — 마감일은 내장 마감 칸에.",
    cols: [
      { name: "기관", type: "text" },
      { name: "신청", type: "select", options: [
        { id: "prep", label: "준비", color: C.wait }, { id: "sent", label: "제출", color: C.doing }, { id: "win", label: "선정", color: C.done }, { id: "lose", label: "탈락", color: C.danger }] },
      { name: "증빙", type: "select", options: [
        { id: "todo", label: "수집 중", color: C.doing }, { id: "done", label: "완료", color: C.done }] },
      { name: "보조금", type: "number" },
    ],
    example: "예시 — 소상공인 홍보지원 사업",
  },
  {
    key: "internal", icon: "🛠", name: "사내 개선·TF",
    desc: "한 줄 = 안건 하나. 논의→결정→실행이 열로, 결정 내용은 글 칸에.",
    cols: [
      { name: "논의", type: "select", options: [
        { id: "wait", label: "대기", color: C.wait }, { id: "talk", label: "논의 중", color: C.doing }, { id: "fix", label: "결정", color: C.done }] },
      { name: "결정 내용", type: "text" },
      { name: "실행", type: "select", options: [
        { id: "wait", label: "대기", color: C.wait }, { id: "doing", label: "진행", color: C.doing }, { id: "done", label: "완료", color: C.done }] },
    ],
    example: "예시 — 창고 정리 방식 개선",
  },
];

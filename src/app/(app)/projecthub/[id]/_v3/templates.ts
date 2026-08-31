// 프로젝트 v3 — 가로형 템플릿 (2026-08-31 사장님: "업무형식이 가로로 —
//   한 태스크당 업무처리를 하려면 가로로 업무를 보는 게 편함")
//
//   세로(할 일을 여러 줄로 나열)가 아니라 **한 줄 = 한 건, 열 = 처리 단계**.
//   사장님 monday 운영 시트(소상공인 한 줄 × 광고ID·소통일·플랫폼·시작/종료일 열)와 같은 문법.
//   그래서 템플릿이 시드하는 것은 항목이 아니라 **컬럼 정의**(project_item_columns) + 예시 한 줄.
//   그룹(단계)은 건드리지 않는다 — 그룹은 사용자가 ＋ 새 그룹으로 늘리는 영역.
//
//   2026-08-31 확장(사장님: "먼데이처럼 템플릿을 다양하게 — 마케팅·콘텐츠 제작·프로젝트 관리·
//   디자인·소프트웨어 개발 등 회사에서 많이 쓰는 것들"): monday 템플릿 센터를 카테고리별로 실사
//   (마케팅 Social media planner·Email marketing·A/B testing / 콘텐츠 Content Planning·Video
//   production·Digital asset / 디자인 Design weekly tasks·Creative Processes·Client campaigns /
//   개발 제품 로드맵·IT 서비스 데스크·Features and releases / HR Recruitment pipeline·Employee
//   onboarding / CRM Customer Onboarding·Supporting sales / 운영 Purchase Orders·Vendor
//   Evaluation·설비 요청)한 뒤 소상공인·중소기업 용어로 덜어내 8카테고리 26종으로 재설계.
//   담당·상태·마감·금액은 내장 열이 이미 있으므로 템플릿 열과 중복시키지 않는다.

import type { FieldType, ItemStage } from "@/lib/project-items";

export type TplOption = { id: string; label: string; color?: string };
export type TplCol = { name: string; type: FieldType; options?: TplOption[] };
export type Tpl = {
  key: string; icon: string; name: string; desc: string;
  cat: string;
  cols: TplCol[];
  /** 예시 줄 — 이름 칸에 넣을 한 건 */
  example: string;
  /** 우리 회사 양식만 씀 — 저장 당시 그룹 구성. 빈 표에 적용할 때만 그룹까지 재현한다 */
  stages?: ItemStage[];
};

/** '우리 회사 양식' 카테고리 이름 — monday '만든 사람: {회사}' 대응. DB(project_templates)에서 온다 */
export const MY_TPL_CAT = "우리 회사 양식";

export const TPL_CATEGORIES = [
  "프로젝트 관리", "마케팅", "콘텐츠 제작", "디자인", "소프트웨어 개발", "영업·고객", "인사", "운영·구매",
] as const;

//   진행 단계 옵션 공용 색 — 상태 셀과 같은 톤(회색=아직, 주황=하는 중, 초록=끝, 빨강=문제)
const C = { wait: "#9aa0b5", doing: "#FDAB3D", done: "#00C875", danger: "#E2445C", blue: "#5559DF" };
const o = (id: string, label: string, color?: string): TplOption => ({ id, label, color });

export const TEMPLATES: Tpl[] = [
  // ── 프로젝트 관리 ──
  {
    key: "basic", icon: "📋", name: "기본 프로젝트", cat: "프로젝트 관리",
    desc: "한 줄 = 업무 하나. 우선순위와 메모만 — 담당·상태·마감은 내장 열이 이미 있습니다.",
    cols: [
      { name: "우선순위", type: "select", options: [o("high", "높음", C.danger), o("mid", "보통", C.doing), o("low", "낮음", C.wait)] },
      { name: "메모", type: "text" },
    ],
    example: "예시 — 첫 업무",
  },
  {
    key: "service", icon: "🤝", name: "고객 용역·납품", cat: "프로젝트 관리",
    desc: "한 줄 = 수주 건 하나. 견적→계약→청구가 열로 나란히 — 줄만 훑으면 어디까지 갔는지 보입니다.",
    cols: [
      { name: "거래처", type: "partner" },
      { name: "견적", type: "select", options: [o("wait", "대기", C.wait), o("sent", "보냄", C.doing), o("ok", "확정", C.done)] },
      { name: "계약", type: "select", options: [o("wait", "대기", C.wait), o("sign", "서명 중", C.doing), o("done", "완료", C.done)] },
      { name: "청구", type: "select", options: [o("todo", "예정", C.wait), o("billed", "발행", C.doing), o("paid", "입금", C.done)] },
      { name: "검수일", type: "date" },
    ],
    example: "예시 — ○○상사 홈페이지 제작 건",
  },
  {
    key: "event", icon: "🎪", name: "행사·전시 준비", cat: "프로젝트 관리",
    desc: "한 줄 = 준비 건(부스·인쇄물·물품) 하나. 예약→제작→완료와 비용이 열로.",
    cols: [
      { name: "업체", type: "partner" },
      { name: "진행", type: "select", options: [o("wait", "대기", C.wait), o("book", "예약·발주", C.doing), o("done", "완료", C.done)] },
      { name: "비용", type: "number" },
      { name: "확정일", type: "date" },
    ],
    example: "예시 — 부스 임차",
  },
  {
    key: "grant", icon: "🏛", name: "정부 지원사업", cat: "프로젝트 관리",
    desc: "한 줄 = 사업(공고) 하나. 신청→선정→증빙이 열로 — 마감일은 내장 마감 칸에.",
    cols: [
      { name: "기관", type: "text" },
      { name: "신청", type: "select", options: [o("prep", "준비", C.wait), o("sent", "제출", C.doing), o("win", "선정", C.done), o("lose", "탈락", C.danger)] },
      { name: "증빙", type: "select", options: [o("todo", "수집 중", C.doing), o("done", "완료", C.done)] },
      { name: "보조금", type: "number" },
    ],
    //   실제 사업명 쓰지 말 것 — 모티브가 하는 사업이 그대로 노출됐던 사고(2026-08-31 사장님 지적)
    example: "예시 — ○○ 지원사업 공고",
  },
  {
    key: "internal", icon: "🛠", name: "사내 개선·TF", cat: "프로젝트 관리",
    desc: "한 줄 = 안건 하나. 논의→결정→실행이 열로, 결정 내용은 글 칸에.",
    cols: [
      { name: "논의", type: "select", options: [o("wait", "대기", C.wait), o("talk", "논의 중", C.doing), o("fix", "결정", C.done)] },
      { name: "결정 내용", type: "text" },
      { name: "실행", type: "select", options: [o("wait", "대기", C.wait), o("doing", "진행", C.doing), o("done", "완료", C.done)] },
    ],
    example: "예시 — 창고 정리 방식 개선",
  },

  // ── 마케팅 (monday: Social media planner · Email marketing · A/B testing) ──
  {
    key: "campaign", icon: "📣", name: "마케팅 캠페인", cat: "마케팅",
    desc: "한 줄 = 소재·채널 하나. 제작→집행→종료와 광고비가 열로.",
    cols: [
      { name: "채널", type: "select", options: [o("insta", "인스타", C.blue), o("naver", "네이버", C.done), o("youtube", "유튜브", C.danger), o("etc", "기타", C.wait)] },
      { name: "소재", type: "select", options: [o("plan", "기획", C.wait), o("making", "제작 중", C.doing), o("done", "완료", C.done)] },
      { name: "집행", type: "select", options: [o("wait", "대기", C.wait), o("live", "집행 중", C.doing), o("end", "종료", C.done)] },
      { name: "광고비", type: "number" },
      { name: "시작일", type: "date" },
    ],
    example: "예시 — 9월 신제품 인스타 광고",
  },
  {
    key: "sns", icon: "📱", name: "SNS 게시 일정", cat: "마케팅",
    desc: "한 줄 = 게시물 하나. 어느 채널에 언제 올릴지 — 기획→제작→예약→게시가 열로.",
    cols: [
      { name: "채널", type: "select", options: [o("insta", "인스타", C.blue), o("youtube", "유튜브", C.danger), o("blog", "블로그", C.done), o("etc", "기타", C.wait)] },
      { name: "게시", type: "select", options: [o("idea", "기획", C.wait), o("making", "제작 중", C.doing), o("booked", "예약", C.blue), o("posted", "게시됨", C.done)] },
      { name: "게시일", type: "date" },
      { name: "링크", type: "text" },
    ],
    example: "예시 — 신메뉴 소개 릴스",
  },
  {
    key: "email", icon: "✉️", name: "이메일·문자 발송", cat: "마케팅",
    desc: "한 줄 = 발송 건 하나. 초안→검수→발송과 반응이 열로.",
    cols: [
      { name: "대상", type: "text" },
      { name: "발송", type: "select", options: [o("draft", "초안", C.wait), o("review", "검수", C.doing), o("sent", "발송됨", C.done)] },
      { name: "발송일", type: "date" },
      { name: "반응 수", type: "number" },
    ],
    example: "예시 — 추석 할인 안내 문자",
  },
  {
    key: "abtest", icon: "🧪", name: "A/B 테스트", cat: "마케팅",
    desc: "한 줄 = 실험 하나. 무엇을 비교하는지와 A·B 성과, 결론이 열로.",
    cols: [
      { name: "가설", type: "text" },
      { name: "진행", type: "select", options: [o("prep", "준비", C.wait), o("run", "진행 중", C.doing), o("end", "종료", C.done)] },
      { name: "A 성과", type: "number" },
      { name: "B 성과", type: "number" },
      { name: "결론", type: "text" },
    ],
    example: "예시 — 배너 문구 A/B",
  },

  // ── 콘텐츠 제작 (monday: Content Planning · Video production · Digital asset management) ──
  {
    key: "content", icon: "✍️", name: "콘텐츠 기획·발행", cat: "콘텐츠 제작",
    desc: "한 줄 = 콘텐츠 하나. 아이디어→작성→검토→발행이 열로.",
    cols: [
      { name: "유형", type: "select", options: [o("post", "글", C.blue), o("video", "영상", C.danger), o("image", "이미지", C.doing)] },
      { name: "발행", type: "select", options: [o("idea", "아이디어", C.wait), o("writing", "작성 중", C.doing), o("review", "검토", C.blue), o("posted", "발행됨", C.done)] },
      { name: "발행일", type: "date" },
      { name: "채널", type: "text" },
    ],
    example: "예시 — 가을 신상품 소개 글",
  },
  {
    key: "video", icon: "🎬", name: "영상 제작", cat: "콘텐츠 제작",
    desc: "한 줄 = 영상 하나. 기획→촬영→편집→업로드가 열로, 비용도 같이.",
    cols: [
      { name: "단계", type: "select", options: [o("plan", "기획", C.wait), o("shoot", "촬영", C.doing), o("edit", "편집", C.blue), o("up", "업로드", C.done)] },
      { name: "업로드일", type: "date" },
      { name: "링크", type: "text" },
      { name: "제작비", type: "number" },
    ],
    example: "예시 — 매장 소개 영상",
  },
  {
    key: "asset", icon: "🗂", name: "자료·파일 관리", cat: "콘텐츠 제작",
    desc: "한 줄 = 자료 하나. 로고·사진·문서가 어디 있는지 — 종류와 위치가 열로.",
    cols: [
      { name: "종류", type: "select", options: [o("logo", "로고", C.blue), o("photo", "사진", C.doing), o("video", "영상", C.danger), o("doc", "문서", C.wait)] },
      { name: "위치·링크", type: "text" },
      { name: "갱신일", type: "date" },
    ],
    example: "예시 — 로고 원본(AI 파일)",
  },

  // ── 디자인 (monday: Design weekly tasks · Creative Processes · Client campaigns) ──
  {
    key: "design", icon: "🎨", name: "디자인 요청·작업", cat: "디자인",
    desc: "한 줄 = 요청 하나. 접수→작업→피드백→완료가 열로, 시안 링크도 같이.",
    cols: [
      { name: "요청자", type: "person" },
      { name: "종류", type: "select", options: [o("banner", "배너", C.blue), o("detail", "상세페이지", C.doing), o("logo", "로고", C.done), o("print", "인쇄물", C.wait)] },
      { name: "작업", type: "select", options: [o("in", "접수", C.wait), o("doing", "작업 중", C.doing), o("fb", "피드백", C.blue), o("done", "완료", C.done)] },
      { name: "시안 링크", type: "text" },
    ],
    example: "예시 — 추석 이벤트 배너",
  },
  {
    key: "proof", icon: "✅", name: "시안 검토·승인", cat: "디자인",
    desc: "한 줄 = 시안 하나. 버전별로 수정 요청→승인이 열로.",
    cols: [
      { name: "버전", type: "text" },
      { name: "검토", type: "select", options: [o("wait", "검토 대기", C.wait), o("fix", "수정 요청", C.danger), o("ok", "승인", C.done)] },
      { name: "확정일", type: "date" },
    ],
    example: "예시 — 패키지 시안 v2",
  },
  {
    key: "agency", icon: "🖼", name: "클라이언트 작업(대행)", cat: "디자인",
    desc: "한 줄 = 클라이언트 건 하나. 브리프→시안→수정→납품과 청구가 열로.",
    cols: [
      { name: "클라이언트", type: "partner" },
      { name: "작업", type: "select", options: [o("brief", "브리프", C.wait), o("draft", "시안", C.doing), o("fix", "수정", C.blue), o("done", "납품", C.done)] },
      { name: "청구", type: "select", options: [o("todo", "예정", C.wait), o("billed", "발행", C.doing), o("paid", "입금", C.done)] },
      { name: "납품일", type: "date" },
    ],
    example: "예시 — △△카페 메뉴판 리뉴얼",
  },

  // ── 소프트웨어 개발 (monday: 제품 로드맵 · IT 서비스 데스크 · Features and releases) ──
  {
    key: "roadmap", icon: "🗺", name: "제품 로드맵", cat: "소프트웨어 개발",
    desc: "한 줄 = 기능 하나. 어느 분기에 무엇을 만들지 — 계획→개발→출시가 열로.",
    cols: [
      { name: "분기", type: "select", options: [o("q1", "1분기", C.blue), o("q2", "2분기", C.done), o("q3", "3분기", C.doing), o("q4", "4분기", C.danger)] },
      { name: "진행", type: "select", options: [o("plan", "계획", C.wait), o("dev", "개발 중", C.doing), o("out", "출시", C.done)] },
      { name: "중요도", type: "select", options: [o("must", "필수", C.danger), o("want", "하면 좋음", C.doing), o("later", "나중에", C.wait)] },
    ],
    example: "예시 — 모바일 결제 기능",
  },
  {
    key: "bug", icon: "🐞", name: "버그·요청 접수", cat: "소프트웨어 개발",
    desc: "한 줄 = 접수 건 하나. 종류·급한 정도·처리가 열로.",
    cols: [
      { name: "종류", type: "select", options: [o("bug", "버그", C.danger), o("req", "요청", C.blue), o("ask", "문의", C.wait)] },
      { name: "급한 정도", type: "select", options: [o("high", "급함", C.danger), o("mid", "보통", C.doing), o("low", "낮음", C.wait)] },
      { name: "처리", type: "select", options: [o("in", "접수", C.wait), o("doing", "처리 중", C.doing), o("done", "해결", C.done)] },
      { name: "보고자", type: "text" },
    ],
    example: "예시 — 로그인 오류 제보",
  },
  {
    key: "release", icon: "🚀", name: "기능 출시 관리", cat: "소프트웨어 개발",
    desc: "한 줄 = 출시 건 하나. 개발→테스트→배포와 배포일이 열로.",
    cols: [
      { name: "버전", type: "text" },
      { name: "진행", type: "select", options: [o("dev", "개발", C.wait), o("test", "테스트", C.doing), o("live", "배포됨", C.done)] },
      { name: "배포일", type: "date" },
    ],
    example: "예시 — v2.1 회원 등급제",
  },

  // ── 영업·고객 (monday: CRM 파이프라인 · Customer Onboarding · 운영 시트형 레코드) ──
  {
    key: "pipeline", icon: "💼", name: "영업 파이프라인", cat: "영업·고객",
    desc: "한 줄 = 영업 건 하나. 리드→미팅→견적→계약이 열로, 예상 금액은 내장 금액 칸에.",
    cols: [
      { name: "거래처", type: "partner" },
      { name: "단계", type: "select", options: [o("lead", "리드", C.wait), o("meet", "미팅", C.blue), o("quote", "견적", C.doing), o("win", "계약", C.done), o("lose", "무산", C.danger)] },
      { name: "다음 연락일", type: "date" },
      { name: "메모", type: "text" },
    ],
    example: "예시 — □□식품 납품 제안",
  },
  {
    key: "onboardc", icon: "🚢", name: "고객 온보딩", cat: "영업·고객",
    desc: "한 줄 = 새 고객 하나. 계약 후 세팅→교육→완료가 열로.",
    cols: [
      { name: "거래처", type: "partner" },
      { name: "온보딩", type: "select", options: [o("start", "계약", C.wait), o("setup", "세팅", C.doing), o("edu", "교육", C.blue), o("done", "완료", C.done)] },
      { name: "시작일", type: "date" },
    ],
    example: "예시 — ○○마트 신규 계약",
  },
  {
    key: "clients", icon: "📇", name: "거래처 관리", cat: "영업·고객",
    desc: "한 줄 = 거래처 하나. 등급과 마지막 연락일이 열로 — 사장님 monday 운영 시트와 같은 레코드형.",
    cols: [
      { name: "거래처", type: "partner" },
      { name: "등급", type: "select", options: [o("a", "A", C.done), o("b", "B", C.doing), o("c", "C", C.wait)] },
      { name: "마지막 연락", type: "date" },
      { name: "메모", type: "text" },
    ],
    example: "예시 — ◇◇물산",
  },

  // ── 인사 (monday: Recruitment pipeline · Employee onboarding) ──
  {
    key: "recruit", icon: "🧑‍💼", name: "채용 파이프라인", cat: "인사",
    desc: "한 줄 = 지원자 하나. 지원→서류→면접→합격이 열로.",
    cols: [
      { name: "포지션", type: "text" },
      { name: "전형", type: "select", options: [o("apply", "지원", C.wait), o("doc", "서류 통과", C.blue), o("meet", "면접", C.doing), o("win", "합격", C.done), o("lose", "불합격", C.danger)] },
      { name: "면접일", type: "date" },
      { name: "연락처", type: "text" },
    ],
    example: "예시 — 매장 매니저 지원자 김○○",
  },
  {
    key: "onboarde", icon: "🎒", name: "신입 온보딩 체크", cat: "인사",
    desc: "한 줄 = 준비 항목 하나. 계정·장비·교육이 어디까지 됐는지 열로 — 담당은 내장 담당 칸에.",
    cols: [
      { name: "준비", type: "select", options: [o("todo", "준비", C.wait), o("doing", "진행", C.doing), o("done", "완료", C.done)] },
      { name: "완료일", type: "date" },
      { name: "메모", type: "text" },
    ],
    example: "예시 — 사내 계정 만들기",
  },

  // ── 운영·구매 (monday: Purchase Orders · Vendor Evaluation · 설비 요청) ──
  {
    key: "purchase", icon: "🧾", name: "구매·발주", cat: "운영·구매",
    desc: "한 줄 = 발주 건 하나. 요청→발주→입고→정산이 열로, 금액은 내장 금액 칸에.",
    cols: [
      { name: "업체", type: "partner" },
      { name: "진행", type: "select", options: [o("req", "요청", C.wait), o("order", "발주", C.doing), o("in", "입고", C.blue), o("paid", "정산", C.done)] },
      { name: "입고일", type: "date" },
    ],
    example: "예시 — 포장 박스 500개",
  },
  {
    key: "facility", icon: "🔧", name: "비품·설비 요청", cat: "운영·구매",
    desc: "한 줄 = 요청 하나. 누가 요청했고 어디까지 처리됐는지 열로.",
    cols: [
      { name: "요청자", type: "person" },
      { name: "처리", type: "select", options: [o("in", "접수", C.wait), o("ok", "승인", C.doing), o("done", "처리 완료", C.done), o("no", "반려", C.danger)] },
      { name: "처리일", type: "date" },
    ],
    example: "예시 — 매장 에어컨 수리",
  },
  {
    key: "vendor", icon: "⚖️", name: "업체 평가·비교", cat: "운영·구매",
    desc: "한 줄 = 후보 업체 하나. 견적가를 나란히 놓고 선정까지 열로.",
    cols: [
      { name: "업체", type: "partner" },
      { name: "견적가", type: "number" },
      { name: "평가", type: "select", options: [o("cand", "후보", C.wait), o("hold", "보류", C.doing), o("win", "선정", C.done), o("out", "탈락", C.danger)] },
      { name: "메모", type: "text" },
    ],
    example: "예시 — 물류 대행 업체 A",
  },
];
